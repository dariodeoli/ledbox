import type { Prisma } from "@prisma/client";
import type { AuditContext } from "./audit";
import { recordAudit } from "./audit";
import { dbWithDeleted } from "./db";
import { anonymize, archive, blockedError, purgeBlockers, restore, TrashError, trash, unarchive, type Blocker, type TrashModel } from "./trash";
import { namesMatch, readPurgeReason, type PurgeInput } from "./trash-ops";
import type { AdminCapability } from "./permissions";
import { live } from "./trash-filter";

/**
 * Papelera, etapa 3 (docs/PAPELERA.md): Cliente, Oportunidad, Proveedor, Promotora y
 * Presupuesto. Mismo patrón que `trash-ops.ts`: las rutas resuelven permisos; acá viven
 * las reglas de datos, acotadas por `organizationId` y dentro de una transacción con
 * `FOR UPDATE` de la fila. Nunca se borra historial contable: Client→ClientPayment y
 * Supplier→SupplierJob caen en cascada, así que `purgeBlockers` los frena y se ofrece anonimizar.
 */

type Tx = Prisma.TransactionClient;

export const CRM_MODELS = ["Client", "Lead", "Supplier", "Promoter", "Budget"] as const satisfies readonly TrashModel[];
export type CrmModel = (typeof CRM_MODELS)[number];

/** Segmento de URL → modelo (`/api/admin/<segmento>/[id]/[action]`). */
export const CRM_SEGMENTS: Record<string, CrmModel> = { clients: "Client", leads: "Lead", suppliers: "Supplier", promoters: "Promoter", budgets: "Budget" };

const WRITE_CAPABILITY: Record<CrmModel, AdminCapability> = {
  Client: "clients.write",
  Lead: "clients.write",
  Supplier: "suppliers.write",
  Promoter: "promoters.write",
  Budget: "budgets.write",
};

/** Capacidad de cada acción: escritura de la entidad para archivar/desarchivar/eliminar; `trash.manage` para el resto. */
export function crmActionCapability(model: CrmModel, action: string): AdminCapability | undefined {
  if (action === "archive" || action === "unarchive" || action === "trash") return WRITE_CAPABILITY[model];
  if (action === "restore" || action === "purge" || action === "anonymize") return "trash.manage";
  return undefined;
}

const TABLE: Record<CrmModel, "Client" | "Lead" | "Supplier" | "Promoter" | "Budget"> = { Client: "Client", Lead: "Lead", Supplier: "Supplier", Promoter: "Promoter", Budget: "Budget" };
const DELEGATE = { Client: "client", Lead: "lead", Supplier: "supplier", Promoter: "promoter", Budget: "budget" } as const;
const NOUN: Record<CrmModel, string> = { Client: "El cliente", Lead: "La oportunidad", Supplier: "El proveedor", Promoter: "La promotora", Budget: "El presupuesto" };
/** Modelos con `active` que se mantiene coherente con `archivedAt`. */
const HAS_ACTIVE = new Set<CrmModel>(["Client", "Supplier", "Promoter"]);
export const LEAD_STALE_DAYS = 30;
export const BUDGET_ARCHIVABLE_STATUSES = ["DRAFT", "LOST", "CANCELLED"] as const;

type Row = { id: string; label: string; status?: string; updatedAt?: Date; archivedAt: Date | null };

/** Bloquea la fila (FOR UPDATE) y la lee viva. 404 si no es de la empresa o está eliminada. */
async function loadLive(tx: Tx, model: CrmModel, id: string, organizationId: string): Promise<Row> {
  const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${TABLE[model]}" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`, id, organizationId);
  if (locked.length === 0) throw new TrashError(`${NOUN[model]} no existe.`, 404);
  const delegate = (tx as unknown as Record<string, { findFirst(args: unknown): Promise<Record<string, unknown> | null> }>)[DELEGATE[model]];
  const select =
    model === "Budget" ? { title: true, status: true, archivedAt: true } : model === "Lead" ? { name: true, status: true, updatedAt: true, archivedAt: true } : { name: true, archivedAt: true };
  const row = await delegate.findFirst({ where: { id, organizationId, ...live }, select });
  if (!row) throw new TrashError(`${NOUN[model]} no existe.`, 404);
  return {
    id,
    label: String(model === "Budget" ? row.title : row.name),
    status: row.status as string | undefined,
    updatedAt: row.updatedAt as Date | undefined,
    archivedAt: row.archivedAt as Date | null,
  };
}

