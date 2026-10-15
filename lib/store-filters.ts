import { tagKey } from "./store-tags";

/**
 * Filtros del catálogo de la tienda (capacidad, rango de precio, estilo o color, colección y «Disponible en mis fechas»).
 * Reglas puras sobre los datos públicos que ya trae cada producto: sin consultas nuevas. Las usan el catálogo y los tests.
 */

export type FilterableItem = {
  id: string;
  capacity?: number | null;
  tags?: string[];
  collections?: string[];
  availability: "AVAILABLE" | "LOW" | "CONSULT" | null;
};

export type StoreFilters = {
  /** Clave de una opción de `capacityOptions` (`"6"` exacta, `"10+"` desde 10) o `null`. */
  capacity: string | null;
  /** Pesos (guaraníes enteros) o `null` = sin tope. */
  priceMin: number | null;
  priceMax: number | null;
  /** Estilos elegidos (cualquiera de ellos alcanza). */
  tags: string[];
  collection: string | null;
  onlyAvailable: boolean;
};

export const EMPTY_FILTERS: StoreFilters = { capacity: null, priceMin: null, priceMax: null, tags: [], collection: null, onlyAvailable: false };

export type CapacityOption = { key: string; label: string; min: number; max: number };

/** Hasta 4 opciones a partir de las capacidades que existen: exactas y, si hay muchas, la última «N o más». */
export function capacityOptions(items: ReadonlyArray<Pick<FilterableItem, "capacity">>): CapacityOption[] {
  const values = [...new Set(items.map((item) => item.capacity).filter((value): value is number => typeof value === "number" && value > 0))].sort((a, b) => a - b);
  const person = (n: number) => (n === 1 ? "1 persona" : `${n} personas`);
  if (values.length <= 4) return values.map((n) => ({ key: String(n), label: person(n), min: n, max: n }));
  const top = values[3];
  return [...values.slice(0, 3).map((n) => ({ key: String(n), label: person(n), min: n, max: n })), { key: `${top}+`, label: `${top} o más`, min: top, max: Number.POSITIVE_INFINITY }];
}

export function activeFilterCount(filters: StoreFilters): number {
  return (filters.capacity ? 1 : 0) + (filters.priceMin !== null || filters.priceMax !== null ? 1 : 0) + (filters.tags.length > 0 ? 1 : 0) + (filters.collection ? 1 : 0) + (filters.onlyAvailable ? 1 : 0);
}

/** Texto de dígitos de un campo de monto → entero positivo o `null`. */
export function parsePriceBound(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** `unit` es el precio por día de hoy del producto (0 = sin precio: con un tope de precio puesto, queda afuera). */
export function matchesFilters<T extends FilterableItem>(item: T, filters: StoreFilters, options: { unit: number; capacities: readonly CapacityOption[] }): boolean {
  if (filters.capacity) {
    const option = options.capacities.find((entry) => entry.key === filters.capacity);
    const capacity = item.capacity ?? 0;
    if (option && (capacity < option.min || capacity > option.max)) return false;
  }
  if (filters.priceMin !== null || filters.priceMax !== null) {
    if (options.unit <= 0) return false;
    if (filters.priceMin !== null && options.unit < filters.priceMin) return false;
    if (filters.priceMax !== null && options.unit > filters.priceMax) return false;
  }
  if (filters.tags.length > 0) {
    const have = new Set((item.tags ?? []).map(tagKey));
    if (!filters.tags.some((tag) => have.has(tagKey(tag)))) return false;
  }
  if (filters.collection && !(item.collections ?? []).includes(filters.collection)) return false;
  if (filters.onlyAvailable && item.availability !== "AVAILABLE" && item.availability !== "LOW") return false;
  return true;
}
