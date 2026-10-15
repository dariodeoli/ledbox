/**
 * Flete por zona (alquileres P2). Cálculo PURO y sin base, compartido por la tienda, el
 * presupuesto y el panel.
 *
 * Regla (simple a propósito):
 *   flete = precio base de la zona
 *         + precio extra, si la cantidad de PIEZAS del pedido SUPERA el umbral de volumen.
 *
 * «Piezas» = suma de las cantidades de las líneas de inventario del pedido (las líneas libres,
 * como el propio flete, no cuentan; un combo cuenta por su cantidad de combos). «Supera» es
 * estricto: con umbral 50, 50 piezas no pagan extra y 51 sí. Sin umbral o sin extra, no hay recargo.
 */

export type DeliveryZoneRates = {
  basePrice: number;
  volumeThreshold: number | null;
  extraPrice: number | null;
};

export type DeliveryZoneView = DeliveryZoneRates & {
  id: string;
  name: string;
  notes: string | null;
  sortOrder: number;
  archivedAt: string | null;
};

export const DELIVERY_ZONE_NAME_MAX = 80;
export const DELIVERY_ZONE_NOTES_MAX = 300;
export const DELIVERY_PRICE_MAX = 2_000_000_000;
/** Prefijo del nombre de la línea de flete del presupuesto. */
export const DELIVERY_LINE_PREFIX = "Flete — ";

export const deliveryLineName = (zoneName: string): string => `${DELIVERY_LINE_PREFIX}${zoneName}`.slice(0, 200);
export const isDeliveryLineName = (name: string): boolean => name.startsWith(DELIVERY_LINE_PREFIX);

/** ¿Este pedido paga el recargo por volumen? */
export function deliveryExtraApplies(zone: DeliveryZoneRates, pieces: number): boolean {
  return zone.volumeThreshold !== null && zone.volumeThreshold >= 0 && (zone.extraPrice ?? 0) > 0 && pieces > zone.volumeThreshold;
}

/** Flete en guaraníes (Int) para un pedido de `pieces` piezas. */
export function deliveryFee(zone: DeliveryZoneRates, pieces: number): number {
  const count = Math.max(0, Math.trunc(Number(pieces)) || 0);
  return zone.basePrice + (deliveryExtraApplies(zone, count) ? zone.extraPrice ?? 0 : 0);
}

/** Piezas del pedido: líneas con inventario, no excluidas (el flete y las líneas libres no cuentan). */
export function orderPieces(lines: ReadonlyArray<{ quantity: number; inventoryId?: string | null; excluded?: boolean }>): number {
  return lines.reduce((sum, line) => sum + (line.inventoryId && !line.excluded ? Math.max(0, Math.trunc(line.quantity) || 0) : 0), 0);
}

export type DeliveryZoneInput = {
  name: string;
  basePrice: number;
  volumeThreshold: number | null;
  extraPrice: number | null;
  notes: string | null;
  sortOrder?: number;
};

const intIn = (value: unknown, min: number, max: number): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Valida el alta o la edición de una zona (todo en guaraníes enteros). */
export function readDeliveryZoneInput(body: Record<string, unknown>): { ok: true; value: DeliveryZoneInput } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > DELIVERY_ZONE_NAME_MAX) return { ok: false, error: `El nombre de la zona debe tener de 2 a ${DELIVERY_ZONE_NAME_MAX} caracteres.` };
  const basePrice = intIn(body.basePrice, 0, DELIVERY_PRICE_MAX);
  if (basePrice === null) return { ok: false, error: "El precio del flete debe ser un entero en guaraníes (0 o más)." };
  const hasThreshold = body.volumeThreshold !== undefined && body.volumeThreshold !== null && body.volumeThreshold !== "";
  const hasExtra = body.extraPrice !== undefined && body.extraPrice !== null && body.extraPrice !== "";
  if (hasThreshold !== hasExtra) return { ok: false, error: "El recargo por volumen necesita las dos cosas: desde cuántas piezas y cuánto se suma." };
  const volumeThreshold = hasThreshold ? intIn(body.volumeThreshold, 1, 1_000_000) : null;
  const extraPrice = hasExtra ? intIn(body.extraPrice, 1, DELIVERY_PRICE_MAX) : null;
  if (hasThreshold && volumeThreshold === null) return { ok: false, error: "El umbral de piezas debe ser un entero mayor a 0." };
  if (hasExtra && extraPrice === null) return { ok: false, error: "El recargo por volumen debe ser un entero en guaraníes mayor a 0." };
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, DELIVERY_ZONE_NOTES_MAX) : null;
  const sortOrder = body.sortOrder === undefined ? undefined : intIn(body.sortOrder, 0, 10_000);
  if (sortOrder === null) return { ok: false, error: "El orden debe ser un entero." };
  return { ok: true, value: { name, basePrice, volumeThreshold, extraPrice, notes, ...(sortOrder !== undefined ? { sortOrder } : {}) } };
}

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });

/** «Gs. 150.000 + Gs. 50.000 desde 51 piezas». */
export function deliveryRateText(zone: DeliveryZoneRates): string {
  const base = `Gs. ${gs.format(zone.basePrice)}`;
  return zone.volumeThreshold !== null && zone.extraPrice ? `${base} + Gs. ${gs.format(zone.extraPrice)} desde ${gs.format(zone.volumeThreshold + 1)} piezas` : base;
}
