import { Prisma } from "@prisma/client";
import { budgetCommercialInputSchema, budgetCommercialTermsSchema, budgetItemCommercialInputSchema, budgetItemCommercialTermsSchema, budgetTariffSnapshotRetentionError } from "../budget-commercial-contract";
import { BudgetCalculationError, calculateBudgetCommercial } from "../budget-commercial-calculation";
import { QuoteComparisonError } from "./quote-comparison";

const itemKeys = ["priceMode", "tariffSnapshot", "discountMode", "discountValue"] as const;
const budgetKeys = ["discountMode", "discountValue", "advancePercentBps"] as const;
const picked = (body: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
function invalid(message: string): never { throw new QuoteComparisonError(400, message); }

/** Called under the same commercial lock as item editing. Snapshot input is never trusted. */
export async function mergeBudgetItemTerms(tx: Prisma.TransactionClient, id: string, organizationId: string, body: Record<string, unknown>) {
  if (Object.hasOwn(body, "discountAmount")) invalid("El descuento efectivo se calcula en el servidor.");
  const parsed = budgetItemCommercialInputSchema.safeParse(picked(body, itemKeys));
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Términos de línea inválidos.");
  const previous = await tx.budgetItem.findUniqueOrThrow({ where: { id } });
  const old = { priceMode: previous.priceMode, tariffSnapshot: previous.tariffSnapshot, discountMode: previous.discountMode, discountValue: previous.discountValue, discountAmount: previous.discountAmount };
  const oldSnapshot = budgetItemCommercialTermsSchema.safeParse(old).data?.tariffSnapshot;
  const next = { ...old, ...parsed.data };
  if (Object.hasOwn(body, "tariffSnapshot") && parsed.data.tariffSnapshot !== null && JSON.stringify(parsed.data.tariffSnapshot) !== JSON.stringify(oldSnapshot)) {
    const inventory = previous.inventoryId ? await tx.inventoryItem.findFirst({ where: { id: previous.inventoryId, organizationId } }) : null;
    if (!inventory) invalid("La tarifa requiere un producto de esta empresa.");
    const front = parsed.data.tariffSnapshot!.front;
    next.tariffSnapshot = { version: 1, front, normalPrice: front === "FINAL" ? inventory.listPrice : inventory.wholesalePrice, fromDays: front === "FINAL" ? inventory.listFromDays : inventory.wholesaleFromDays, fromPrice: front === "FINAL" ? inventory.listFromPrice : inventory.wholesaleFromPrice, minimumPrice: inventory.minimumPrice };
  }
  next.discountAmount = next.discountMode === null ? null : previous.discountAmount ?? 0;
  const full = budgetItemCommercialTermsSchema.safeParse(next);
  const prior = budgetItemCommercialTermsSchema.safeParse(old);
  if (!full.success || !prior.success) invalid("Términos comerciales de línea inconsistentes.");
  const retentionError = budgetTariffSnapshotRetentionError(prior.data, full.data);
  if (retentionError) invalid(retentionError);
  await tx.budgetItem.update({ where: { id }, data: { ...full.data, tariffSnapshot: full.data.tariffSnapshot === null ? Prisma.DbNull : full.data.tariffSnapshot } });
}

export async function mergeBudgetTerms(tx: Prisma.TransactionClient, id: string, body: Record<string, unknown>) {
  const patch = budgetCommercialInputSchema.safeParse(picked(body, budgetKeys));
  if (!patch.success) invalid(patch.error.issues[0]?.message ?? "Condiciones comerciales inválidas.");
  const previous = await tx.budget.findUniqueOrThrow({ where: { id } });
  const terms = budgetCommercialTermsSchema.safeParse({ discountMode: previous.discountMode, discountValue: previous.discountValue, advancePercentBps: previous.advancePercentBps, ...patch.data });
  if (!terms.success) invalid("Condiciones comerciales inconsistentes.");
  if (body.discount !== undefined && terms.data.discountMode !== null && !Object.hasOwn(body, "discountMode")) invalid("Editá el valor del descuento explícito; el importe efectivo no reemplaza su modalidad.");
  if (body.advanceAmount !== undefined) {
    if (typeof body.advanceAmount !== "number" || !Number.isInteger(body.advanceAmount) || body.advanceAmount < 0 || body.advanceAmount > 2147483647) invalid("Seña fija inválida.");
    if (terms.data.advancePercentBps !== null) invalid("Para fijar una seña, desactivá explícitamente su porcentaje automático.");
  }
  await tx.budget.update({ where: { id }, data: { ...terms.data, ...(body.advanceAmount !== undefined ? { advanceAmount: body.advanceAmount as number } : {}) } });
}

/** Materialize once before ledger guards. Never writes ClientPayment or treasury. */
export async function materializeBudgetCommercial(tx: Prisma.TransactionClient, id: string) {
  const budget = await tx.budget.findUniqueOrThrow({ where: { id }, include: { items: true, payments: { where: { status: "RECEIVED" }, select: { amount: true } }, expectedPayments: { where: { status: { in: ["PROOF", "PARTIAL", "CONFIRMED"] } }, select: { id: true } } } });
  try {
    const items = budget.items.map((item) => ({ ...item, tariffSnapshot: budgetItemCommercialTermsSchema.parse({ priceMode: item.priceMode, tariffSnapshot: item.tariffSnapshot, discountMode: item.discountMode, discountValue: item.discountValue, discountAmount: item.discountAmount }).tariffSnapshot }));
    const result = calculateBudgetCommercial(items, { discountMode: budget.discountMode, discountValue: budget.discountValue, advancePercentBps: budget.advancePercentBps }, budget.discount, budget.advanceAmount);
    for (const item of result.items) await tx.budgetItem.update({ where: { id: item.id }, data: { unitPrice: item.unitPrice, subtotal: item.subtotal, discountAmount: item.discountAmount } });
    await tx.budget.update({ where: { id }, data: { subtotal: result.subtotal, discount: result.discount, total: result.total, advanceAmount: result.advanceAmount } });
    return result;
  } catch (error) {
    if (error instanceof BudgetCalculationError) throw new QuoteComparisonError(budget.approvedAt || budget.payments.length || budget.expectedPayments.length ? 409 : 400, error.message);
    throw error;
  }
}
