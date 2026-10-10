import type { Prisma } from "@prisma/client";
import { budgetPlanLedgerError, hasDynamicBudgetPlan, resolveBudgetPaymentPlan } from "../budget-payment-plan";
import { QuoteComparisonError } from "./quote-comparison";
import { syncBudgetExpectedPayments } from "./expected-payments";

/** Called inside the same quote-row lock as every commercial edit. */
export async function recalculateBudgetPaymentPlan(tx: Prisma.TransactionClient, budgetId: string) {
  const budget = await tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { organizationId: true, total: true, advanceAmount: true, installmentsJson: true } });
  const result = resolveBudgetPaymentPlan(budget.installmentsJson, budget.total, budget.advanceAmount);
  // null was the historical no-plan representation.
  if (budget.installmentsJson === null) { await assertBudgetPlanLedger(tx, budgetId, budget.total, budget.advanceAmount, []); await syncBudgetExpectedPayments({ tx, budgetId, organizationId: budget.organizationId }); return; }
  if (!result.ok) throw new QuoteComparisonError(400, result.error);
  await assertBudgetPlanLedger(tx, budgetId, budget.total, budget.advanceAmount, result.rows);
  if (hasDynamicBudgetPlan(budget.installmentsJson)) await tx.budget.update({ where: { id: budgetId }, data: { installmentsJson: result.rows as unknown as Prisma.InputJsonValue } });
  await syncBudgetExpectedPayments({ tx, budgetId, organizationId: budget.organizationId });
}

export async function assertBudgetPlanLedger(tx: Prisma.TransactionClient, budgetId: string, total: number, advance: number, rows: Array<{ amount: number }>) {
  const desired = rows.map((row, index) => ({ slot: `installment:${index + 1}`, amount: row.amount }));
  if (advance > 0) desired.push({ slot: "advance", amount: advance });
  const remaining = total - advance - rows.reduce((sum, row) => sum + row.amount, 0);
  if (remaining > 0) desired.push({ slot: "balance", amount: remaining });
  await tx.$queryRaw`SELECT "id" FROM "ExpectedPayment" WHERE "budgetId" = ${budgetId} ORDER BY "id" FOR UPDATE`;
  const existing = await tx.expectedPayment.findMany({ where: { budgetId } });
  const error = budgetPlanLedgerError(desired, existing);
  if (error) throw new QuoteComparisonError(409, error);
  const collected = await tx.clientPayment.aggregate({ where: { budgetId, status: "RECEIVED" }, _sum: { amount: true } });
  if ((collected._sum.amount ?? 0) > total) throw new QuoteComparisonError(409, "El total no puede quedar por debajo del dinero ya cobrado. Usá el ciclo de revisión.");
}

export async function validateBudgetPlanAccounts(tx: Prisma.TransactionClient, organizationId: string, rows: Array<{ accountId?: string | null }>) {
  const ids = [...new Set(rows.flatMap((row) => row.accountId ? [row.accountId] : []))];
  const count = await tx.treasuryAccount.count({ where: { id: { in: ids }, organizationId, active: true, currency: "PYG" } });
  if (count !== ids.length) throw new QuoteComparisonError(400, "La cuenta de cobro debe estar activa, ser PYG y pertenecer a esta empresa.");
}
