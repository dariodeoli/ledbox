import type { Prisma } from "@prisma/client";
import {
  priceLine,
  snapshotFromProduct,
  tiersForAudience,
  type LinePricing,
  type PackageComponentSnapshot,
  type PriceTierAudience,
  type PricingSnapshot,
  type AudiencePriceTier,
} from "@/lib/price-tiers";
import { billedDays } from "@/lib/quote-sharing";
import { db } from "./db";

/**
 * Precio de las líneas de presupuesto a partir del inventario real (alquileres P2). Una sola
 * lectura (producto + escalones + piezas del combo) y una sola función de cálculo
 * (`lib/price-tiers.ts`): la usan la conversión del catálogo, el editor de presupuestos y el
 * portal, así que dan el mismo resultado que la tienda.
 */

type Client = Pick<Prisma.TransactionClient, "inventoryItem">;

export const TIER_SELECT = {
  select: { audience: true, fromDays: true, mode: true, price: true },
  orderBy: { fromDays: "asc" },
} as const satisfies Prisma.InventoryItem$priceTiersArgs;

const PRICED_FIELDS = { id: true, name: true, billingUnit: true, listPrice: true, wholesalePrice: true, minimumPrice: true, priceTiers: TIER_SELECT } as const;

export type PricedItem = {
  id: string;
  name: string;
  billingUnit: string;
  listPrice: number;
  wholesalePrice: number;
  minimumPrice: number;
  priceTiers: AudiencePriceTier[];
  /** Solo en combos: sus piezas con precio. */
  components: Array<{ quantity: number; item: Omit<PricedItem, "components"> }>;
};

/** Productos de la empresa (con escalones y, si son combos, sus piezas). Los ajenos no aparecen. */
export async function loadPricedItems(organizationId: string, ids: readonly string[], client: Client = db): Promise<Map<string, PricedItem>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, PricedItem>();
  if (unique.length === 0) return result;
  const rows = await client.inventoryItem.findMany({
    where: { organizationId, id: { in: unique } },
    select: {
      ...PRICED_FIELDS,
      components: { select: { quantity: true, component: { select: PRICED_FIELDS } }, orderBy: { component: { name: "asc" } } },
    },
  });
  for (const row of rows) {
    const { components, ...item } = row;
    result.set(row.id, { ...item, components: components.map((entry) => ({ quantity: entry.quantity, item: entry.component })) });
  }
  return result;
}

const audienceOf = (list: "RETAIL" | "WHOLESALE" | "FINAL"): PriceTierAudience => (list === "WHOLESALE" ? "WHOLESALE" : "RETAIL");

/**
 * Datos de precio de un producto para un frente. `applyMinimum` aplica el piso de venta (el panel
 * lo hace; la tienda y su conversión no, porque el público nunca ve ese piso).
 */
export function pricedProduct(item: Omit<PricedItem, "components">, list: "RETAIL" | "WHOLESALE" | "FINAL", applyMinimum: boolean) {
  const audience = audienceOf(list);
  return {
    basePrice: audience === "WHOLESALE" ? item.wholesalePrice : item.listPrice,
    minimumPrice: applyMinimum ? item.minimumPrice : 0,
    billingUnit: item.billingUnit,
    tiers: tiersForAudience(item.priceTiers, audience),
  };
}

export function packageComponents(item: PricedItem, list: "RETAIL" | "WHOLESALE" | "FINAL", applyMinimum: boolean): PackageComponentSnapshot[] {
  return item.components.map(({ quantity, item: component }) => {
    const product = pricedProduct(component, list, applyMinimum);
    return {
      name: component.name,
      quantity,
      base: product.basePrice,
      minimum: product.minimumPrice,
      billingUnit: component.billingUnit === "EVENT" ? "EVENT" : "DAILY",
      tiers: product.tiers,
    };
  });
}

/** Precio + snapshot congelado de una línea de producto para `rentalDays` días. */
export function quoteInventoryLine(
  item: PricedItem,
  rentalDays: number,
  list: "RETAIL" | "WHOLESALE" | "FINAL",
  options: { applyMinimum?: boolean } = {},
): { pricing: LinePricing; snapshot: PricingSnapshot } {
  const applyMinimum = options.applyMinimum ?? true;
  const product = pricedProduct(item, list, applyMinimum);
  return {
    pricing: priceLine(product, rentalDays),
    snapshot: snapshotFromProduct(product, audienceOf(list), rentalDays, packageComponents(item, list, applyMinimum)),
  };
}

/**
 * Importes de una línea de pedido del catálogo para `periodDays` días: la regla ÚNICA que usan la
 * conversión a presupuesto y la propuesta de la empresa (sin piso de venta, como la tienda). Si el
 * producto no tiene precio vigente se usa `fallbackUnitPrice` (el que vio el cliente).
 */
export function catalogLineAmounts(
  linked: PricedItem | undefined,
  fallbackUnitPrice: number | null | undefined,
  quantity: number,
  periodDays: number,
  list: "RETAIL" | "WHOLESALE" | "FINAL",
) {
  const quoted = linked ? quoteInventoryLine(linked, periodDays, list, { applyMinimum: false }) : null;
  const fromStore = quoted && quoted.pricing.unitPrice > 0 ? quoted : null;
  const unitPrice = fromStore?.pricing.unitPrice || fallbackUnitPrice || 0;
  // «Se cobra por evento» o escalón «total»: una sola unidad de tiempo, sin importar los días del período.
  const days = fromStore ? fromStore.pricing.days : billedDays(linked?.billingUnit, periodDays);
  return { fromStore, unitPrice, days, subtotal: unitPrice * quantity * days };
}

/** Nota de la línea cuando el escalón es un total cerrado: la duración se pierde en `days = 1`. */
export const totalTierNote = (rentalDays: number): string => `Precio total por ${rentalDays} ${rentalDays === 1 ? "día" : "días"}`;

/** `rentalDays` que manda el panel junto a una línea con producto (entero 1..365) o `null`. */
export function readRentalDays(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

/**
 * Snapshot de precios para las líneas del panel que traen producto y `rentalDays`: se toma del
 * inventario vivo AL GUARDAR (el panel ya calculó el precio con la misma regla), y de ahí en más
 * el portal y los cambios de días usan ese snapshot. Frente de cliente final: el panel no vende
 * a lista mayorista (esa vive en el catálogo mayorista).
 */
export async function snapshotsForLines(
  organizationId: string,
  lines: ReadonlyArray<{ key: string; inventoryId: string | null; rentalDays: number | null }>,
  client: Client = db,
): Promise<Map<string, Prisma.InputJsonValue>> {
  const wanted = lines.filter((line): line is { key: string; inventoryId: string; rentalDays: number } => Boolean(line.inventoryId) && line.rentalDays !== null);
  const result = new Map<string, Prisma.InputJsonValue>();
  if (wanted.length === 0) return result;
  const priced = await loadPricedItems(organizationId, wanted.map((line) => line.inventoryId), client);
  for (const line of wanted) {
    const item = priced.get(line.inventoryId);
    if (item) result.set(line.key, quoteInventoryLine(item, line.rentalDays, "RETAIL", { applyMinimum: false }).snapshot as unknown as Prisma.InputJsonValue);
  }
  return result;
}
