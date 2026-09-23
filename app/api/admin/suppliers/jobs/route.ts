import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { jobStatusLabel } from "@/lib/admin-format";
import {
  isSupplierJobOpen,
  supplierJobNextStatuses,
  supplierJobStatusBehind,
  supplierJobTransitions,
  SUPPLIER_CATEGORIES,
  SUPPLIER_JOB_STATUSES,
  type SupplierCategoryValue,
  type SupplierJobStatus,
} from "@/lib/admin-types";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { withIdempotency } from "@/lib/server/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trabajos por evento con proveedores de la empresa activa.
 *
 * - `GET` lista los trabajos con su proveedor y su evento.
 * - `POST` crea el trabajo (`finance.write`).
 * - `PATCH` edita datos, pagos y estado (`finance.write`), validando la máquina de
 *   estados de `lib/admin-types.ts`: sin saltos inválidos, anticipo > 0 para los
 *   estados de anticipo y saldo > 0 para `BALANCE_PENDING`.
 *
 * Idempotencia y monotonicidad (issue #20): ambas mutaciones pasan por
 * `withIdempotency` (`suppliers-jobs:POST` / `suppliers-jobs:PATCH`) con la
 * clave del cliente —repetir la misma clave devuelve la misma respuesta y no
 * crea ni paga dos veces— y un pedido atrasado (reintento o request fuera de
 * orden que pide un estado ya pasado) devuelve el trabajo actual sin cambios y
 * sin auditar. Los estados terminales (`PAID`, `CANCELLED`) no se reabren.
 *
 * Todo se filtra por `organizationId`; un trabajo, proveedor o evento de otra
 * empresa responde 404.
 */

const MAX = { description: 200, method: 60, receipt: 120, notes: 1000 } as const;
const MAX_AMOUNT = 1_000_000_000_000;

const jobInclude = {
  supplier: { select: { id: true, name: true, phone: true, category: true } },
  event: { select: { id: true, name: true, startsAt: true, status: true } },
} as const;

/** Campos que se auditan al crear o editar un trabajo de proveedor. */
const JOB_AUDIT_FIELDS = [
  "description",
  "category",
  "eventId",
  "total",
  "advance",
  "status",
  "dueAt",
  "deliveredAt",
  "paidAt",
  "paymentMethod",
  "receipt",
  "notes",
] as const;

function isCategory(value: unknown): value is SupplierCategoryValue {
  return typeof value === "string" && (SUPPLIER_CATEGORIES as readonly string[]).includes(value);
}

function isJobStatus(value: unknown): value is SupplierJobStatus {
  return typeof value === "string" && (SUPPLIER_JOB_STATUSES as readonly string[]).includes(value);
}

/** Entero no negativo/positivo; `null` cuando el valor no es un entero válido. */
function toInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

type ParsedDate = { ok: true; value: Date | null } | { ok: false };

/** Fecha opcional: `YYYY-MM-DD` se guarda a mediodía para no correr el día en pantalla. */
function parseDate(value: unknown): ParsedDate | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, value: date };
}

