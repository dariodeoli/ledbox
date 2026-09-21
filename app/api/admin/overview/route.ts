import { requireAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return jsonError("Unauthorized", 401);
  const now = new Date();
  const [clients, budgets, events, suppliers, inventory, promoters, leads, receivables, payables, upcoming] = await Promise.all([
    db.client.count({ where: { active: true } }),
    db.budget.count({ where: { status: { notIn: ["LOST", "CANCELLED"] } } }),
    db.event.count({ where: { status: { not: "CANCELLED" } } }),
    db.supplier.count({ where: { active: true } }),
    db.inventoryItem.count({ where: { status: { not: "RETIRED" } } }),
    db.promoter.count({ where: { active: true } }),
    db.lead.count({ where: { status: "NEW" } }),
    db.budget.findMany({ where: { status: { in: ["APPROVED", "SENT", "NEGOTIATING"] } }, select: { total: true, payments: { select: { amount: true } } } }),
    db.supplierJob.findMany({ where: { status: { notIn: ["PAID", "CANCELLED"] } }, select: { total: true, advance: true } }),
    db.event.findMany({ where: { startsAt: { gte: now }, status: { not: "CANCELLED" } }, orderBy: { startsAt: "asc" }, take: 8, include: { client: { select: { name: true, company: true } }, assignments: { include: { inventory: true } }, tasks: true } }),
  ]);
  const totalReceivable = receivables.reduce((sum, b) => sum + Math.max(0, b.total - b.payments.reduce((s, p) => s + p.amount, 0)), 0);
  const totalPayable = payables.reduce((sum, job) => sum + Math.max(0, job.total - job.advance), 0);
  return Response.json({ counts: { clients, budgets, events, suppliers, inventory, promoters, leads }, finance: { totalReceivable, totalPayable, committedCash: totalReceivable + totalPayable }, upcoming });
}
