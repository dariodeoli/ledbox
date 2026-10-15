import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type AvailabilityHint } from "@/lib/catalog-public";
import { deliveryExtraApplies, deliveryFee, orderPieces } from "@/lib/delivery-zones";
import { tierLabel } from "@/lib/price-tiers";
import { EMPTY_STORE_CART, sanitizeStoreCart, type StoreCartState } from "@/lib/store-cart";
import type { VisitorContact } from "@/lib/store-contact";
import { catalogTokenHash, catalogTokenValue } from "./catalog-access";
import { db } from "./db";
import { inventoryImageUrl } from "./inventory-images";
import { catalogLineAmounts, loadPricedItems, pricedProduct } from "./line-pricing";
import { hintsFor, loadVisibleRows, parsePublicRange, type PublicCatalogContext } from "./catalog-public";

/**
 * Carrito de la tienda web en el servidor.
 *
 * - `priceStoreCart`: revalida un carrito (lista de productos + fechas + zona de flete) contra el
 *   catálogo y el stock de HOY. **El precio lo calcula siempre el servidor** con la regla única
 *   `catalogLineAmounts` (escalones por día o total, evento): lo que mande el navegador no cuenta.
 *   Lo que ya no está en el catálogo se informa como quitado; nada se inventa.
 * - `loadMemberCart` / `saveMemberCart`: el carrito de un cliente con acceso aprobado (link de
 *   acceso o mayorista), para retomarlo desde otro dispositivo. Guarda solo referencias, fechas y
 *   zona; nunca precios. Una fila por link (`accessTokenId` único): el link ya identifica a la
 *   empresa y al cliente, y un link de otra empresa no resuelve (404).
 */

export type CartLineView = {
  id: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  /** Precio unitario (por día, o total del período en escalón «total» / evento); `null` = «Consultar». */
  unitPrice: number | null;
  /** Por cuántos días se multiplica el unitario (1 si es total o evento). */
  days: number;
  subtotal: number | null;
  mode: "BASE" | "PER_DAY" | "TOTAL" | "EVENT" | null;
  /** Escalón aplicado, en texto: «desde 5 días: 300.000 total». */
  tier: string | null;
  /** Lo que se ahorra en la línea por el escalón respecto del precio base de lista (0 si no hay escalón). */
  tierSaving: number;
  availability: AvailabilityHint | null;
};

export type CartView = {
  lines: CartLineView[];
  /** Ids que ya no están en el catálogo (se quitaron del carrito). */
  removed: string[];
  range: { fromKey: string; toKey: string; days: number } | null;
  /** Había fechas guardadas pero ya pasaron o no son válidas. */
  rangeExpired: boolean;
  pricesShown: boolean;
  delivery: {
    choice: "NONE" | "COORDINATE" | "ZONE";
    zoneId: string | null;
    zoneName: string | null;
    fee: number | null;
    extraApplies: boolean;
    /** La zona guardada ya no existe o se archivó. */
    gone: boolean;
  };
  itemsSubtotal: number | null;
  /** Suma de lo ahorrado por escalones (ya está descontado de `itemsSubtotal`). */
  tierSavings: number;
  total: number | null;
  pieces: number;
};

/** Ahorro de un escalón: lo que costaría la línea al precio base de lista (por día o por evento) menos lo que cuesta con el escalón. */
function tierSavingOf(item: Parameters<typeof pricedProduct>[0] | undefined, list: "RETAIL" | "WHOLESALE", quantity: number, periodDays: number, subtotal: number): number {
  if (!item) return 0;
  const base = pricedProduct(item, list, false);
  const baseDays = item.billingUnit === "EVENT" ? 1 : periodDays;
  return Math.max(0, base.basePrice * quantity * baseDays - subtotal);
}

