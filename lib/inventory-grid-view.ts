import { matchesQuery } from "./admin-policy";
import type { AdminInventoryGridRow } from "./admin-types";
import type { CategoryNode } from "./inventory-categories";
import { inventoryStateMatches } from "./inventory-visual-state";
import { itemInFocus, type InventoryFocus, type InventoryFocusContext } from "./inventory-view";

/**
 * Filtros y agrupaciones de la pantalla de Inventario (rediseño E2), puros y sin red: la
 * búsqueda, Tipo, Categoría (con subcategorías), Depósito, Estado, Proveedor y el foco de los
 * indicadores se combinan con «Y». La disponibilidad por rango ya viene calculada por el API.
 */

export type InventoryGridFilters = {
  query: string;
  kind: string;
  /** Id de categoría; si es una categoría padre incluye sus subcategorías. */
  categoryId: string;
  warehouseId: string;
  /** Clave del mapa de estados (`rented`, `overdue`…), `reserved` o `ALL`. */
  state: string;
  supplierId: string;
  /** Id de la familia de variantes (`""` = todas). */
  familyId: string;
  focus: InventoryFocus;
};

export const EMPTY_GRID_FILTERS: InventoryGridFilters = { query: "", kind: "ALL", categoryId: "", warehouseId: "", state: "ALL", supplierId: "", familyId: "", focus: "all" };

export type InventoryFilterContext = InventoryFocusContext & {
  /** Productos con una unidad cuyo código coincide con la búsqueda (viene del API). */
  unitMatchIds: ReadonlySet<string>;
  categoryTree: readonly CategoryNode[];
};

/** Ids que abarca una categoría elegida: ella y, si es padre, sus subcategorías. */
export function categoryScope(tree: readonly CategoryNode[], categoryId: string): Set<string> {
  const ids = new Set<string>();
  if (!categoryId) return ids;
  for (const root of tree) {
    if (root.id === categoryId) {
      ids.add(root.id);
      for (const child of root.children) ids.add(child.id);
    } else if (root.children.some((child) => child.id === categoryId)) {
      ids.add(categoryId);
    }
  }
  return ids;
}

/** Filtros activos (para el botón «Limpiar filtros» y el aviso de «sin resultados»). */
export function activeFilterCount(filters: InventoryGridFilters, rangeActive: boolean): number {
  return [
    filters.query.trim() !== "",
    filters.kind !== "ALL",
    filters.categoryId !== "",
    filters.warehouseId !== "",
    filters.state !== "ALL",
    filters.supplierId !== "",
    filters.familyId !== "",
    filters.focus !== "all",
    rangeActive,
  ].filter(Boolean).length;
}

/**
 * Productos que cumplen todos los filtros. `archived` separa las dos listas: las activas y las
 * archivadas (el filtro de estado «Archivado» elige la segunda en la lista principal).
 */
export function applyInventoryFilters(
  rows: ReadonlyArray<AdminInventoryGridRow>,
  filters: InventoryGridFilters,
  context: InventoryFilterContext,
  options: { archived?: boolean } = {},
): AdminInventoryGridRow[] {
  const wantArchived = options.archived ?? false;
  const scope = categoryScope(context.categoryTree, filters.categoryId);
  return rows.filter((row) => {
    if (Boolean(row.archivedAt) !== wantArchived) return false;
    if (filters.kind !== "ALL" && row.kind !== filters.kind) return false;
    if (filters.categoryId && !(row.categoryId && scope.has(row.categoryId))) return false;
    if (filters.familyId && row.familyId !== filters.familyId) return false;
    if (filters.warehouseId && !row.stock.locations.some((place) => place.warehouseId === filters.warehouseId)) return false;
    if (filters.supplierId && row.supplierId !== filters.supplierId && !row.stock.supplierIds.includes(filters.supplierId)) return false;
    if (!wantArchived && !inventoryStateMatches(row, filters.state)) return false;
    if (filters.query.trim() && !matchesQuery(filters.query, [row.name, row.category, row.sku]) && !context.unitMatchIds.has(row.id)) return false;
    return itemInFocus(row, filters.focus, context);
  });
}

// ── Categoría (filtro en árbol y vista «Por categoría») ──────────────────────

export type CategoryFilterOption = { value: string; label: string };

/** Opciones planas del árbol: «Vajilla», «    › Copas»… (la subcategoría va sangrada). */
export function categoryFilterOptions(tree: readonly CategoryNode[], allLabel = "Todas las categorías"): CategoryFilterOption[] {
  const options: CategoryFilterOption[] = [{ value: "", label: allLabel }];
  for (const root of tree) {
    if (root.archivedAt) continue;
    options.push({ value: root.id, label: root.name });
    for (const child of root.children) {
      if (!child.archivedAt) options.push({ value: child.id, label: `   › ${child.name}` });
    }
  }
  return options;
}