/** Sincroniza `active` con el archivado (Client, Supplier, Promoter) dentro de la transacción. */
async function syncActive(tx: Tx, model: CrmModel, id: string, organizationId: string, active: boolean) {
  if (!HAS_ACTIVE.has(model)) return;
  const delegate = (tx as unknown as Record<string, { updateMany(args: unknown): Promise<unknown> }>)[DELEGATE[model]];
  await delegate.updateMany({ where: { id, organizationId }, data: { active } });
}

/**
 * Datos de `archivedAt/archivedById` que acompañan a un cambio de `active` hecho desde un
 * PATCH (Proveedor): `active=false` archiva (si no lo estaba) y `active=true` desarchiva.
 */
export function archivedFieldsForActive(active: boolean, current: { archivedAt: Date | null }, userId: string) {
  if (active) return { archivedAt: null, archivedById: null };
  return current.archivedAt ? {} : { archivedAt: new Date(), archivedById: userId };
}

// ── Archivar / desarchivar / eliminar ────────────────────────────────────────

export async function archiveCrm(model: CrmModel, id: string, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    const row = await loadLive(tx, model, id, context.organizationId);
    if (model === "Budget" && !(BUDGET_ARCHIVABLE_STATUSES as readonly string[]).includes(row.status ?? "")) {
      throw new TrashError("Solo se archivan presupuestos en borrador, perdidos o cancelados.", 409);
    }
    if (model === "Lead" && row.status !== "WON" && row.status !== "LOST") {
      const stale = Date.now() - (row.updatedAt?.getTime() ?? Date.now()) > LEAD_STALE_DAYS * 864e5;
      if (!stale) throw new TrashError(`Solo se archivan oportunidades ganadas, perdidas o sin actividad hace más de ${LEAD_STALE_DAYS} días.`, 409);
    }
    await archive(model, id, context, { tx, label: row.label });
    await syncActive(tx, model, id, context.organizationId, false);
  });
}

export async function unarchiveCrm(model: CrmModel, id: string, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    const row = await loadLive(tx, model, id, context.organizationId);
    await unarchive(model, id, context, { tx, label: row.label });
    await syncActive(tx, model, id, context.organizationId, true);
  });
}

const BLOCKER_TEXT: Record<string, string> = {
  events: "eventos vivos",
  budgets: "presupuestos vivos",
  pendingJobs: "trabajos pendientes",
  futureTasks: "tareas en eventos futuros",
  signatureRequests: "firmas",
  payments: "cobros",
  paymentProofs: "comprobantes",
  invoices: "facturas",
  confirmedExpectedPayments: "pagos esperados confirmados",
};

function guardError(blockers: Blocker[]) {
  return new TrashError(`No se puede eliminar: tiene ${blockers.map((b) => `${b.count} ${BLOCKER_TEXT[b.kind] ?? b.kind}`).join(", ")}.`, 409, blockers);
}

async function trashGuard(model: CrmModel, id: string, organizationId: string, tx: Tx) {
  const blockers: Blocker[] = [];
  const add = (kind: string, count: number) => count > 0 && blockers.push({ kind, count });
  if (model === "Client") {
    add("events", await tx.event.count({ where: { organizationId, clientId: id, ...live } }));
    add("budgets", await tx.budget.count({ where: { organizationId, clientId: id, ...live } }));
  } else if (model === "Lead") {
    add("budgets", await tx.budget.count({ where: { organizationId, leadId: id, ...live } }));
  } else if (model === "Supplier") {
    add("pendingJobs", await tx.supplierJob.count({ where: { supplierId: id, status: "PENDING" } }));
  } else if (model === "Promoter") {
    const now = new Date();
    add(
      "futureTasks",
      await tx.eventTask.count({
        where: {
          promoterId: id,
          completedAt: null,
          event: { organizationId, ...live, status: { not: "CANCELLED" }, OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }] },
        },
      }),
    );
  } else {
    const counts = await tx.budget.findFirst({
      where: { id, organizationId, ...live },
      select: { _count: { select: { signatureRequests: true, payments: true, paymentProofs: true, invoices: true, expectedPayments: { where: { status: "CONFIRMED" } } } } },
    });
    for (const [kind, count] of Object.entries(counts?._count ?? {})) add(kind === "expectedPayments" ? "confirmedExpectedPayments" : kind, count as number);
  }
  if (blockers.length) throw guardError(blockers);
}

