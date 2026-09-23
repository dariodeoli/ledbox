import { randomUUID } from "node:crypto";
import { EventStatus } from "@prisma/client";
import { eventStatusLabel } from "@/lib/admin-format";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { planLimitViolation } from "@/lib/server/plan-limits";
import { dayStart, isValidDayKey, nextDayKey } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_AUDIT_FIELDS = ["name", "location", "city", "startsAt", "endsAt", "setupAt", "status"] as const;

/**
 * Rango por fecha de inicio para el selector (`from`/`to` en `YYYY-MM-DD`, día
 * completo de Asunción). Sin días válidos, `undefined`: el selector trae todos.
 */
function selectorStartsAt(url: URL): { gte?: Date; lt?: Date } | undefined {
  const fromDay = url.searchParams.get("from");
  const toDay = url.searchParams.get("to");
  const from = fromDay && isValidDayKey(fromDay) ? dayStart(fromDay) : null;
  const to = toDay && isValidDayKey(toDay) ? dayStart(nextDayKey(toDay)) : null;
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
}

/**
 * `GET /api/admin/events`: eventos de la empresa activa.
 * `GET ?fields=selector[&from=YYYY-MM-DD&to=YYYY-MM-DD]` (issue #62): opción
 * mínima para los selectores —id, nombre, estado, inicio y cliente—, sin
 * asignaciones ni checklist, y con rango opcional por fecha de inicio. Los
 * eventos sin fecha de inicio quedan fuera al filtrar. Sin `fields=selector` la
 * respuesta es la de siempre (compatible).
 * `POST`: alta con checklist base (`events.write`).
 *
 * `PATCH` (issue #26): cambio de estado del evento desde el tablero, con la
 * misma capacidad (`events.write`) y auditoría. Es un set de estado (idempotente:
 * repetir el mismo estado no toca la fila ni ensucia el historial) y siempre
 * acotado a la empresa activa: un evento de otra empresa responde 404.
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  if (url.searchParams.get("fields") === "selector") {
    const events = await db.event.findMany({
      where: { organizationId: auth.context.organizationId, startsAt: selectorStartsAt(url) },
      orderBy: { startsAt: "asc" },
      take: 300,
      select: {
        id: true,
        name: true,
        startsAt: true,
        status: true,
        clientId: true,
        client: { select: { id: true, name: true, company: true } },
      },
    });
    return Response.json({ events });
  }
  const events = await db.event.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: { client: true, assignments: { include: { inventory: true } }, tasks: true },
  });
  return Response.json({ events });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.clientId !== "string" || typeof body.name !== "string") return jsonError("Client and event name are required.", 400);
  const client = await db.client.findFirst({
    where: { id: body.clientId, organizationId: auth.context.organizationId },
    select: { id: true, name: true },
  });
  if (!client) return jsonError("Client not found.", 404);
  // Límite del plan (issue #42): cuenta los eventos creados en el mes; los
  // eventos ya cargados no se tocan.
  const limit = await planLimitViolation(auth.context, "events");
  if (limit) return jsonError(limit.error, 403, limit.code);
  const event = await db.event.create({
    data: {
      id: randomUUID(),
      organizationId: auth.context.organizationId,
      clientId: client.id,
      name: body.name.trim(),
      location: typeof body.location === "string" ? body.location.trim() : undefined,
      // Ciudad (issue #48): dato aparte del lugar; vacío se guarda como nulo.
      city: typeof body.city === "string" ? body.city.trim() || null : undefined,
      startsAt: typeof body.startsAt === "string" ? new Date(body.startsAt) : undefined,
      endsAt: typeof body.endsAt === "string" ? new Date(body.endsAt) : undefined,
      setupAt: typeof body.setupAt === "string" ? new Date(body.setupAt) : undefined,
      status: "DRAFT",
      tasks: {
        create: [
          { id: randomUUID(), type: "SETUP", title: "Confirmar montaje y acceso al lugar" },
          { id: randomUUID(), type: "EVENT", title: "Verificar equipos y operación del evento" },
          { id: randomUUID(), type: "STRIKE", title: "Coordinar desmontaje y devolución" },
          { id: randomUUID(), type: "COLLECTION", title: "Confirmar cobro / saldo" },
        ],
      },
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Event",
    entityId: event.id,
    summary: `Creó el evento «${event.name}» del cliente «${client.name}»`,
    detail: { fields: auditPick(event, EVENT_AUDIT_FIELDS) },
  });
  return Response.json({ event }, { status: 201 });
}

/** `PATCH /api/admin/events`: estado del evento (issue #26, tablero de eventos). */
export async function PATCH(request: Request) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const body = (await readJson(request)) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return jsonError("Event id is required.", 400);
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
  if (!Object.values(EventStatus).includes(status as EventStatus)) return jsonError("Invalid event status.", 400);

  const event = await db.event.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true, name: true, status: true, client: { select: { name: true } } },
  });
  if (!event) return jsonError("Event not found.", 404);
  if (event.status === status) return Response.json({ event, unchanged: true });

  const updated = await db.event.update({
    where: { id: event.id },
    data: { status: status as EventStatus },
    select: { id: true, name: true, status: true, startsAt: true, endsAt: true },
  });
  const changes = auditChanges({ status: event.status }, { status: updated.status }, ["status"]);
  if (changes) {
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Event",
      entityId: event.id,
      summary: `Cambió el estado del evento «${event.name}» a ${eventStatusLabel(updated.status)}`,
      detail: { changes },
    });
  }
  return Response.json({ event: updated });
}
