import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return jsonError("Unauthorized", 401);
  const [clientPayments, supplierJobs] = await Promise.all([
    db.clientPayment.findMany({ orderBy: { paidAt: "desc" }, take: 200, include: { client: true, budget: true } }),
    db.supplierJob.findMany({ orderBy: { dueAt: "asc" }, take: 200, include: { supplier: true, event: true } }),
  ]);
  return Response.json({ clientPayments, supplierJobs });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return jsonError("Unauthorized", 401);
  const body = await readJson(request) as Record<string, unknown>;
  if (body.kind === "client") {
    if (typeof body.clientId !== "string" || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return jsonError("Client and positive amount are required.", 400);
    return Response.json({ payment: await db.clientPayment.create({ data: { id: randomUUID(), clientId: body.clientId, budgetId: typeof body.budgetId === "string" ? body.budgetId : undefined, amount: Number(body.amount), method: typeof body.method === "string" ? body.method : undefined, reference: typeof body.reference === "string" ? body.reference : undefined } }) }, { status: 201 });
  }
  if (body.kind === "supplier") {
    if (typeof body.supplierId !== "string" || typeof body.description !== "string" || !Number.isFinite(Number(body.total))) return jsonError("Supplier, description and total are required.", 400);
    return Response.json({ job: await db.supplierJob.create({ data: { id: randomUUID(), supplierId: body.supplierId, eventId: typeof body.eventId === "string" ? body.eventId : undefined, category: "OTHER", description: body.description.trim(), total: Number(body.total), advance: Number(body.advance || 0), status: Number(body.advance || 0) > 0 ? "ADVANCE_PAID" : "PENDING" } }) }, { status: 201 });
  }
  return jsonError("Unknown finance entry.", 400);
}
