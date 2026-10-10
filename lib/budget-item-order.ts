/** Stable positions without inventing a tie-breaker for legacy NULL rows.
 * Explicit positions precede NULL rows; ties retain their input order.
 * Never mutates input or assigns positions to historical lines.
 */
export function stableOrderBudgetItems<T extends { sortOrder?: number | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || 0);
}
