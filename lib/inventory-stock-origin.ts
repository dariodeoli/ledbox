/** Ownership/procurement is independent of product kind and count certainty. */
export const STOCK_ORIGINS = ["OWNED", "CONSIGNED", "EXTERNAL_RENTAL"] as const;
export type StockOrigin = (typeof STOCK_ORIGINS)[number];
export type StockOriginValue = StockOrigin | null;
export const STOCK_ORIGIN_LABELS: Record<StockOrigin, string> = {
  OWNED: "Propio", CONSIGNED: "Consignado en mis depósitos", EXTERNAL_RENTAL: "Alquiler externo por evento",
};
export type OriginPair = { origin: StockOriginValue; supplierId: string | null };
export type OriginResult = { ok: true; value: OriginPair; changed: boolean } | { ok: false; error: string };

/** Absent fields preserve the saved pair. Null explicitly means unreviewed;
 * changing defaults never updates existing units. No guessing from purchase data. */
export function readStockOrigin(
  body: Record<string, unknown>,
  fields: { origin: string; supplier: string },
  current: OriginPair = { origin: null, supplierId: null },
  physicalUnit = false,
): OriginResult {
  const changed = body[fields.origin] !== undefined || body[fields.supplier] !== undefined;
  if (!changed) return { ok: true, value: current, changed: false };
  const raw = body[fields.origin] === undefined ? current.origin : body[fields.origin];
  const origin = raw === null || raw === "" ? null : raw;
  if (origin !== null && (typeof origin !== "string" || !(STOCK_ORIGINS as readonly string[]).includes(origin))) return { ok: false, error: "Elegí un origen de stock válido." };
  if (physicalUnit && origin === "EXTERNAL_RENTAL") return { ok: false, error: "El alquiler externo por evento no crea unidades ni stock físico." };
  const supplied = body[fields.supplier] === undefined ? (origin === current.origin ? current.supplierId : null) : body[fields.supplier];
  if (supplied !== null && supplied !== "" && typeof supplied !== "string") return { ok: false, error: "Elegí un tercero válido para el origen." };
  const supplierId = typeof supplied === "string" && supplied.trim() ? supplied.trim() : null;
  if ((origin === "CONSIGNED" || origin === "EXTERNAL_RENTAL") && !supplierId) return { ok: false, error: origin === "CONSIGNED" ? "Elegí al dueño de las unidades consignadas." : "Elegí al proveedor del alquiler externo." };
  if ((origin === null || origin === "OWNED") && supplierId) return { ok: false, error: "El stock propio o sin revisar no lleva un dueño externo." };
  return { ok: true, value: { origin: origin as StockOriginValue, supplierId }, changed };
}

export const IMPORT_STOCK_ORIGINS = { propio: "OWNED", consignado: "CONSIGNED", externo: "EXTERNAL_RENTAL" } as const;
/** Portable descriptor, not a fuzzy name/RUC lookup. IDs must be validated against
 * the destination company by validatedStockOrigin before writing. */
export function readImportStockOrigin(body: Record<string, unknown>, current: OriginPair = { origin: null, supplierId: null }, physicalUnit = false): OriginResult {
  const input: Record<string, unknown> = {};
  if (body.origen_stock !== undefined) {
    if (body.origen_stock === null) input.origin = null;
    else if (typeof body.origen_stock === "string" && Object.hasOwn(IMPORT_STOCK_ORIGINS, body.origen_stock)) input.origin = IMPORT_STOCK_ORIGINS[body.origen_stock as keyof typeof IMPORT_STOCK_ORIGINS];
    else return { ok: false, error: "origen_stock debe ser propio, consignado, externo o null." };
  }
  if (body.tercero !== undefined) {
    if (body.tercero === null) input.supplier = null;
    else {
      if (typeof body.tercero !== "object" || Array.isArray(body.tercero)) return { ok: false, error: "tercero debe ser un descriptor con id explícito de proveedor." };
      const third = body.tercero as Record<string, unknown>;
      if (Object.keys(third).some(key => key !== "id" && key !== "nombre") || typeof third.id !== "string" || !third.id.trim() || (third.nombre !== undefined && typeof third.nombre !== "string")) return { ok: false, error: "tercero requiere id explícito; nombre sólo describe y nunca resuelve un proveedor." };
      input.supplier = third.id.trim();
    }
  }
  return readStockOrigin(input, { origin: "origin", supplier: "supplier" }, current, physicalUnit);
}

export function serializeImportStockOrigin(pair: OriginPair, supplierName?: string | null) {
  const key = pair.origin ? (Object.keys(IMPORT_STOCK_ORIGINS) as Array<keyof typeof IMPORT_STOCK_ORIGINS>).find(key => IMPORT_STOCK_ORIGINS[key] === pair.origin)! : null;
  return { origen_stock: key, tercero: pair.supplierId ? { id: pair.supplierId, ...(supplierName ? { nombre: supplierName } : {}) } : null };
}
