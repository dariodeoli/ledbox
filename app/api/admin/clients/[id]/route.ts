import { isOverdue } from "@/lib/admin-format";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { clientMetrics } from "../metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/clients/[id]`: ficha 360 del cliente (issue #34) de la empresa
 * activa. Devuelve el cliente con sus métricas reales y los tres hechos que las
 * explican: presupuestos con lo cobrado y lo vencido por presupuesto, eventos
 * con su checklist y cobros con su estado y vencimiento.
 *
 * Es lectura para cualquier rol (VIEWER incluido) y el aislamiento es el de
 * siempre: un id de otra empresa no existe para esta consulta (404). La
 * cronología (issue #33) se enchufa después sobre estos mismos hechos.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { events: true, budgets: true } } },
  });
  if (!client) return jsonError("No encontramos ese cliente en la empresa activa.", 404);

  const [budgets, events, payments] = await Promise.all([
    db.budget.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        total: true,
        createdAt: true,
        validUntil: true,
        approvedAt: true,
        approvalMethod: true,
        event: { select: { id: true, name: true, startsAt: true, status: true } },
      },
    }),
    db.event.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        name: true,
        location: true,
        startsAt: true,
        endsAt: true,
        status: true,
        createdAt: true,
        tasks: {
          select: { id: true, title: true, type: true, dueAt: true, completedAt: true },
          orderBy: { dueAt: "asc" },
        },
      },
    }),
    db.clientPayment.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        status: true,
        paidAt: true,
        collectedAt: true,
        method: true,
        reference: true,
        budgetId: true,
        invoiceNumber: true,
        invoiceIssuedAt: true,
        dueAt: true,
        chequeDate: true,
        createdAt: true,
        budget: { select: { id: true, title: true } },
      },
    }),
  ]);

  // Cobrado y vencido por presupuesto: mismos cobros que alimentan las métricas
  // del cliente, imputados a su presupuesto cuando lo tienen.
  const byBudget = new Map<string, { collected: number; overdue: number }>();
  for (const payment of payments) {
    if (!payment.budgetId) continue;
    const current = byBudget.get(payment.budgetId) ?? { collected: 0, overdue: 0 };
    if (payment.status === "RECEIVED") current.collected += payment.amount;
    if (payment.status === "PENDING" && isOverdue(payment.dueAt)) current.overdue += payment.amount;
    byBudget.set(payment.budgetId, current);
  }

  const metrics = clientMetrics({ budgets, payments, events });

  return Response.json({
    clientDetail: {
      client,
      metrics,
      budgets: budgets.map((budget) => ({
        ...budget,
        collected: byBudget.get(budget.id)?.collected ?? 0,
        overdue: byBudget.get(budget.id)?.overdue ?? 0,
      })),
      events,
      payments,
    },
  });
}
