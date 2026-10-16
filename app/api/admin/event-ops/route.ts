import { CLIENT_IDENTITY_SELECT, clientIdentityDTO } from "@/lib/server/client-identity";
import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { commitInventoryAssignment, insufficientMessage, isComboAssignment, loadRentalSettings, resolveRentalBuffers } from "@/lib/server/inventory-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Promotora embebida en una tarea: nombre y disponibilidad real (issue #24). */
const promoterSelect = {
  promoter: { select: { id: true, name: true, availability: true, availabilityNote: true, unavailableUntil: true } },
} as const;

/**
 * Suma `cleaningUntil` a cada asignación devuelta: mientras dura el colchón de
 * limpieza/revisión del ítem, lo devuelto no vuelve a lo libre. `null` si no aplica.
 */
async function withCleaning<E extends { assignments: Array<{ checkedInAt: Date | null; inventory: { bufferBeforeMin: number | null; bufferAfterMin: number | null } }> }>(organizationId: string, events: E[]) {
  const settings = await loadRentalSettings(organizationId);
  const now = Date.now();
  return events.map((event) => ({
    ...event,
    assignments: event.assignments.map((assignment) => {
      const after = resolveRentalBuffers(settings, assignment.inventory).afterMin;
      const until = assignment.checkedInAt && after > 0 ? new Date(assignment.checkedInAt.getTime() + after * 60_000) : null;
      return { ...assignment, cleaningUntil: until && until.getTime() > now ? until : null };
    }),
  }));
}

