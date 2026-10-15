import { isCatalogAudience } from "./catalog-audience";

/** Explicaciones de contrato consumidas por la ayuda canónica de PANEL. */
export const INVENTORY_FIELD_HELP: Record<string, string> = {
  name: "Nombre visible que identifica el producto; no cambia los códigos de sus unidades.",
  category: "Agrupa productos y permite buscar sustitutos de la misma categoría. Escribirla acá la crea si todavía no existe.",
  subcategory: "Segundo nivel dentro de la categoría (por ejemplo Vajilla › Copas). Opcional; se elige junto con la categoría.",
  defaultWarehouseId: "Depósito que se propone al dar de alta unidades nuevas de este producto.",
  defaultLocation: "Ubicación dentro del depósito que se propone para las unidades nuevas (por ejemplo E3-B2).",
  warehouseId: "Depósito donde está guardada la unidad. Moverla no cambia cuántas unidades tiene el producto.",
  location: "Ubicación dentro del depósito: estante y nivel, por ejemplo E3-B2. Se muestra con el código del depósito (D1-E3-B2).",
  conditionScore: "Estado físico de la unidad del 1 al 10 (se muestra también en porcentaje).",
  supplierId: "Proveedor al que se compró. Vacío en la unidad = hereda el del producto.",
  purchasedAt: "Fecha de compra. Vacía en la unidad = hereda la del producto.",
  warrantyUntil: "Hasta cuándo cubre la garantía. Se resalta cuando vence en menos de 30 días.",
  inventoryKind: "Clasifica el producto como reutilizable, consumible o descartable.",
  status: "Estado operativo del producto; mantenimiento y retirado bloquean disponibilidad. No es archivo organizacional.",
  catalogAudience: "Quién ve el producto en la tienda web de la empresa: nadie (Oculto), cliente final, mayoristas con su link privado o ambos. No modifica precios ni disponibilidad.",
  publicDescription: "Texto opcional que muestra el catálogo público debajo del nombre. Las notas internas nunca se publican.",
  notes: "Notas internas opcionales. En unidades no hay fechas, taller ni presupuesto de reparación estructurados.",
  imageUrl: "Imagen manual del producto. Vaciar la URL conserva la foto subida como alternativa, si existe.",
  dailyCost: "Costo interno por día de uso; no es una tarifa al cliente ni un importe de reparación.",
  replacementCost: "Costo interno de reposición, conservado como dato secundario; no es precio de venta.",
  listPrice: "Tarifa normal de cliente final. La duración no cambia el segmento del cliente.",
  listFromDays: "Heredado y sin efecto: los precios por días se cargan en la tabla «Precio por días» de cada producto.",
  listFromPrice: "Heredado y sin efecto: usá la tabla «Precio por días» del producto.",
  wholesalePrice: "Tarifa normal del segmento mayorista; no se elige automáticamente por duración.",
  wholesaleFromDays: "Heredado y sin efecto: los precios por días mayoristas se cargan en la tabla «Precio por días» del producto.",
  wholesaleFromPrice: "Heredado y sin efecto: usá la tabla «Precio por días» del producto.",
  billingUnit: "Cómo se cobra el producto: por día (el precio se multiplica por los días) o por evento (precio único, sin importar los días).",
  minimumPrice: "Piso de venta existente del producto; no sustituye sus tarifas normales.",
  purchaseCost: "Costo de adquisición de esta unidad; no es un presupuesto de reparación ni precio de venta.",
  unitStatus: "Disponible, mantenimiento, retirada, dañada o perdida. Las retiradas no cuentan como unidades activas; mantenimiento, dañadas y perdidas reducen las libres.",
  code: "Identificador único de la unidad dentro de la empresa. En alta puede generarse automáticamente.",
};

/** «Se cobra» del producto (alta, edición y lote). */
export const BILLING_UNIT_OPTIONS = [
  { value: "DAILY", label: "Por día" },
  { value: "EVENT", label: "Por evento" },
] as const;

