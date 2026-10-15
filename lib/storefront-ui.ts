import type { PriceMode } from "./appearance";

/**
 * Reglas puras de la presentación de la tienda (sin React ni base): etiquetas de precio según el modo de la empresa,
 * paso del selector de cantidad, dato corto de las categorías, orden del catálogo, fechas por «fecha + días» y el
 * mensaje de WhatsApp de cada producto. Las usan los componentes y los tests.
 */

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
export const formatGs = (value: number) => `Gs. ${gs.format(value)}`;

export type BillingMode = "BASE" | "PER_DAY" | "TOTAL" | "EVENT" | null | undefined;

/** «por día», «por evento», «total por 5 días» o, con el modo «por unidad», «c/u». */
export function priceUnitLabel(priceMode: PriceMode, mode: BillingMode, days: number | null): string {
  if (mode === "EVENT") return "por evento";
  if (mode === "TOTAL") return days ? `total por ${days} ${days === 1 ? "día" : "días"}` : "total";
  return priceMode === "unit" ? "c/u" : "por día";
}

/** De a cuánto sube el selector de cantidad: de a 10 en las piezas que se cobran «c/u» (vajilla, copas); los juegos y el resto, de a 1. */
export function quantityStep(priceMode: PriceMode, isPackage: boolean): number {
  return priceMode === "unit" && !isPackage ? 10 : 1;
}

export const MAX_QUANTITY = 99;
export const nextQuantity = (current: number, step: number, direction: 1 | -1) => Math.max(0, Math.min(MAX_QUANTITY, current + direction * step));

/** Dato corto de la tarjeta de categoría: «Desde Gs. X» si hay precios, y siempre «N productos». Nunca inventa un precio. */
export function categoryDatum(entry: { count: number; minUnit: number | null }, showPrices: boolean, priceMode: PriceMode): string {
  const count = `${entry.count} ${entry.count === 1 ? "producto" : "productos"}`;
  if (!showPrices || priceMode === "quote" || !entry.minUnit || entry.minUnit <= 0) return count;
  return `${count} · Desde ${formatGs(entry.minUnit)}${priceMode === "unit" ? " c/u" : ""}`;
}

export const SORT_OPTIONS = [
  { value: "destacados", label: "Destacados" },
  { value: "precio-asc", label: "Precio: menor a mayor" },
  { value: "precio-desc", label: "Precio: mayor a menor" },
  { value: "nombre", label: "Nombre (A a Z)" },
  { value: "capacidad", label: "Capacidad" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["value"];
export const isSortKey = (value: unknown): value is SortKey => SORT_OPTIONS.some((option) => option.value === value);

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Ordena sin mutar. «Destacados» respeta el orden que decidió la empresa; lo que no tiene precio o capacidad va al final. */
export function sortCatalog<T extends { name: string; capacity?: number | null; unit: number }>(rows: readonly T[], sort: SortKey): T[] {
  const list = [...rows];
  if (sort === "destacados") return list;
  if (sort === "nombre") return list.sort((a, b) => collator.compare(a.name, b.name));
  if (sort === "capacidad") return list.sort((a, b) => (b.capacity ?? -1) - (a.capacity ?? -1) || collator.compare(a.name, b.name));
  const direction = sort === "precio-asc" ? 1 : -1;
  return list.sort((a, b) => {
    if ((a.unit > 0) !== (b.unit > 0)) return a.unit > 0 ? -1 : 1;
    return (a.unit - b.unit) * direction || collator.compare(a.name, b.name);
  });
}

// ── Fecha del evento + días de alquiler ──────────────────────────────────────

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Suma días a una clave `AAAA-MM-DD` (calendario UTC, sin husos). */
export function addDaysKey(key: string, days: number): string {
  if (!DAY_KEY.test(key)) return key;
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Días de alquiler entre dos claves (ambos incluidos); `null` si no son válidas. */
export function rentalDays(fromKey: string, toKey: string): number | null {
  if (!DAY_KEY.test(fromKey) || !DAY_KEY.test(toKey) || toKey < fromKey) return null;
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000) + 1;
}

export const MAX_RENTAL_DAYS = 30;
/** Fecha del evento y días → período `{ fromKey, toKey }`; `null` si falta la fecha o los días no están entre 1 y 30. */
export function rangeFromEvent(fromKey: string, days: number): { fromKey: string; toKey: string } | null {
  if (!DAY_KEY.test(fromKey) || !Number.isInteger(days) || days < 1 || days > MAX_RENTAL_DAYS) return null;
  return { fromKey, toKey: addDaysKey(fromKey, days - 1) };
}

/** Mensaje prearmado de WhatsApp para consultar por un producto (con las fechas si ya las eligió). */
export function productWhatsappMessage(store: string, product: { name: string; sku: string | null }, range?: { fromKey: string; toKey: string } | null): string {
  const code = product.sku ? ` (COD #${product.sku.replace(/^cod\s*#?\s*/i, "")})` : "";
  const dates = range ? ` para el período del ${range.fromKey.split("-").reverse().join("/")} al ${range.toKey.split("-").reverse().join("/")}` : "";
  return `Hola ${store}! Quiero consultar por ${product.name}${code}${dates}.`;
}

/** Hoy en Paraguay como `AAAA-MM-DD`. */
export function todayKeyPY(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** «12/10/2026» a partir de `2026-10-12`. */
export const dayLabel = (key: string) => key.split("-").reverse().join("/");

/** Copia y resumen únicos del armado de una preorden; no cambian precios ni reservan stock. */
export const PREORDER_COPY = {
  name: "Preorden",
  title: "Tu preorden",
  open: "Ver preorden",
  send: "Enviar preorden",
  received: "Recibimos tu preorden",
  notice: "Enviar una preorden no confirma el alquiler ni reserva productos o fechas.",
  logistics: "El flete y los servicios de logística pendientes se cotizan según el lugar del evento.",
  consult: "Consultar precio y disponibilidad",
} as const;

/** Sólo se suma un flete que el API revalidó. Sin ese dato, el importe es de productos. */
export function preorderEstimate(productsSubtotal: number | null, delivery?: { choice: string; fee: number | null } | null) {
  const products = productsSubtotal !== null && Number.isFinite(productsSubtotal) && productsSubtotal > 0 ? productsSubtotal : null;
  const fee = delivery?.choice === "ZONE" && delivery.fee !== null && Number.isFinite(delivery.fee) && delivery.fee >= 0 ? delivery.fee : null;
  return {
    products, fee,
    amount: products !== null ? products + (fee ?? 0) : null,
    label: fee !== null ? "Estimado con flete" : "Productos estimados",
    logisticsPending: fee === null,
  };
}
