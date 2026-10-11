import type { BudgetCommercialTerms, BudgetItemCommercialTerms } from "./budget-commercial-contract";
import { budgetItemCommercialTermsSchema, budgetCommercialTermsSchema } from "./budget-commercial-contract";
import { BUDGET_INT_MAX } from "./budget-payment-plan";

export type CommercialLine = BudgetItemCommercialTerms & { id: string; sortOrder: number | null; quantity: number; days: number; unitPrice: number; excluded?: boolean; minimumPrice?: number | null };
export class BudgetCalculationError extends Error {}
const fail = (message: string): never => { throw new BudgetCalculationError(message); };
function money(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(BUDGET_INT_MAX)) fail("El importe calculado supera el límite Int en guaraníes.");
  return Number(value);
}
export function budgetPercentAmount(base: number, bps: number): number {
  if (!Number.isInteger(base) || base < 0 || base > BUDGET_INT_MAX || !Number.isInteger(bps) || bps < 0 || bps > 10000) fail("Monto o porcentaje inválido.");
  return money((BigInt(base) * BigInt(bps) + BigInt(5000)) / BigInt(10000));
}
function discountAmount(base: number, mode: "AMOUNT" | "PERCENT" | null, value: number | null, legacy = 0) {
  const amount = mode === "PERCENT" ? budgetPercentAmount(base, value!) : mode === "AMOUNT" ? value! : legacy;
  if (!Number.isInteger(amount) || amount < 0 || amount > base) fail("El descuento fijo supera su base. Ajustá el descuento explícitamente.");
  return amount;
}

/** One financial projection, also used by provisional portal selection. */
export function calculateBudgetCommercial(lines: CommercialLine[], terms: BudgetCommercialTerms, legacyDiscount: number, fixedAdvance: number) {
  budgetCommercialTermsSchema.parse(terms);
  const ids = new Set<string>();
  const items = lines.map((line) => {
    budgetItemCommercialTermsSchema.parse({ priceMode: line.priceMode, tariffSnapshot: line.tariffSnapshot, discountMode: line.discountMode, discountValue: line.discountValue, discountAmount: line.discountAmount });
    if (!line.id || ids.has(line.id)) fail("Identificador de línea inválido o repetido.");
    ids.add(line.id);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 9999 || !Number.isInteger(line.days) || line.days < 1 || line.days > 9999) fail("Cantidad o duración inválida.");
    const snapshot = line.tariffSnapshot;
    let unitPrice = line.unitPrice;
    if (line.priceMode === "TARIFF" && snapshot) {
      const configured = snapshot.fromDays > 0 && snapshot.fromPrice > 0 && line.days >= snapshot.fromDays ? snapshot.fromPrice : snapshot.normalPrice;
      unitPrice = configured > 0 ? Math.max(configured, snapshot.minimumPrice) : 0;
    }
    if (!Number.isInteger(unitPrice) || unitPrice < 0 || unitPrice > BUDGET_INT_MAX) fail("Precio unitario inválido.");
    const multiplier = BigInt(line.quantity) * BigInt(line.days);
    const gross = line.excluded ? 0 : money(multiplier * BigInt(unitPrice));
    const floor = line.excluded ? 0 : money(multiplier * BigInt(snapshot?.minimumPrice ?? line.minimumPrice ?? 0));
    const discount = line.excluded ? 0 : discountAmount(gross, line.discountMode, line.discountValue);
    const subtotal = gross - discount;
    if (subtotal < floor) fail("El descuento de línea deja el precio por debajo del piso vinculado.");
    return { ...line, unitPrice, gross, floor, subtotal, discountAmount: line.discountMode === null ? null : discount, globalDiscountAmount: 0 };
  });
  const subtotal = money(items.reduce((sum, item) => sum + BigInt(item.subtotal), BigInt(0)));
  const discount = discountAmount(subtotal, terms.discountMode, terms.discountValue, legacyDiscount);
  if (subtotal > 0) {
    const portions = items.map((item) => ({ item, amount: BigInt(discount) * BigInt(item.subtotal) / BigInt(subtotal), rest: BigInt(discount) * BigInt(item.subtotal) % BigInt(subtotal) }));
    let remaining = BigInt(discount) - portions.reduce((sum, row) => sum + row.amount, BigInt(0));
    const ranked = [...portions].sort((a, b) => a.rest !== b.rest ? (a.rest > b.rest ? -1 : 1) : (a.item.sortOrder ?? Infinity) - (b.item.sortOrder ?? Infinity) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
    for (const row of ranked) { if (remaining <= BigInt(0)) break; row.amount++; remaining--; }
    for (const row of portions) {
      row.item.globalDiscountAmount = Number(row.amount);
      if (row.item.subtotal - row.item.globalDiscountAmount < row.item.floor) fail("El descuento global deja una línea por debajo del piso vinculado. Ajustá el descuento completo.");
    }
  }
  const total = subtotal - discount;
  const advanceAmount = terms.advancePercentBps === null ? fixedAdvance : budgetPercentAmount(total, terms.advancePercentBps);
  if (!Number.isInteger(advanceAmount) || advanceAmount < 0 || advanceAmount > total) fail("La seña supera el total negociado. Ajustá la seña fija explícitamente.");
  return { items, subtotal, discount, total, advanceAmount };
}