/**
 * `GET ?fields=panel` (issue #68): el trabajo con las referencias mínimas
 * —proveedor (id, nombre) y evento (id, nombre)—, que es todo lo que dibuja la
 * pantalla de proveedores; sin el parámetro la respuesta es la de siempre.
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const panel = new URL(request.url).searchParams.get("fields") === "panel";
  const jobs = await db.supplierJob.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: [{ dueAt: "asc" }, { description: "asc" }],
    take: 300,
    include: panel
      ? { supplier: { select: { id: true, name: true } }, event: { select: { id: true, name: true } } }
      : jobInclude,
  });
  return Response.json({ jobs });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;

  return withIdempotency({ request, organizationId, scope: "suppliers-jobs:POST", body }, async (tx) => {
    if (typeof body.supplierId !== "string") return jsonError("Supplier is required.", 400);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length < 2) return jsonError("Job description is required.", 400);
    const total = toInteger(body.total);
    if (total === null || total <= 0 || total > MAX_AMOUNT) return jsonError("Total must be a positive amount.", 400);
    const advance = body.advance === undefined ? 0 : toInteger(body.advance);
    if (advance === null || advance < 0 || advance > total) return jsonError("Advance must be an amount between 0 and the total.", 400);
    if (body.category !== undefined && !isCategory(body.category)) return jsonError("Invalid supplier category.", 400);

    const supplier = await tx.supplier.findFirst({ where: { id: body.supplierId, organizationId }, select: { id: true, category: true, name: true } });
    if (!supplier) return jsonError("Supplier not found.", 404);

    const eventId = typeof body.eventId === "string" && body.eventId ? body.eventId : "";
    if (eventId) {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
      if (!event) return jsonError("Event not found.", 404);
    }

    const dueAt = parseDate(body.dueAt);
    if (dueAt && !dueAt.ok) return jsonError("Invalid due date.", 400);

    const job = await tx.supplierJob.create({
      data: {
        id: randomUUID(),
        organizationId,
        supplierId: supplier.id,
        eventId: eventId || null,
        category: isCategory(body.category) ? body.category : supplier.category,
        description: description.slice(0, MAX.description),
        total,
        advance,
        dueAt: dueAt?.value ?? null,
        notes: optionalText(body.notes, MAX.notes) ?? null,
        paymentMethod: optionalText(body.paymentMethod, MAX.method) ?? null,
        receipt: optionalText(body.receipt, MAX.receipt) ?? null,
        // Un trabajo que nace con anticipo ya pagado arranca en ADVANCE_PAID.
        status: advance > 0 ? "ADVANCE_PAID" : "PENDING",
      },
      include: jobInclude,
    });
    return {
      status: 201,
      body: { job },
      afterCommit: () =>
        recordAudit({
          context: auth.context,
          action: "create",
          entity: "SupplierJob",
          entityId: job.id,
          summary: `Cargó el trabajo «${job.description}» del proveedor «${supplier.name}»`,
          detail: { fields: auditPick(job, JOB_AUDIT_FIELDS) },
        }),
    };
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.id !== "string") return jsonError("Job id is required.", 400);

  return withIdempotency({ request, organizationId, scope: "suppliers-jobs:PATCH", body }, async (tx) => {
    const job = await tx.supplierJob.findFirst({ where: { id: body.id as string, organizationId }, include: jobInclude });
    if (!job) return jsonError("Job not found.", 404);
    const closed = !isSupplierJobOpen(job.status);

    const nextStatus = body.status === undefined ? undefined : isJobStatus(body.status) ? body.status : null;
    if (nextStatus === null) return jsonError("Invalid job status.", 400);
    const transition = nextStatus !== undefined && nextStatus !== job.status;

    // Monotonicidad (issue #20): un pedido atrasado —fuera de la máquina y por
    // detrás del avance actual— devuelve el trabajo tal como está, sin escribir
    // ni auditar. Los estados terminales nunca se reabren ni retroceden.
    if (transition && nextStatus && !supplierJobTransitions(job.status).includes(nextStatus) && supplierJobStatusBehind(job.status, nextStatus)) {
      return { status: 200, body: { job, unchanged: true } };
    }

    const total = body.total === undefined ? job.total : toInteger(body.total);
    if (total === null || total <= 0 || total > MAX_AMOUNT) return jsonError("Total must be a positive amount.", 400);
    const advance = body.advance === undefined ? job.advance : toInteger(body.advance);
    if (advance === null || advance < 0 || advance > total) return jsonError("Advance must be an amount between 0 and the total.", 400);

    if (closed && (transition || body.total !== undefined || body.advance !== undefined)) {
      return jsonError("A paid or cancelled job cannot change its status, total or advance.", 400);
    }
    const resultingStatus = nextStatus ?? job.status;
    if ((resultingStatus === "ADVANCE_PENDING" || resultingStatus === "ADVANCE_PAID") && advance <= 0) {
      return jsonError("The advance must be greater than zero.", 400);
    }
    if (resultingStatus === "BALANCE_PENDING" && total - advance <= 0) {
      return jsonError("The job has no pending balance.", 400);
    }
    if (transition && nextStatus) {
      if (!supplierJobTransitions(job.status).includes(nextStatus)) {
        return jsonError(`Invalid transition from ${job.status} to ${nextStatus}.`, 400);
      }
      if (!supplierJobNextStatuses({ total, advance, status: job.status }).includes(nextStatus)) {
        return jsonError(
          nextStatus === "BALANCE_PENDING"
            ? "The job has no pending balance."
            : "The advance must be greater than zero.",
          400,
        );
      }
    }

    const description = body.description === undefined ? undefined : typeof body.description === "string" ? body.description.trim() : "";
    if (description !== undefined && description.length < 2) return jsonError("Job description is required.", 400);
    if (body.category !== undefined && !isCategory(body.category)) return jsonError("Invalid supplier category.", 400);

    let eventId: string | null | undefined;
    if (body.eventId !== undefined) {
      eventId = typeof body.eventId === "string" && body.eventId ? body.eventId : null;
      if (eventId) {
        const event = await tx.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
        if (!event) return jsonError("Event not found.", 404);
      }
    }

    const dueAt = parseDate(body.dueAt);
    if (dueAt && !dueAt.ok) return jsonError("Invalid due date.", 400);
    const deliveredAt = parseDate(body.deliveredAt);
    if (deliveredAt && !deliveredAt.ok) return jsonError("Invalid delivery date.", 400);
    const paidAt = parseDate(body.paidAt);
    if (paidAt && !paidAt.ok) return jsonError("Invalid payment date.", 400);

    const data: Prisma.SupplierJobUpdateInput = {};
    if (description !== undefined) data.description = description.slice(0, MAX.description);
    if (body.category !== undefined && isCategory(body.category)) data.category = body.category;
    if (body.eventId !== undefined) data.event = eventId ? { connect: { id: eventId } } : { disconnect: true };
    if (body.total !== undefined) data.total = total;
    if (body.advance !== undefined) data.advance = advance;
    if (dueAt) data.dueAt = dueAt.value;
    if (deliveredAt) data.deliveredAt = deliveredAt.value;
    if (paidAt) data.paidAt = paidAt.value;
    if (body.paymentMethod !== undefined) data.paymentMethod = optionalText(body.paymentMethod, MAX.method);
    if (body.receipt !== undefined) data.receipt = optionalText(body.receipt, MAX.receipt);
    if (body.notes !== undefined) data.notes = optionalText(body.notes, MAX.notes);
    if (transition && nextStatus) {
      data.status = nextStatus;
      // Sellos de tiempo reales: entrega y pago se fechan solos si no se indicó fecha.
      if (nextStatus === "DELIVERED" && !deliveredAt?.value && !job.deliveredAt) data.deliveredAt = new Date();
      if (nextStatus === "PAID" && !paidAt?.value && !job.paidAt) data.paidAt = new Date();
    }

    const updated = await tx.supplierJob.update({ where: { id: job.id }, data, include: jobInclude });
    const changes = auditChanges(job, updated, JOB_AUDIT_FIELDS);
    return {
      status: 200,
      body: { job: updated },
      ...(changes
        ? {
            afterCommit: () =>
              recordAudit({
                context: auth.context,
                action: "status" in changes ? "status" : "update",
                entity: "SupplierJob",
                entityId: job.id,
                summary: "status" in changes
                  ? `Cambió el estado del trabajo «${updated.description}» a ${jobStatusLabel(updated.status)}`
                  : `Editó el trabajo «${updated.description}» del proveedor «${updated.supplier.name}»`,
                detail: { changes },
              }),
          }
        : {}),
    };
  });
}
