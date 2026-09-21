import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const now = new Date();
  const [clients, budgets, events, suppliers, inventory, promoters, leads, receivables, pendingCollections, payables, upcoming] = await Promise.all([
    db.client.count({ where: { organizationId, active: true } }),
    db.budget.count({ where: { organizationId, status: { notIn: ["LOST", "CANCELLED"] } } }),
    db.event.count({ where: { organizationId, status: { not: "CANCELLED" } } }),
    db.supplier.count({ where: { organizationId, active: true } }),
    db.inventoryItem.count({ where: { organizationId, status: { not: "RETIRED" } } }),
    db.promoter.count({ where: { organizationId, active: true } }),
    db.lead.count({ where: { organizationId, status: "NEW" } }),
    // Solo los cobros cobrados descuentan el saldo (issue #16): un cobro a plazo
    // pendiente es parte de lo que queda por cobrar, no plata cobrada.
    db.budget.findMany({
      where: { organizationId, status: { in: ["APPROVED", "SENT", "NEGOTIATING"] } },
      select: { total: true, payments: { where: { status: "RECEIVED" }, select: { amount: true } } },
    }),
    // Cobros a plazo pendientes sin presupuesto: se suman como por cobrar. Los
    // que sí tienen presupuesto ya viven en el saldo del presupuesto (si se
    // sumaran acá se contarían dos veces).
    db.clientPayment.findMany({ where: { organizationId, status: "PENDING", budgetId: null }, select: { amount: true } }),
    db.supplierJob.findMany({ where: { organizationId, status: { notIn: ["PAID", "CANCELLED"] } }, select: { total: true, advance: true } }),
    db.event.findMany({
      where: { organizationId, startsAt: { gte: now }, status: { not: "CANCELLED" } },
      orderBy: { startsAt: "asc" },
      take: 8,
      include: { client: { select: { name: true, company: true } }, assignments: { include: { inventory: true } }, tasks: true },
    }),
  ]);
  const totalReceivable =
    receivables.reduce((sum, b) => sum + Math.max(0, b.total - b.payments.reduce((s, p) => s + p.amount, 0)), 0) +
    pendingCollections.reduce((sum, payment) => sum + payment.amount, 0);
  const totalPayable = payables.reduce((sum, job) => sum + Math.max(0, job.total - job.advance), 0);
  return Response.json({ counts: { clients, budgets, events, suppliers, inventory, promoters, leads }, finance: { totalReceivable, totalPayable, committedCash: totalReceivable + totalPayable }, upcoming });
}