export async function trashCrm(model: CrmModel, id: string, reason: string | null, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    const row = await loadLive(tx, model, id, context.organizationId);
    await trash(model, id, reason, context, { tx, label: row.label, guard: (inner) => trashGuard(model, id, context.organizationId, inner) });
  });
}

// ── Definitivo y anonimizar ──────────────────────────────────────────────────

async function loadTrashed(tx: Tx, model: CrmModel, id: string, organizationId: string): Promise<{ label: string; anonymizedAt: Date | null }> {
  const delegate = (tx as unknown as Record<string, { findFirst(args: unknown): Promise<Record<string, unknown> | null> }>)[DELEGATE[model]];
  const row = await delegate.findFirst({
    where: { id, organizationId, deletedAt: undefined },
    select: { [model === "Budget" ? "title" : "name"]: true, deletedAt: true, anonymizedAt: true },
  });
  if (!row) throw new TrashError(`${NOUN[model]} no existe.`, 404);
  if (!row.deletedAt) throw new TrashError("Eliminalo primero: solo se borra definitivamente lo que está en la papelera.", 409);
  return { label: String(model === "Budget" ? row.title : row.name), anonymizedAt: row.anonymizedAt as Date | null };
}

async function lockAny(tx: Tx, model: CrmModel, id: string, organizationId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${TABLE[model]}" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`, id, organizationId);
  if (rows.length === 0) throw new TrashError(`${NOUN[model]} no existe.`, 404);
}

/** Borrado definitivo: bloqueos → 409 `{ blockers }` (el presupuesto no ofrece anonimizar); si no hay, borra la fila. */
export async function purgeCrm(model: CrmModel, id: string, input: PurgeInput, context: AuditContext): Promise<void> {
  const reason = readPurgeReason(input.reason);
  await dbWithDeleted.$transaction(async (tx) => {
    const blockers = await purgeBlockers(model, id, context.organizationId, tx); // FOR UPDATE + 404 ajeno
    const row = await loadTrashed(tx, model, id, context.organizationId);
    if (!namesMatch(input.confirmName, row.label)) throw new TrashError("El nombre escrito no coincide.", 400);
    if (blockers.length) {
      if (model === "Budget") {
        throw new TrashError("Un presupuesto con firma, cobro, comprobante, factura o fuera de borrador no se borra definitivamente: conservalo en la papelera.", 409, blockers);
      }
      throw blockedError(blockers);
    }
    const delegate = (tx as unknown as Record<string, { delete(args: unknown): Promise<unknown> }>)[DELEGATE[model]];
    await delegate.delete({ where: { id } });
    await recordAudit({ context, action: "purge", entity: model, entityId: id, summary: `Borró definitivamente ${NOUN[model].toLowerCase()} «${row.label}»`, detail: { fields: { reason } } }, tx);
  });
}

/** Anonimizar lo eliminado: PII fuera, historial contable intacto. Exige el nombre y el motivo. */
export async function anonymizeCrm(model: CrmModel, id: string, input: PurgeInput, context: AuditContext): Promise<void> {
  const reason = readPurgeReason(input.reason);
  await dbWithDeleted.$transaction(async (tx) => {
    await lockAny(tx, model, id, context.organizationId);
    const row = await loadTrashed(tx, model, id, context.organizationId);
    if (!namesMatch(input.confirmName, row.label)) throw new TrashError("El nombre escrito no coincide.", 400);
    await anonymize(model, id, context, { tx, label: row.label, reason });
  });
}

// ── Despacho de las rutas ────────────────────────────────────────────────────

export async function runCrmAction(model: CrmModel, action: string, id: string, body: Record<string, unknown>, context: AuditContext): Promise<void> {
  if (action === "archive") return archiveCrm(model, id, context);
  if (action === "unarchive") return unarchiveCrm(model, id, context);
  if (action === "trash") return trashCrm(model, id, typeof body.reason === "string" ? body.reason : null, context);
  if (action === "restore") return restore(model, id, context);
  if (action === "purge") return purgeCrm(model, id, { confirmName: body.confirmName, reason: body.reason }, context);
  if (action === "anonymize") return anonymizeCrm(model, id, { confirmName: body.confirmName, reason: body.reason }, context);
  throw new TrashError("Acción desconocida.", 404);
}
