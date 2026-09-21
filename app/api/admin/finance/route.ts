import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const [clientPayments, supplierJobs] = await Promise.all([
    db.clientPayment.findMany({
      where: { organizationId },
      orderBy: { paidAt: "desc" },
      take: 200,
      include: { client: true, budget: true },
    }),
    db.supplierJob.findMany({
      where: { organizationId },
      orderBy: { dueAt: "asc" },
      take: 200,
      include: { supplier: true, event: true },
    }),
  ]);
  return Response.json({ clientPayments, supplierJobs });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  if (body.kind !== "client") return jsonError("Unknown finance entry.", 400);
  if (typeof body.clientId !== "string" || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return jsonError("Client and positive amount are required.", 400);
  const client = await db.client.findFirst({ where: { id: body.clientId, organizationId }, select: { id: true } });
  if (!client) return jsonError("Client not found.", 404);
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  if (budgetId) {
    const budget = await db.budget.findFirst({ where: { id: budgetId, organizationId }, select: { id: true } });
    if (!budget) return jsonError("Budget not found.", 404);
  }
  const payment = await db.clientPayment.create({
    data: {
      id: randomUUID(),
      organizationId,
      clientId: client.id,
      budgetId: budgetId || undefined,
      amount: Number(body.amount),
      method: typeof body.method === "string" ? body.method : undefined,
      reference: typeof body.reference === "string" ? body.reference : undefined,
    },
  });
  return Response.json({ payment }, { status: 201 });
}