/**
 * Eventos del panel con su operación (checklist y equipos).
 *
 * `GET ?fields=checklist` (issue #68): lo mínimo del checklist del dashboard
 * —id, nombre y tareas—, sin cliente, equipos ni la disponibilidad de la
 * promotora. `GET ?fields=panel` (issue #68): el evento del panel de operación
 * con identidad comercial común (sin bytes ni contactos privados), teléfono
 * operativo existente y las tareas y
 * asignaciones completas. Sin `fields` la respuesta es la de siempre
 * (compatible).
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const fields = new URL(request.url).searchParams.get("fields");

  if (fields === "checklist") {
    const events = await db.event.findMany({
      where: { organizationId },
      orderBy: { startsAt: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        tasks: {
          orderBy: { dueAt: "asc" },
          select: { id: true, eventId: true, title: true, type: true, dueAt: true, completedAt: true },
        },
      },
    });
    return Response.json({ events });
  }

  if (fields === "panel") {
    const events = await db.event.findMany({
      where: { organizationId },
      orderBy: { startsAt: "asc" },
      take: 200,
      include: {
        client: { select: { ...CLIENT_IDENTITY_SELECT, phone: true } },
        tasks: { orderBy: { dueAt: "asc" }, include: promoterSelect },
        assignments: { include: { inventory: { include: { _count: { select: { components: true } } } } } },
      },
    });
    return Response.json({ events: await withCleaning(organizationId, events.map(event => ({ ...event, client: clientIdentityDTO(event.client) }))) });
  }

  const events = await db.event.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: {
      client: true,
      tasks: { orderBy: { dueAt: "asc" }, include: promoterSelect },
      assignments: { include: { inventory: { include: { _count: { select: { components: true } } } } } },
    },
  });
  return Response.json({ events: await withCleaning(organizationId, events) });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "task") {
    if (typeof body.eventId !== "string" || typeof body.title !== "string") return jsonError("Event and title are required.", 400);
    const event = await db.event.findFirst({ where: { id: body.eventId, organizationId }, select: { id: true, name: true } });
    if (!event) return jsonError("Event not found.", 404);
    // Promotora opcional (issue #24): se valida que sea de la empresa activa; la
    // disponibilidad no bloquea la asignación, la app la avisa en el panel.
    const promoterId = typeof body.promoterId === "string" && body.promoterId ? body.promoterId : null;
    if (promoterId) {
      const promoter = await db.promoter.findFirst({ where: { id: promoterId, organizationId }, select: { id: true } });
      if (!promoter) return jsonError("Promoter not found.", 404);
    }
    const task = await db.eventTask.create({
      data: {
        id: randomUUID(),
        eventId: event.id,
        title: body.title.trim(),
        type: typeof body.type === "string" ? body.type as never : "EVENT",
        dueAt: typeof body.dueAt === "string" ? new Date(body.dueAt) : undefined,
        promoterId,
      },
      include: promoterSelect,
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "EventTask",
      entityId: task.id,
      summary: `Agregó la tarea «${task.title}» al evento «${event.name}»`,
      detail: { fields: { ...auditPick(task, ["title", "type", "dueAt", "promoterId"]), eventId: event.id } },
    });
    return Response.json({ task }, { status: 201 });
  }

  if (kind === "toggle") {
    if (typeof body.id !== "string") return jsonError("Task id is required.", 400);
    const existing = await db.eventTask.findFirst({
      where: { id: body.id, event: { organizationId } },
      select: { id: true, title: true, completedAt: true, event: { select: { id: true, name: true } } },
    });
    if (!existing) return jsonError("Task not found.", 404);
    const task = await db.eventTask.update({
      where: { id: existing.id },
      data: { completedAt: body.completed ? new Date() : null },
    });
    const changes = auditChanges({ completedAt: existing.completedAt }, { completedAt: task.completedAt }, ["completedAt"]);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "status",
        entity: "EventTask",
        entityId: task.id,
        summary: `${task.completedAt ? "Marcó como completada" : "Reabrió"} la tarea «${task.title}» del evento «${existing.event.name}»`,
        detail: { changes },
      });
    }
    return Response.json({ task });
  }

  if (kind === "assignment") {
    if (typeof body.eventId !== "string" || typeof body.inventoryId !== "string") return jsonError("Event and inventory are required.", 400);
    const quantity = Number(body.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) return jsonError("La cantidad debe ser un entero mayor a cero.", 400);
    // Misma validación atómica que la asignación manual de inventario: sin esto
    // event-ops sobrevendía stock. El rango propio de la fila no se toca.
    const committed = await commitInventoryAssignment({
      organizationId,
      eventId: body.eventId,
      inventoryId: body.inventoryId,
      quantity,
    });
    if (!committed.ok) {
      if (committed.reason === "event-missing") return jsonError("Event not found.", 404);
      if (committed.reason === "item-missing") return jsonError("Inventory item not found.", 404);
      if (committed.reason === "blocked") {
        return jsonError(`«${committed.item.name}» está ${committed.item.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`, 409);
      }
      if (committed.reason === "conflict") return jsonError(committed.message, 409);
      return Response.json({ error: insufficientMessage(committed), availability: committed.availability }, { status: 409 });
    }
    const { assignment, previous, item: inventory, event } = committed;
    const changes = previous
      ? auditChanges({ quantity: previous.quantity }, { quantity: assignment.quantity }, ["quantity"])
      : null;
    if (!previous) {
      await recordAudit({
        context: auth.context,
        action: "create",
        entity: "EventInventory",
        entityId: assignment.id,
        summary: `Asignó «${inventory.name}» a «${event.name}» (${quantity} unidad${quantity === 1 ? "" : "es"})`,
        detail: { fields: { eventId: event.id, inventoryId: inventory.id, quantity: assignment.quantity } },
      });
    } else if (changes) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "EventInventory",
        entityId: assignment.id,
        summary: `Actualizó la asignación de «${inventory.name}» en «${event.name}»`,
        detail: { changes, fields: { eventId: event.id, inventoryId: inventory.id } },
      });
    }
    return Response.json({ assignment }, { status: 201 });
  }

  if (kind === "checkin") {
    if (typeof body.id !== "string") return jsonError("Assignment id is required.", 400);
    const existing = await db.eventInventory.findFirst({
      where: { id: body.id, event: { organizationId } },
      select: {
        id: true,
        checkedOut: true,
        checkedIn: true,
        conditionOut: true,
        conditionIn: true,
        inventory: { select: { name: true } },
        event: { select: { name: true } },
      },
    });
    if (!existing) return jsonError("Assignment not found.", 404);
    if (await isComboAssignment({ organizationId, assignmentId: existing.id })) {
      return jsonError("Un combo no sale ni vuelve como unidad: registrá el movimiento de cada componente.", 409);
    }
    const assignment = await db.eventInventory.update({
      where: { id: existing.id },
      data: {
        checkedOut: typeof body.checkedOut === "boolean" ? body.checkedOut : undefined,
        checkedIn: typeof body.checkedIn === "boolean" ? body.checkedIn : undefined,
        conditionOut: typeof body.conditionOut === "string" ? body.conditionOut : undefined,
        conditionIn: typeof body.conditionIn === "string" ? body.conditionIn : undefined,
      },
    });
    const changes = auditChanges(
      existing,
      assignment,
      ["checkedOut", "checkedIn", "conditionOut", "conditionIn"],
    );
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "status",
        entity: "EventInventory",
        entityId: assignment.id,
        summary: `Actualizó el movimiento de «${existing.inventory.name}» en «${existing.event.name}»`,
        detail: { changes },
      });
    }
    return Response.json({ assignment });
  }

  return jsonError("Unknown operation.", 400);
}
