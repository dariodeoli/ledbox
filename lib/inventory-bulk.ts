/** Campos comunes editables del contrato actual; identidad/cantidad derivada no son masivas. */
export const ITEM_BULK_FIELDS = [
  { key: "category", label: "Categoría", type: "text", clear: false },
  { key: "inventoryKind", label: "Tipo", type: "kind", clear: false },
  { key: "status", label: "Estado", type: "status", clear: false },
  { key: "visibleOnWeb", label: "Visible en la web", type: "boolean", clear: false },
  { key: "notes", label: "Notas internas", type: "notes", clear: true },
  { key: "imageUrl", label: "URL manual de imagen", type: "text", clear: true },
  { key: "dailyCost", label: "Costo diario interno", type: "money", clear: true },
  { key: "replacementCost", label: "Reposición (secundario)", type: "money", clear: true },
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
      if (field.type === "boolean") { if (typeof raw !== "boolean") return null; }
      else if (field.type === "money" || field.type === "days") { if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > (field.type === "days" ? 3650 : 2147483647)) return null; }
      else if (typeof raw !== "string" || !raw.trim() || raw.length > (key === "category" ? 80 : key === "notes" ? (target === "units" ? 400 : 2000) : 2000)) return null;
      result[key] = raw;
    }
  }
  return result;
}
