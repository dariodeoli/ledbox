import { todayDayKey } from "./admin-format";

/** References are links only. Never fetch or embed their remote content. */
export function quoteReferenceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 2000 || /[\s\u0000-\u001f\u007f\\]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Token reads stop on closed quotes. Expired, unapproved offers must be renewed. */
export function quotePortalAvailable(budget: { status: string; validUntil: Date | null; approvedAt: Date | null }, now = new Date()): boolean {
  if (budget.status === "LOST" || budget.status === "CANCELLED") return false;
  if (budget.approvedAt || !budget.validUntil) return true;
  return todayDayKey(budget.validUntil) >= todayDayKey(now);
}

/** Producto que se cobra una sola vez por evento (`InventoryItem.billingUnit = EVENT`). */
export const isEventBilled = (billingUnit: string | null | undefined): boolean => billingUnit === "EVENT";

/** «Se cobra» aceptado por el API de inventario: por día (default) o por evento. */
export const readBillingUnit = (value: unknown): "DAILY" | "EVENT" | null => (value === "DAILY" || value === "EVENT" ? value : null);

/** Días que se cobran: 1 si el producto es «por evento»; si no, los del alquiler (mínimo 1). */
export const billedDays = (billingUnit: string | null | undefined, days: number): number =>
  isEventBilled(billingUnit) ? 1 : Math.max(1, Math.trunc(days) || 1);

/** An explicit sales tier stays fixed when duration changes. Zero disables a rule. */
export function quoteProductPrice(product: {
  listPrice?: number; listFromDays?: number; listFromPrice?: number;
  wholesalePrice?: number; wholesaleFromDays?: number; wholesaleFromPrice?: number;
  minimumPrice?: number;
  /** EVENT = precio único por evento: la duración no cambia el precio (días = 1). */
  billingUnit?: string | null;
}, rentalDays: number, tier: "FINAL" | "WHOLESALE" = "FINAL"): number {
  const days = isEventBilled(product.billingUnit) ? 1 : rentalDays;
  const normal = tier === "WHOLESALE" ? product.wholesalePrice : product.listPrice;
  const threshold = tier === "WHOLESALE" ? product.wholesaleFromDays : product.listFromDays;
  const fromPrice = tier === "WHOLESALE" ? product.wholesaleFromPrice : product.listFromPrice;
  const price = threshold && threshold > 0 && days >= threshold && fromPrice && fromPrice > 0 ? fromPrice : normal ?? 0;
  // A floor does not manufacture an unconfigured sales price or another tier.
  return price > 0 ? Math.max(price, product.minimumPrice ?? 0) : 0;
}

/** Same day boundary as the server portal, including after UTC midnight. */
export function quoteComparisonEligible(quote: { comparisonId?: string | null; approvedAt?: string | null; validUntil: string | null; status: string }, now = new Date()): boolean {
  return !quote.comparisonId && !quote.approvedAt && quote.status !== "APPROVED" && quotePortalAvailable({ status: quote.status, approvedAt: null, validUntil: quote.validUntil ? new Date(quote.validUntil) : null }, now);
}