/** Opciones del filtro «Familia»: las familias que tienen al menos una variante en la lista, por nombre. */
export function familyFilterOptions(rows: ReadonlyArray<Pick<AdminInventoryGridRow, "familyId" | "familyName">>, allLabel = "Todas las familias"): CategoryFilterOption[] {
  const families = new Map<string, string>();
  for (const row of rows) if (row.familyId && row.familyName) families.set(row.familyId, row.familyName);
  return [{ value: "", label: allLabel }, ...[...families].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([value, label]) => ({ value, label }))];
}

export type CategorySection = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  rows: AdminInventoryGridRow[];
  /** Productos con unidades libres hoy: suma de libres de los productos con stock propio. */
  free: number;
};

/** Sección para los productos sin categoría del árbol. */
export const UNCATEGORIZED_ID = "__sin-categoria__";

/**
 * Secciones por categoría padre, en el orden del árbol (`sortOrder`). Cada producto va a la
 * sección de su categoría (o de la padre de su subcategoría); lo que no esté ligado queda en
 * «Sin categoría». Dentro de la sección: subcategoría y nombre. Las secciones vacías no se dibujan.
 */
export function groupByCategory(rows: ReadonlyArray<AdminInventoryGridRow>, tree: readonly CategoryNode[]): CategorySection[] {
  const rootOf = new Map<string, CategoryNode>();
  for (const root of tree) {
    rootOf.set(root.id, root);
    for (const child of root.children) rootOf.set(child.id, root);
  }
  const buckets = new Map<string, AdminInventoryGridRow[]>();
  for (const row of rows) {
    const root = row.categoryId ? rootOf.get(row.categoryId) : undefined;
    const key = root?.id ?? UNCATEGORIZED_ID;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  const sections: CategorySection[] = [];
  for (const root of tree) {
    const list = buckets.get(root.id);
    if (list?.length) sections.push(toSection(root.id, root.name, root.icon, root.color, list));
  }
  const rest = buckets.get(UNCATEGORIZED_ID);
  if (rest?.length) sections.push(toSection(UNCATEGORIZED_ID, "Sin categoría", null, null, rest));
  return sections;
}

function toSection(id: string, name: string, icon: string | null, color: string | null, list: AdminInventoryGridRow[]): CategorySection {
  const sorted = [...list].sort((a, b) => a.category.localeCompare(b.category, "es") || a.name.localeCompare(b.name, "es"));
  return { id, name, icon, color, rows: sorted, free: sorted.filter((row) => !row.combo).reduce((sum, row) => sum + row.availability.availableNow, 0) };
}

// ── Ubicación ───────────────────────────────────────────────────────────────

/**
 * Texto de la columna «Ubicación»: la abreviatura (`D1-E3-B2`) si todas las unidades están en un
 * solo lugar, «3 depósitos» si hay varios, «—» si no hay unidades con depósito (nunca inventa).
 */
export function locationSummary(
  stock: AdminInventoryGridRow["stock"],
  warehouses: ReadonlyArray<{ id: string; code: string }>,
  abbreviate: (code: string | undefined, location: string | null | undefined) => string | null,
): { text: string; title: string } {
  const places = stock.locations.filter((place) => place.warehouseId || place.location);
  if (places.length === 0) return { text: "—", title: "Sin depósito ni ubicación cargados." };
  const warehouseIds = new Set(places.map((place) => place.warehouseId ?? "none"));
  if (places.length === 1) {
    const only = places[0];
    const code = warehouses.find((warehouse) => warehouse.id === only.warehouseId)?.code;
    const text = abbreviate(code, only.location) ?? code ?? "—";
    return { text, title: `${stock.unitCount} unidades en ${text}` };
  }
  if (warehouseIds.size > 1) {
    return { text: `${warehouseIds.size} depósitos`, title: places.map((place) => `${warehouses.find((w) => w.id === place.warehouseId)?.code ?? "?"}${place.location ? `-${place.location}` : ""}: ${place.units}`).join(" · ") };
  }
  const code = warehouses.find((warehouse) => warehouse.id === places[0].warehouseId)?.code;
  return { text: `${code ?? "Depósito"} · ${places.length} ubicaciones`, title: places.map((place) => `${abbreviate(code, place.location) ?? code ?? "—"}: ${place.units}`).join(" · ") };
}
