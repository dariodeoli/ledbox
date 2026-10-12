/** Mirrors splitExpectedPayment's per-part PYG rounding without changing its payload. */
export function validateFinanceSplitAmounts(amounts: readonly string[], remaining: number): { total: number; valid: boolean } {
  const normalized = amounts.map((amount) => Math.round(Number(amount)));
  const total = normalized.reduce((sum, amount) => sum + (Number.isFinite(amount) ? amount : 0), 0);
  const valid =
    amounts.length >= 2 &&
    amounts.length <= 12 &&
    Number.isSafeInteger(remaining) &&
    remaining > 0 &&
    normalized.every((amount) => Number.isSafeInteger(amount) && amount > 0) &&
    Number.isSafeInteger(total) &&
    total === remaining;
  return { total, valid };
}
