import type { StockCountStatus } from "./stock-count";
import { inventorySkuValid, normalizeInventorySku } from "./field-rules";

/**
 * Variantes de producto (familias), módulo puro sin Prisma (docs/VARIANTES.md §2).
 *
 * Una familia agrupa productos que solo difieren en uno o dos ejes (color, talle…). Cada variante es
 * un producto completo; acá viven las reglas que no dependen de la base: ejes, opciones, clave de la
 * combinación, nombre completo y código de la familia.
 */

export const FAMILY_MAX_AXES = 2;
export const FAMILY_MAX_VALUES = 30;
export const FAMILY_VALUE_MAX = 40;
export const FAMILY_AXIS_LABEL_MAX = 40;
export const FAMILY_NAME_MAX = 120;
export const FAMILY_CODE_MAX = 60;
export const FAMILY_DESCRIPTION_MAX = 600;
/** Mismo tope que el nombre de un producto (`FIELD_LIMITS.name`): el nombre completo de la variante tiene que entrar. */
export const VARIANT_NAME_MAX = 120;
/** Tope de productos que se agrupan en una sola operación (el mismo que la edición en lote). */
export const FAMILY_GROUP_LIMIT = 100;

/** Solo el eje «color» lleva muestra de color. */
export const SWATCH_AXIS_KEY = "color";

export type FamilyAxisValue = { value: string; swatch?: string };
export type FamilyAxis = { key: string; label: string; values: FamilyAxisValue[] };
export type VariantOptions = Record<string, string>;

