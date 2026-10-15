import { sandboxHiddenHere } from "./demo-host";
import { selectionApprovalError } from "../quote-selection";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { quotePortalAvailable } from "../quote-sharing";
import { live } from "@/lib/server/trash-filter";

export class QuoteComparisonError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Lock order is quote, then group. Creation locks all candidate quotes in id order.
 * Every approval entry point shares this lock and persistent, irreversible selection.
 */
export async function guardQuoteApproval(tx: Prisma.TransactionClient, budgetId: string, organizationId: string, token?: string, comparisonToken?: string) {
  await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} FOR UPDATE`;
  const budget = await tx.budget.findUnique({ where: { id: budgetId } });
  if (!budget || budget.organizationId !== organizationId || (token !== undefined && budget.publicToken !== token)) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
  const items = await tx.budgetItem.findMany({ where: { budgetId }, select: { excluded: true } });
  const pending = await tx.budgetChangeRequest.count({ where: { budgetId, kind: "items", status: "pending" } });
  const installments = Array.isArray(budget.installmentsJson) ? budget.installmentsJson : [];
  const committed = budget.advanceAmount + installments.reduce<number>((sum, row) => sum + (row && typeof row === "object" && "amount" in row ? Number(row.amount) || 0 : 0), 0);
  const selectionError = selectionApprovalError(items, pending > 0, committed, budget.total);
  if (selectionError) throw new QuoteComparisonError(409, selectionError);
  if (!budget.comparisonId) return budget;
  await tx.$queryRaw`SELECT "id" FROM "QuoteComparison" WHERE "id" = ${budget.comparisonId} FOR UPDATE`;
  const group = await tx.quoteComparison.findUnique({ where: { id: budget.comparisonId } });
  if (!group || group.organizationId !== organizationId || group.clientId !== budget.clientId) throw new QuoteComparisonError(409, "La comparación no es válida.");
  if (comparisonToken !== undefined && group.publicToken !== comparisonToken) throw new QuoteComparisonError(404, "Comparación no encontrada.");
  if (group.selectedBudgetId && group.selectedBudgetId !== budget.id) throw new QuoteComparisonError(409, "Ya se eligió otra alternativa de esta comparación.");
  if (group.revokedAt || group.expiresAt <= new Date() || !quotePortalAvailable(budget)) throw new QuoteComparisonError(409, "La comparación o el presupuesto ya no están vigentes.");
  if (!group.selectedBudgetId) await tx.quoteComparison.update({ where: { id: group.id }, data: { selectedBudgetId: budget.id, selectedAt: new Date() } });
  return budget;
}

export async function withQuoteApproval<T>(budgetId: string, organizationId: string, write: (tx: Prisma.TransactionClient) => Promise<T>, token?: string): Promise<T> {
  return db.$transaction(async (tx) => {
    await guardQuoteApproval(tx, budgetId, organizationId, token);
    return write(tx);
  });
}

export async function findPublicComparison(token: string) {
  const group = await db.quoteComparison.findUnique({ where: { publicToken: token }, include: { budgets: { where: live, orderBy: { comparisonLabel: "asc" } } } });
  if (group && (await sandboxHiddenHere(group.organizationId))) return null;
  if (!group || group.revokedAt || group.expiresAt <= new Date() || group.budgets.length < 2 || group.budgets.length > 4) return null;
  if (group.budgets.some((q) => q.organizationId !== group.organizationId || q.clientId !== group.clientId || !quotePortalAvailable(q))) return null;
  return group;
}

/** Commercial edits and grouped signing serialize on the same quote row.
 * Recheck approval after waiting: an edit that loses the race must not alter
 * the terms that have just been signed. Internal cost-only edits stay allowed.
 */
export async function withQuoteCommercialEdit<T>(budgetId: string, organizationId: string, commercial: boolean, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} FOR UPDATE`;
    const budget = await tx.budget.findUnique({ where: { id: budgetId } });
    if (!budget || budget.organizationId !== organizationId) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
    if (commercial && (budget.status === "LOST" || budget.status === "CANCELLED")) throw new QuoteComparisonError(409, "El presupuesto está cerrado: sus condiciones no se pueden cambiar.");
    if (commercial && (budget.approvedAt || budget.status === "APPROVED")) throw new QuoteComparisonError(409, "La alternativa ya está aprobada: sus condiciones no se pueden cambiar.");
    if (commercial && await tx.signatureRequest.count({ where: { budgetId, status: { in: ["SIGNED", "VALIDATED"] } } })) throw new QuoteComparisonError(409, "El presupuesto ya está firmado: sus condiciones no se pueden cambiar.");
    return write(tx);
  });
}
