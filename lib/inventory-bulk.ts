import { isCatalogAudience } from "./catalog-audience";

/** Explicaciones de contrato consumidas por la ayuda canónica de PANEL. */
export const INVENTORY_FIELD_HELP: Record<string, string> = {
  name: "Nombre visible que identifica el producto; no cambia los códigos de sus unidades.",
  category: "Agrupa productos y permite buscar sustitutos de la misma categoría.",
  inventoryKind: "Clasifica el producto como reutilizable, consumible o descartable.",
  status: "Estado operativo del producto; mantenimiento y retirado bloquean disponibilidad. No es archivo organizacional.",
  catalogAudience: "Quién ve el producto en la tienda web de la empresa: nadie (Oculto), cliente final, mayoristas con su link privado o ambos. No modifica precios ni disponibilidad.",
  publicDescription: "Texto opcional que muestra el catálogo público debajo del nombre. Las notas internas nunca se publican.",
  notes: "Notas internas opcionales. En unidades no hay fechas, taller ni presupuesto de reparación estructurados.",
  imageUrl: "Imagen manual del producto. Vaciar la URL conserva la foto subida como alternativa, si existe.",
  dailyCost: "Costo interno por día de uso; no es una tarifa al cliente ni un importe de reparación.",
  replacementCost: "Costo interno de reposición, conservado como dato secundario; no es precio de venta.",
  listPrice: "Tarifa normal de cliente final. La duración no cambia el segmento del cliente.",
  listFromDays: "Umbral de días de la tarifa final; 0 desactiva la regla. No convierte el pedido en mayorista.",
  listFromPrice: "Tarifa de cliente final desde su umbral de días. Independiente de mayorista.",
  wholesalePrice: "Tarifa normal del segmento mayorista; no se elige automáticamente por duración.",
  wholesaleFromDays: "Umbral de días de la tarifa mayorista; 0 desactiva su regla.",
  wholesaleFromPrice: "Tarifa mayorista desde su umbral de días; no cambia la tarifa de cliente final.",
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
  { key: "inventoryKind", label: "Tipo", type: "kind", clear: false },
  { key: "status", label: "Estado", type: "status", clear: false },
  { key: "catalogAudience", label: "Visibilidad en la tienda", type: "audience", clear: false },
  { key: "notes", label: "Notas internas", type: "notes", clear: true },
  { key: "imageUrl", label: "URL manual de imagen", type: "text", clear: true },
  { key: "dailyCost", label: "Costo diario interno", type: "money", clear: true },
  { key: "replacementCost", label: "Reposición (secundario)", type: "money", clear: true },
  { key: "billingUnit", label: "Se cobra", type: "billing", clear: false },
  { key: "listPrice", label: "Precio cliente final", type: "money", clear: true },
  { key: "listFromDays", label: "Cliente final desde días", type: "days", clear: true },
  { key: "listFromPrice", label: "Precio final desde esos días", type: "money", clear: true },
  { key: "wholesalePrice", label: "Precio mayorista", type: "money", clear: true },
  { key: "wholesaleFromDays", label: "Mayorista desde días", type: "days", clear: true },
  { key: "wholesaleFromPrice", label: "Precio mayorista desde esos días", type: "money", clear: true },
  { key: "minimumPrice", label: "Precio mínimo", type: "money", clear: true },
] as const;
export const UNIT_BULK_FIELDS = [
  { key: "status", label: "Estado", type: "status", clear: false },
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
      else if (field.type === "money" || field.type === "days") { if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > (field.type === "days" ? 3650 : 2147483647)) return null; }
      else if (typeof raw !== "string" || !raw.trim() || raw.length > (key === "category" ? 80 : key === "notes" ? (target === "units" ? 400 : 2000) : 2000)) return null;
      result[key] = raw;
    }
  }
  return result;
}
