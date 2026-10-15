import { CommercialStatus } from "@prisma/client";
import { db } from "@/lib/server/db";
import { rentalBalancePaymentFilter } from "@/lib/payment-origin";
import type { EventBudgetSummary } from "@/lib/event-readiness";

/**
 * Lectura liviana de la seña por evento (rediseño de Eventos). Reemplaza bajar
 * `/api/admin/budgets` (con tope de 200 filas) solo para saber si la seña entró.
 *
 * Todo acotado por empresa; el cobrado se agrega en la base (suma de cobros
 * `RECEIVED`) y no hay tope sobre los eventos pedidos.
 */
export type EventReadinessRow = EventBudgetSummary;

type BudgetCandidate = { id: string; eventId: string | null; status: CommercialStatus; createdAt: Date };

/** El presupuesto aprobado manda; si no hay, el más reciente (misma regla que el panel). */
export function pickEventBudgets<T extends BudgetCandidate>(budgets: readonly T[]): Map<string, T> {
  const picked = new Map<string, T>();
  for (const budget of budgets) {
    if (!budget.eventId) continue;
    const current = picked.get(budget.eventId);
    const better =
      !current ||
      (current.status !== "APPROVED" && budget.status === "APPROVED") ||
      ((current.status === "APPROVED") === (budget.status === "APPROVED") && budget.createdAt.getTime() > current.createdAt.getTime());
    if (better) picked.set(budget.eventId, budget);
  }
  return picked;
}

/**
 * `eventIds` = null lee todos los eventos de la empresa. Un id de otra empresa
 * (o inexistente) no aparece en la respuesta: no se filtra nada ajeno.
 */
export async function loadEventReadiness(organizationId: string, eventIds: readonly string[] | null): Promise<EventReadinessRow[]> {
  const events = await db.event.findMany({
    where: { organizationId, ...(eventIds ? { id: { in: [...eventIds] } } : {}) },
    select: { id: true },
  });
  if (events.length === 0) return [];
  const ids = events.map((event) => event.id);
  const budgets = await db.budget.findMany({
    where: { organizationId, eventId: { in: ids } },
    select: { id: true, eventId: true, status: true, createdAt: true, advanceAmount: true, title: true, total: true },
  });
  const picked = pickEventBudgets(budgets);
  const budgetIds = [...picked.values()].map((budget) => budget.id);
  const sums = budgetIds.length
    ? await db.clientPayment.groupBy({
        by: ["budgetId"],
        where: { organizationId, budgetId: { in: budgetIds }, status: "RECEIVED", ...rentalBalancePaymentFilter },
        _sum: { amount: true },
      })
    : [];
  const collectedBy = new Map(sums.map((row) => [row.budgetId, row._sum.amount ?? 0]));
  return ids.map((eventId) => {
    const budget = picked.get(eventId);
    return {
      eventId,
      budgetId: budget?.id ?? null,
      hasBudget: Boolean(budget),
      advanceAmount: budget?.advanceAmount ?? 0,
      collected: budget ? collectedBy.get(budget.id) ?? 0 : 0,
      title: budget?.title ?? null,
      status: budget?.status ?? null,
      total: budget?.total ?? null,
    };
  });
}
