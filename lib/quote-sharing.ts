import { todayDayKey } from "./admin-format";
import { legacyTier, priceLine, tiersForAudience, type AudiencePriceTier, type LinePricing, type TierPricedProduct } from "./price-tiers";

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

/** Producto con sus precios de venta; `priceTiers` (si viene) manda sobre los campos viejos «desde X días». */
export type QuotableProduct = {
  listPrice?: number; listFromDays?: number; listFromPrice?: number;
  wholesalePrice?: number; wholesaleFromDays?: number; wholesaleFromPrice?: number;
  minimumPrice?: number;
  /** EVENT = precio único por evento: la duración no cambia el precio (días = 1) y los escalones se ignoran. */
  billingUnit?: string | null;
  /** Escalones por días (`InventoryPriceTier`); con ellos los `*FromDays/*FromPrice` ya no se leen. */
  priceTiers?: ReadonlyArray<AudiencePriceTier>;
};

/** Datos de precio de un producto para un frente, en la forma de `priceLine`. */
export function productPricing(product: QuotableProduct, tier: "FINAL" | "WHOLESALE" = "FINAL"): TierPricedProduct {
  const audience = tier === "WHOLESALE" ? "WHOLESALE" : "RETAIL";
  const tiers = product.priceTiers
    ? tiersForAudience(product.priceTiers, audience)
    : tier === "WHOLESALE"
      ? legacyTier(product.wholesaleFromDays, product.wholesaleFromPrice)
      : legacyTier(product.listFromDays, product.listFromPrice);
  return {
    basePrice: (tier === "WHOLESALE" ? product.wholesalePrice : product.listPrice) ?? 0,
    minimumPrice: product.minimumPrice ?? 0,
    billingUnit: product.billingUnit,
    tiers,
  };
}

/** Línea completa (precio unitario Y días a guardar) para `rentalDays`; la regla única de `lib/price-tiers.ts`. */
export function quoteProductLine(product: QuotableProduct, rentalDays: number, tier: "FINAL" | "WHOLESALE" = "FINAL"): LinePricing {
  return priceLine(productPricing(product, tier), rentalDays);
}

/**
 * Precio unitario de la línea. Con escalón «por día» (o sin escalón) es por día; con escalón «total»
 * y en productos por evento es el total del período (usá `quoteProductLine` si necesitás también los días).
 * Un piso no fabrica un precio no configurado ni otro frente.
 */
export function quoteProductPrice(product: QuotableProduct, rentalDays: number, tier: "FINAL" | "WHOLESALE" = "FINAL"): number {
  return quoteProductLine(product, rentalDays, tier).unitPrice;
}

/** Same day boundary as the server portal, including after UTC midnight. */
export function quoteComparisonEligible(quote: { comparisonId?: string | null; approvedAt?: string | null; validUntil: string | null; status: string }, now = new Date()): boolean {
  return !quote.comparisonId && !quote.approvedAt && quote.status !== "APPROVED" && quotePortalAvailable({ status: quote.status, approvedAt: null, validUntil: quote.validUntil ? new Date(quote.validUntil) : null }, now);
}