export async function priceStoreCart(context: PublicCatalogContext, raw: unknown): Promise<CartView> {
  const cart = sanitizeStoreCart(raw);
  const organizationId = context.organization.id;
  const ids = cart.items.map((line) => line.id);
  const rows = await loadVisibleRows(organizationId, context.priceList, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const range = cart.from && cart.to ? parsePublicRange(cart.from, cart.to) : null;
  const rangeExpired = Boolean(cart.from && cart.to && !range);
  const days = range?.days ?? 1;
  const pricesShown = context.settings.publicShowPrices;
  const hints = range && rows.length ? await hintsFor(organizationId, rows, range) : null;
  const priced = pricesShown ? await loadPricedItems(organizationId, rows.map((row) => row.id)) : new Map();

  const lines: CartLineView[] = [];
  for (const line of cart.items) {
    const row = byId.get(line.id);
    if (!row) continue;
    const amounts = pricesShown ? catalogLineAmounts(priced.get(row.id), null, line.quantity, days, context.priceList) : null;
    const hasPrice = Boolean(amounts && amounts.unitPrice > 0);
    lines.push({
      id: row.id,
      name: row.name,
      sku: row.sku,
      imageUrl: inventoryImageUrl(row),
      quantity: line.quantity,
      unitPrice: hasPrice ? amounts!.unitPrice : null,
      days: hasPrice ? amounts!.days : 1,
      subtotal: hasPrice ? amounts!.subtotal : null,
      mode: hasPrice ? amounts!.fromStore?.pricing.mode ?? "BASE" : null,
      tier: hasPrice && amounts!.fromStore?.pricing.tier ? tierLabel(amounts!.fromStore.pricing.tier) : null,
      tierSaving: hasPrice && amounts!.fromStore?.pricing.tier ? tierSavingOf(priced.get(row.id), context.priceList, line.quantity, days, amounts!.subtotal) : 0,
      availability: hints?.get(row.id) ?? null,
    });
  }

  // Flete: solo una zona activa de ESTA empresa; si desapareció no se inventa un monto.
  const pieces = orderPieces(lines.map((line) => ({ quantity: line.quantity, inventoryId: line.id })));
  const zone = cart.zone && cart.zone !== "COORDINATE"
    ? await db.deliveryZone.findFirst({ where: { id: cart.zone, organizationId, archivedAt: null }, select: { id: true, name: true, basePrice: true, volumeThreshold: true, extraPrice: true } })
    : null;
  const zoneGone = Boolean(cart.zone && cart.zone !== "COORDINATE" && !zone);
  const fee = pricesShown && zone ? deliveryFee(zone, pieces) : null;
  const itemsSubtotal = pricesShown && lines.length > 0 && lines.every((line) => line.subtotal !== null) ? lines.reduce((sum, line) => sum + (line.subtotal ?? 0), 0) : null;

  return {
    lines,
    removed: ids.filter((id) => !byId.has(id)),
    range: range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null,
    rangeExpired,
    pricesShown,
    delivery: {
      choice: zone ? "ZONE" : cart.zone === "COORDINATE" ? "COORDINATE" : "NONE",
      zoneId: zone?.id ?? null,
      zoneName: zone?.name ?? null,
      fee,
      extraApplies: Boolean(zone && pricesShown && deliveryExtraApplies(zone, pieces)),
      gone: zoneGone,
    },
    itemsSubtotal,
    tierSavings: lines.reduce((sum, line) => sum + line.tierSaving, 0),
    total: itemsSubtotal !== null ? itemsSubtotal + (fee ?? 0) : null,
    pieces,
  };
}

// ── Carrito guardado (cliente con acceso o visitante con enlace mágico) ─────

export const VISITOR_CART_DAYS = 30;

/** Dueño del carrito guardado: el link de acceso (id del token) o el visitante (id del carrito). Sale del contexto, nunca del cliente. */
function cartWhere(context: PublicCatalogContext): Prisma.StoreCartWhereInput | null {
  const organizationId = context.organization.id;
  if (context.access) return { organizationId, accessTokenId: context.access.id };
  if (context.visitorCartId) return { organizationId, id: context.visitorCartId, expiresAt: { gt: new Date() } };
  return null;
}

/** ¿Este contexto tiene carrito guardado en el servidor? */
export const hasSavedCart = (context: PublicCatalogContext): boolean => cartWhere(context) !== null;

const stateOf = (row: { items: Prisma.JsonValue; fromKey: string | null; toKey: string | null; zoneChoice: string | null; seenTotal: number | null }) =>
  sanitizeStoreCart({ items: row.items, from: row.fromKey, to: row.toKey, zone: row.zoneChoice ?? "", seenTotal: row.seenTotal });

export async function loadMemberCart(context: PublicCatalogContext): Promise<StoreCartState> {
  const where = cartWhere(context);
  const row = where ? await db.storeCart.findFirst({ where }) : null;
  return row ? stateOf(row) : { ...EMPTY_STORE_CART, items: [] };
}

/** Guarda (o borra, si está vacío) el carrito. Idempotente. El del visitante renueva su vencimiento (30 días). */
export async function saveMemberCart(context: PublicCatalogContext, raw: unknown): Promise<StoreCartState> {
  const where = cartWhere(context);
  if (!where) throw new Error("El carrito guardado es solo de clientes con acceso o con enlace.");
  const cart = sanitizeStoreCart(raw);
  const data = {
    items: cart.items.map((line) => ({ inventoryId: line.id, quantity: line.quantity })) as unknown as Prisma.InputJsonValue,
    fromKey: cart.from,
    toKey: cart.to,
    zoneChoice: cart.zone || null,
    seenTotal: cart.seenTotal,
  };
  if (context.visitorCartId) {
    // El carrito del visitante conserva su fila (y su enlace) aunque quede vacío: solo vence.
    await db.storeCart.updateMany({ where, data: { ...data, expiresAt: new Date(Date.now() + VISITOR_CART_DAYS * 86_400_000) } });
    return cart;
  }
  if (cart.items.length === 0) {
    await db.storeCart.deleteMany({ where });
    return cart;
  }
  await db.storeCart.upsert({
    where: { accessTokenId: context.access!.id },
    create: { id: randomUUID(), organizationId: context.organization.id, accessTokenId: context.access!.id, ...data },
    update: data,
  });
  return cart;
}

/**
 * Alta del carrito de un visitante que dejó su contacto. Devuelve el enlace mágico UNA sola vez (en la base solo
 * vive su hash). No consulta si el correo o el teléfono ya existen: cada alta es un carrito nuevo.
 */
export async function createVisitorCart(context: PublicCatalogContext, contact: VisitorContact, raw: unknown): Promise<{ token: string; path: string; expiresAt: Date }> {
  const cart = sanitizeStoreCart(raw);
  const token = catalogTokenValue();
  const expiresAt = new Date(Date.now() + VISITOR_CART_DAYS * 86_400_000);
  await db.storeCart.create({
    data: {
      id: randomUUID(),
      organizationId: context.organization.id,
      visitorTokenHash: catalogTokenHash(token),
      visitorName: contact.name,
      visitorPhone: contact.phone,
      visitorEmail: contact.email,
      expiresAt,
      items: cart.items.map((line) => ({ inventoryId: line.id, quantity: line.quantity })) as unknown as Prisma.InputJsonValue,
      fromKey: cart.from,
      toKey: cart.to,
      zoneChoice: cart.zone || null,
      seenTotal: cart.seenTotal,
    },
  });
  return { token, path: `/tienda/${encodeURIComponent(context.organization.slug)}/carrito/${token}`, expiresAt };
}