/** Campos comunes editables del contrato actual; identidad/cantidad derivada no son masivas. */
export const ITEM_BULK_FIELDS = [
  { key: "category", label: "Categoría", type: "text", clear: false },
  { key: "subcategory", label: "Subcategoría", type: "text", clear: false },
  { key: "inventoryKind", label: "Tipo", type: "kind", clear: false },
  { key: "status", label: "Estado", type: "status", clear: false },
  { key: "catalogAudience", label: "Visibilidad en la tienda", type: "audience", clear: false },
  { key: "notes", label: "Notas internas", type: "notes", clear: true },
  { key: "imageUrl", label: "URL manual de imagen", type: "text", clear: true },
  { key: "dailyCost", label: "Costo diario interno", type: "money", clear: true },
  { key: "replacementCost", label: "Reposición (secundario)", type: "money", clear: true },
  { key: "billingUnit", label: "Se cobra", type: "billing", clear: false },
  { key: "listPrice", label: "Precio cliente final", type: "money", clear: true },
  { key: "listFromDays", label: "Cliente final desde días (heredado, sin efecto)", type: "days", clear: true },
  { key: "listFromPrice", label: "Precio final desde esos días (heredado, sin efecto)", type: "money", clear: true },
  { key: "wholesalePrice", label: "Precio mayorista", type: "money", clear: true },
  { key: "wholesaleFromDays", label: "Mayorista desde días (heredado, sin efecto)", type: "days", clear: true },
  { key: "wholesaleFromPrice", label: "Precio mayorista desde esos días (heredado, sin efecto)", type: "money", clear: true },
  { key: "minimumPrice", label: "Precio mínimo", type: "money", clear: true },
] as const;
export const UNIT_BULK_FIELDS = [
  { key: "status", label: "Estado", type: "status", clear: false },
  { key: "warehouseId", label: "Depósito", type: "warehouse", clear: false },
  { key: "location", label: "Ubicación", type: "location", clear: true },
  { key: "conditionScore", label: "Condición (1 a 10)", type: "condition", clear: true },
  { key: "supplierId", label: "Proveedor", type: "supplier", clear: true },
  { key: "purchasedAt", label: "Fecha de compra", type: "date", clear: true },
  { key: "warrantyUntil", label: "Garantía hasta", type: "date", clear: true },
  { key: "purchaseCost", label: "Costo que tuvo", type: "money", clear: true },
  { key: "notes", label: "Notas de la unidad", type: "notes", clear: true },
] as const;

export function readBulkSelection(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => typeof id !== "string" || !id.trim()) || new Set(value).size !== value.length) return null;
  return value;
}

/** Ausente = no cambiar, null = vaciar explícitamente, nunca convertir un vacío en una instrucción. */
export function readBulkChanges(target: "items" | "units", value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = target === "items" ? ITEM_BULK_FIELDS : UNIT_BULK_FIELDS;
  const entries = Object.entries(value);
  if (!entries.length) return null;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    const field = fields.find(field => field.key === key);
    if (!field) return null;
    if (raw === null) {
      if (!field.clear) return null;
      result[key] = field.type === "money" || field.type === "days" ? 0 : "";
    } else {
      if (field.type === "audience") { if (!isCatalogAudience(raw)) return null; }
      else if (field.type === "billing") { if (raw !== "DAILY" && raw !== "EVENT") return null; }
      else if (field.type === "condition") { if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 10) return null; }
      else if (field.type === "date") { if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null; }
      else if (field.type === "location") { if (typeof raw !== "string" || !raw.trim() || raw.length > 40) return null; }
      else if (field.type === "warehouse" || field.type === "supplier") { if (typeof raw !== "string" || !raw.trim() || raw.length > 100) return null; }
      else if (field.type === "money" || field.type === "days") { if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > (field.type === "days" ? 3650 : 2147483647)) return null; }
      else if (typeof raw !== "string" || !raw.trim() || raw.length > (key === "category" ? 80 : key === "subcategory" ? 60 : key === "notes" ? (target === "units" ? 400 : 2000) : 2000)) return null;
      result[key] = raw;
    }
  }
  // La subcategoría se elige junto con su categoría: sola no dice a qué categoría pertenece.
  if (result.subcategory !== undefined && result.category === undefined) return null;
  return result;
}
