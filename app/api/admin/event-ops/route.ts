import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Promotora embebida en una tarea: nombre y disponibilidad real (issue #24). */
const promoterSelect = {
  promoter: { select: { id: true, name: true, availability: true, availabilityNote: true, unavailableUntil: true } },
} as const;

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const events = await db.event.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: {
      client: true,
      tasks: { orderBy: { dueAt: "asc" }, include: promoterSelect },
      assignments: { include: { inventory: true } },
    },
  });
  return Response.json({ events });
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
    const [event, inventory] = await Promise.all([
      db.event.findFirst({ where: { id: body.eventId, organizationId }, select: { id: true, name: true } }),
      db.inventoryItem.findFirst({ where: { id: body.inventoryId, organizationId }, select: { id: true, name: true } }),
    ]);
    if (!event) return jsonError("Event not found.", 404);
    if (!inventory) return jsonError("Inventory item not found.", 404);
    const quantity = Math.max(1, Number(body.quantity || 1));
    const previous = await db.eventInventory.findUnique({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: inventory.id } },
      select: { id: true, quantity: true },
    });
    const assignment = await db.eventInventory.upsert({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: inventory.id } },
      create: { id: randomUUID(), eventId: event.id, inventoryId: inventory.id, quantity },
      update: { quantity },
    });
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
