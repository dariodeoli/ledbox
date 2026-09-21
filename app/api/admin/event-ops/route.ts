import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const events = await db.event.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: { client: true, tasks: { orderBy: { dueAt: "asc" } }, assignments: { include: { inventory: true } } },
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
    const event = await db.event.findFirst({ where: { id: body.eventId, organizationId }, select: { id: true } });
    if (!event) return jsonError("Event not found.", 404);
    const task = await db.eventTask.create({
      data: {
        id: randomUUID(),
        eventId: event.id,
        title: body.title.trim(),
        type: typeof body.type === "string" ? body.type as never : "EVENT",
        dueAt: typeof body.dueAt === "string" ? new Date(body.dueAt) : undefined,
      },
    });
    return Response.json({ task }, { status: 201 });
  }

  if (kind === "toggle") {
    if (typeof body.id !== "string") return jsonError("Task id is required.", 400);
    const existing = await db.eventTask.findFirst({ where: { id: body.id, event: { organizationId } }, select: { id: true } });
    if (!existing) return jsonError("Task not found.", 404);
    const task = await db.eventTask.update({
      where: { id: existing.id },
      data: { completedAt: body.completed ? new Date() : null },
    });
    return Response.json({ task });
  }

  if (kind === "assignment") {
    if (typeof body.eventId !== "string" || typeof body.inventoryId !== "string") return jsonError("Event and inventory are required.", 400);
    const [event, inventory] = await Promise.all([
      db.event.findFirst({ where: { id: body.eventId, organizationId }, select: { id: true } }),
      db.inventoryItem.findFirst({ where: { id: body.inventoryId, organizationId }, select: { id: true } }),
    ]);
    if (!event) return jsonError("Event not found.", 404);
    if (!inventory) return jsonError("Inventory item not found.", 404);
    const quantity = Math.max(1, Number(body.quantity || 1));
    const assignment = await db.eventInventory.upsert({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: inventory.id } },
      create: { id: randomUUID(), eventId: event.id, inventoryId: inventory.id, quantity },
      update: { quantity },
    });
    return Response.json({ assignment }, { status: 201 });
  }

  if (kind === "checkin") {
    if (typeof body.id !== "string") return jsonError("Assignment id is required.", 400);
    const existing = await db.eventInventory.findFirst({ where: { id: body.id, event: { organizationId } }, select: { id: true } });
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
    return Response.json({ assignment });
  }

  return jsonError("Unknown operation.", 400);
}
