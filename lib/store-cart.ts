/**
 * Carrito de la tienda web (visitante y cliente con acceso). Reglas puras, sin base ni red.
 *
 * El carrito guarda SOLO referencias: producto y cantidad, fechas y zona de flete elegida. El
 * precio nunca se guarda ni se confía: el servidor lo calcula al volver (`/cart` del catálogo).
 * - Visitante: `localStorage`, una clave por tienda (y por lista de precios), siempre con try/catch.
 * - Cliente con acceso aprobado: además se guarda en el servidor (`StoreCart`) para retomarlo.
 */

export const STORE_CART_VERSION = 1;
export const STORE_CART_MAX_LINES = 40;
export const STORE_CART_MAX_QUANTITY = 99;

export type StoreCartLine = { id: string; quantity: number };
export type StoreCartState = {
  items: StoreCartLine[];
  /** Fechas `YYYY-MM-DD` (ambas o ninguna). */
  from: string | null;
  to: string | null;
  /** "" = sin elegir, `COORDINATE` = «a coordinar», o el id de una zona. */
  zone: string;
  /** Último total que vio el cliente: sirve para avisarle si cambió al volver. */
  seenTotal: number | null;
};

export const EMPTY_STORE_CART: StoreCartState = { items: [], from: null, to: null, zone: "", seenTotal: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Clave de `localStorage`: separada por tienda y por tipo de acceso para no mezclar listas de precios. */
export function storeCartKey(slug: string, scope: "public" | "acceso" | "mayorista" | "lab" = "public"): string {
  return `ledbox-store-cart:v${STORE_CART_VERSION}:${scope}:${slug.trim().toLowerCase()}`;
}

/** Normaliza cualquier cosa a un carrito válido: descarta líneas rotas, repetidas o fuera de rango. Nunca lanza. */
export function sanitizeStoreCart(raw: unknown): StoreCartState {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...EMPTY_STORE_CART, items: [] };
    }
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const items: StoreCartLine[] = [];
  if (Array.isArray(record.items)) {
    for (const entry of record.items) {
      const line = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
      // `inventoryId` es el nombre en el servidor; `id`, el de la pantalla.
      const id = typeof line.id === "string" ? line.id : typeof line.inventoryId === "string" ? line.inventoryId : "";
      const quantity = line.quantity;
      if (!id || id.length > 64 || seen.has(id)) continue;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > STORE_CART_MAX_QUANTITY) continue;
      seen.add(id);
      items.push({ id, quantity });
      if (items.length >= STORE_CART_MAX_LINES) break;
    }
  }
  const from = typeof record.from === "string" && DAY.test(record.from) ? record.from : null;
  const to = typeof record.to === "string" && DAY.test(record.to) ? record.to : null;
  const validRange = from && to && to >= from;
  const zone = typeof record.zone === "string" && record.zone.length <= 64 ? record.zone : "";
  const seenTotal = typeof record.seenTotal === "number" && Number.isInteger(record.seenTotal) && record.seenTotal >= 0 ? record.seenTotal : null;
  return { items, from: validRange ? from : null, to: validRange ? to : null, zone, seenTotal };
}

export function serializeStoreCart(state: StoreCartState): string {
  const clean = sanitizeStoreCart(state);
  return JSON.stringify({ v: STORE_CART_VERSION, ...clean });
}

export const isEmptyStoreCart = (state: StoreCartState): boolean => state.items.length === 0;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lee el carrito del navegador; con el almacenamiento bloqueado o roto devuelve uno vacío. */
export function readLocalStoreCart(key: string, store: StorageLike | null = storage()): StoreCartState {
  try {
    return sanitizeStoreCart(store?.getItem(key) ?? null);
  } catch {
    return { ...EMPTY_STORE_CART, items: [] };
  }
}

/** Guarda (o borra, si está vacío) el carrito. Devuelve `false` si el navegador no lo permite. */
export function writeLocalStoreCart(key: string, state: StoreCartState, store: StorageLike | null = storage()): boolean {
  try {
    if (!store) return false;
    if (isEmptyStoreCart(state)) store.removeItem(key);
    else store.setItem(key, serializeStoreCart(state));
    return true;
  } catch {
    return false;
  }
}


/** Contexto del total observado: cambiar líneas, cantidades, fechas o flete no es una variación de precios. */
export function storeCartContext(state: Pick<StoreCartState, "items" | "from" | "to" | "zone">): string {
  const lines = state.items.map((line) => [line.id, line.quantity] as const).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return JSON.stringify([lines, state.from, state.to, state.zone]);
}