/** Minúsculas, sin tildes y con los espacios colapsados: para claves y comparaciones. */
export function normalizeVariantText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Clave de un eje a partir de su etiqueta: «Talle» → `talle`, «Largo de mesa» → `largo-de-mesa`. */
export function normalizeAxisKey(label: string): string {
  return normalizeVariantText(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** `#RRGGBB` (también `#rrggbb`) o `null`. Se guarda en mayúsculas. */
export function readSwatch(raw: unknown): string | null {
  const text = cleanText(raw);
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : null;
}

export type AxesResult = { ok: true; axes: FamilyAxis[] } | { ok: false; error: string };

/**
 * Valida los ejes que llegan del cliente: de 1 a 2 ejes, etiqueta de hasta 40, claves distintas, de 1 a
 * 30 valores por eje (hasta 40 caracteres, sin repetir ignorando mayúsculas y tildes). La muestra hex
 * es opcional y solo existe en el eje «color».
 */
export function readFamilyAxes(raw: unknown): AxesResult {
  if (!Array.isArray(raw) || raw.length < 1) return { ok: false, error: "Elegí al menos un eje (por ejemplo Color o Talle)." };
  if (raw.length > FAMILY_MAX_AXES) return { ok: false, error: `Una familia admite hasta ${FAMILY_MAX_AXES} ejes.` };
  const axes: FamilyAxis[] = [];
  const keys = new Set<string>();
  for (const entry of raw) {
    const source = (entry ?? {}) as Record<string, unknown>;
    const label = cleanText(source.label ?? source.key);
    const key = normalizeAxisKey(label);
    if (!label || label.length > FAMILY_AXIS_LABEL_MAX || !key) return { ok: false, error: `El nombre de cada eje va de 1 a ${FAMILY_AXIS_LABEL_MAX} caracteres.` };
    if (keys.has(key)) return { ok: false, error: `El eje «${label}» está repetido.` };
    keys.add(key);
    const rawValues = Array.isArray(source.values) ? source.values : [];
    if (rawValues.length > FAMILY_MAX_VALUES) return { ok: false, error: `El eje «${label}» admite hasta ${FAMILY_MAX_VALUES} valores.` };
    const values: FamilyAxisValue[] = [];
    const seen = new Set<string>();
    for (const item of rawValues) {
      const valueSource = typeof item === "string" ? { value: item } : ((item ?? {}) as Record<string, unknown>);
      const value = cleanText(valueSource.value);
      if (!value) continue;
      if (value.length > FAMILY_VALUE_MAX) return { ok: false, error: `Cada valor va hasta ${FAMILY_VALUE_MAX} caracteres («${value.slice(0, 20)}…»).` };
      const norm = normalizeVariantText(value);
      if (seen.has(norm)) return { ok: false, error: `El valor «${value}» está repetido en «${label}».` };
      seen.add(norm);
      const entryValue: FamilyAxisValue = { value };
      if (valueSource.swatch !== undefined && valueSource.swatch !== null && valueSource.swatch !== "") {
        if (key !== SWATCH_AXIS_KEY) return { ok: false, error: "Solo el eje «Color» lleva muestra de color." };
        const swatch = readSwatch(valueSource.swatch);
        if (!swatch) return { ok: false, error: `La muestra de «${value}» tiene que ser un color con formato #RRGGBB.` };
        entryValue.swatch = swatch;
      }
      values.push(entryValue);
    }
    axes.push({ key, label, values });
  }
  return { ok: true, axes };
}

/** Lee los ejes guardados (JSON de la base) sin fallar: lo inválido se descarta. */
export function axesFromJson(json: unknown): FamilyAxis[] {
  const result = readFamilyAxes(json);
  return result.ok ? result.axes : [];
}

export type OptionsResult = { ok: true; options: VariantOptions } | { ok: false; error: string };

/**
 * Valida las opciones de una variante: tiene exactamente los ejes de su familia (ni uno menos ni uno
 * de más) y cada valor va de 1 a 40 caracteres. Si el valor ya existe en el eje se usa su escritura
 * canónica («verde» → «Verde»); uno nuevo se acepta tal cual (el escritor lo suma al eje).
 */
export function readVariantOptions(raw: unknown, axes: readonly FamilyAxis[]): OptionsResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Faltan las opciones de la variante." };
  const source = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) source.set(normalizeAxisKey(key), value);
  const known = new Set(axes.map((axis) => axis.key));
  for (const key of source.keys()) if (!known.has(key)) return { ok: false, error: `La familia no tiene un eje «${key}».` };
  const options: VariantOptions = {};
  for (const axis of axes) {
    const value = cleanText(source.get(axis.key));
    if (!value) return { ok: false, error: `Elegí un valor para «${axis.label}».` };
    if (value.length > FAMILY_VALUE_MAX) return { ok: false, error: `El valor de «${axis.label}» va hasta ${FAMILY_VALUE_MAX} caracteres.` };
    const canonical = axis.values.find((entry) => normalizeVariantText(entry.value) === normalizeVariantText(value));
    options[axis.key] = canonical ? canonical.value : value;
  }
  return { ok: true, options };
}

/** Opciones guardadas (JSON de la base) como mapa de texto; lo que no sea texto se descarta. */
export function optionsFromJson(json: unknown): VariantOptions {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: VariantOptions = {};
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) if (typeof value === "string") out[key] = value;
  return out;
}

/** Combinación normalizada en el orden de los ejes: `color=verde|talle=35`. Es la clave única por familia. */
export function variantKey(options: VariantOptions, axes: readonly FamilyAxis[]): string {
  return axes.map((axis) => `${axis.key}=${normalizeVariantText(options[axis.key] ?? "")}`).join("|");
}

/** Nombre completo de la variante: «Plato Arabesco · Verde», «Zapato Ola · Negro · 35». */
export function variantDisplayName(familyName: string, options: VariantOptions, axes: readonly FamilyAxis[]): string {
  return [familyName.trim(), ...axes.map((axis) => options[axis.key]).filter((value): value is string => Boolean(value))].join(" · ");
}

/** Solo los valores, en el orden de los ejes: «Negro · 35» (para las pestañas y los chips). */
export function variantOptionsLabel(options: VariantOptions, axes: readonly FamilyAxis[]): string {
  return axes.map((axis) => options[axis.key]).filter((value): value is string => Boolean(value)).join(" · ");
}

