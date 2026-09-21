import { randomUUID } from "node:crypto";
import { requireAdminRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const canWrite = ["OWNER", "ADMIN", "OPERATIONS"] as const;

export async function GET() {
  if (!(await requireAdminRole(["OWNER", "ADMIN", "OPERATIONS", "FINANCE", "VIEWER"]))) return jsonError("Unauthorized", 401);
  const events = await db.event.findMany({ orderBy: { startsAt: "asc" }, take: 200, include: { client: true, tasks: { orderBy: { dueAt: "asc" } }, assignments: { include: { inventory: true } } } });
  return Response.json({ events });
}

export async function POST(request: Request) {
  if (!(await requireAdminRole([...canWrite]))) return jsonError("Unauthorized", 401);
  const body = await readJson(request) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (kind === "task") {
    if (typeof body.eventId !== "string" || typeof body.title !== "string") return jsonError("Event and title are required.", 400);
    const task = await db.eventTask.create({ data: { id: randomUUID(), eventId: body.eventId, title: body.title.trim(), type: typeof body.type === "string" ? body.type as never : "EVENT", dueAt: typeof body.dueAt === "string" ? new Date(body.dueAt) : undefined } });
    return Response.json({ task }, { status: 201 });
  }
  if (kind === "toggle") {
    if (typeof body.id !== "string") return jsonError("Task id is required.", 400);
    const task = await db.eventTask.update({ where: { id: body.id }, data: { completedAt: body.completed ? new Date() : null } });
    return Response.json({ task });
  }
  if (kind === "assignment") {
    if (typeof body.eventId !== "string" || typeof body.inventoryId !== "string") return jsonError("Event and inventory are required.", 400);
    const assignment = await db.eventInventory.upsert({ where: { eventId_inventoryId: { eventId: body.eventId, inventoryId: body.inventoryId } }, create: { id: randomUUID(), eventId: body.eventId, inventoryId: body.inventoryId, quantity: Math.max(1, Number(body.quantity || 1)) }, update: { quantity: Math.max(1, Number(body.quantity || 1)) } });
    return Response.json({ assignment }, { status: 201 });
  }
  if (kind === "checkin") {
    if (typeof body.id !== "string") return jsonError("Assignment id is required.", 400);
    const assignment = await db.eventInventory.update({ where: { id: body.id }, data: { checkedOut: typeof body.checkedOut === "boolean" ? body.checkedOut : undefined, checkedIn: typeof body.checkedIn === "boolean" ? body.checkedIn : undefined, conditionOut: typeof body.conditionOut === "string" ? body.conditionOut : undefined, conditionIn: typeof body.conditionIn === "string" ? body.conditionIn : undefined } });
    return Response.json({ assignment });
  }
  return jsonError("Unknown operation.", 400);
}
