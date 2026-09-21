import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return jsonError("Unauthorized", 401);
  const budgets = await db.budget.findMany({
    orderBy: { createdAt: "desc" }, take: 200,
    include: { client: true, event: true, items: true, payments: true },
  });
  return Response.json({ budgets });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return jsonError("Unauthorized", 401);
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.clientId !== "string" || typeof body.title !== "string") return jsonError("Client and title are required.", 400);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const quantity = Number(value.quantity || 1);
    const days = Number(value.days || 1);
    const unitPrice = Number(value.unitPrice || 0);
    const costPrice = Number(value.costPrice || 0);
    if (!name || !Number.isFinite(quantity) || !Number.isFinite(days) || !Number.isFinite(unitPrice)) return [];
    return [{ id: randomUUID(), name, quantity: Math.max(1, quantity), days: Math.max(1, days), unitPrice: Math.max(0, unitPrice), costPrice: Math.max(0, costPrice), subtotal: Math.max(0, quantity * days * unitPrice) }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Math.max(0, Number(body.discount || 0));
  const total = Math.max(0, subtotal - discount);
  const costEstimate = items.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  const budget = await db.budget.create({ data: { id: randomUUID(), clientId: body.clientId, eventId: typeof body.eventId === "string" ? body.eventId : undefined, title: body.title.trim(), status: "DRAFT", subtotal, discount, total, costEstimate, notes: typeof body.notes === "string" ? body.notes.trim() : undefined, items: { create: items } }, include: { client: true, event: true, items: true } });
  return Response.json({ budget }, { status: 201 });
}