/** Nombre de la familia validado (2 a 120 caracteres, espacios colapsados). */
export function readFamilyName(raw: unknown): string | null {
  const name = cleanText(raw);
  return name.length >= 2 && name.length <= FAMILY_NAME_MAX ? name : null;
}

/** Código de la familia: mismas reglas que el SKU. `null` si no es válido. */
export function readFamilyCode(raw: unknown): string | null {
  const code = normalizeInventorySku(typeof raw === "string" ? raw : "");
  return code && code.length <= FAMILY_CODE_MAX && inventorySkuValid(code) ? code : null;
}

/** Código sugerido a partir del nombre: «Plato Arabesco» → `PLATO-ARABESCO`. */
export function deriveFamilyCode(name: string): string {
  const base = normalizeVariantText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, FAMILY_CODE_MAX);
  return base.replace(/-+$/g, "") || "FAMILIA";
}

/** Descripción pública opcional (hasta 600 caracteres); `false` si es demasiado larga. */
export function readFamilyDescription(raw: unknown): string | null | false {
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length > FAMILY_DESCRIPTION_MAX) return false;
  return text || null;
}

/** Una variante puede escribirse con ejes si el nombre completo entra en el límite del nombre de producto. */
export function variantNameFits(familyName: string, options: VariantOptions, axes: readonly FamilyAxis[]): boolean {
  return variantDisplayName(familyName, options, axes).length <= VARIANT_NAME_MAX;
}

/** Suma a los ejes los valores de las opciones que todavía no estaban (conserva el orden y las muestras). */
export function mergeAxisValues(axes: readonly FamilyAxis[], optionsList: readonly VariantOptions[]): FamilyAxis[] {
  return axes.map((axis) => {
    const values = [...axis.values];
    for (const options of optionsList) {
      const value = options[axis.key];
      if (value && !values.some((entry) => normalizeVariantText(entry.value) === normalizeVariantText(value))) values.push({ value });
    }
    return { ...axis, values: values.slice(0, FAMILY_MAX_VALUES) };
  });
}

/** Valores de un eje que ninguna variante usa (para avisar al editar la lista). */
export function usedAxisValues(axisKey: string, optionsList: readonly VariantOptions[]): Set<string> {
  return new Set(optionsList.map((options) => normalizeVariantText(options[axisKey] ?? "")).filter(Boolean));
}

/** Campos de precio que «mismo precio para todas» copia de una variante a las demás. */
export const FAMILY_PRICE_FIELDS = ["listPrice", "wholesalePrice", "minimumPrice", "listFromDays", "listFromPrice", "wholesaleFromDays", "wholesaleFromPrice", "billingUnit"] as const;

/** Una familia con sus variantes, como la entrega el API (`GET /api/admin/inventory/families`). */
export type FamilyView = {
  id: string;
  name: string;
  code: string;
  categoryId: string | null;
  publicDescription: string | null;
  coverItemId: string | null;
  axes: FamilyAxis[];
  archivedAt: string | null;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    quantity: number;
    stockCountStatus: StockCountStatus;
    options: VariantOptions;
    ownPrice: boolean;
    sortOrder: number;
    listPrice: number;
    wholesalePrice: number;
    minimumPrice: number;
    billingUnit: string;
  }>;
};

/**
 * Nombre sugerido para una familia al agrupar productos: el prefijo común de sus nombres, sin separadores
 * ni palabras cortadas («Plato Arabesco Verde» + «Plato Arabesco Lila» → «Plato Arabesco»). Vacío si no hay.
 */
export function commonNamePrefix(names: readonly string[]): string {
  if (names.length === 0) return "";
  const words = names.map((name) => name.trim().split(/\s+/));
  const first = words[0];
  const shared: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    if (words.every((list) => list[index] !== undefined && normalizeVariantText(list[index]) === normalizeVariantText(first[index]))) shared.push(first[index]);
    else break;
  }
  const text = shared.join(" ").replace(/[\s·\-–—/,:]+$/g, "").trim();
  return names.length === 1 ? names[0].trim() : text;
}
