/**
 * Categorías de inventario (rediseño E1): reglas puras, sin base ni React.
 *
 * Tres niveles de taxonomía: Tipo (`InventoryKind`), Categoría y Subcategoría (un solo nivel de
 * hija). El texto `InventoryItem.category` queda como espejo de «Categoría › Subcategoría» para
 * no romper la tienda, los sustitutos ni las exportaciones. La `key` replica la normalización de
 * la migración `202610240001_inventory_taxonomy_warehouses` (si cambia, actualizá los dos).
 */

/** Separador del espejo de texto. */
export const CATEGORY_SEPARATOR = " › ";

/** Tope del nombre de una categoría o subcategoría. */
export const CATEGORY_NAME_MAX = 60;

/** Tonos de la paleta del panel que puede llevar una categoría. */
export const CATEGORY_TONES = ["neutral", "info", "ok", "warn", "danger", "accent"] as const;
export type CategoryTone = (typeof CATEGORY_TONES)[number];

/** Íconos que se ofrecen para una categoría (nombres de `AdminIconName`). */
export const CATEGORY_ICONS = ["inventory", "events", "calendar", "clients", "suppliers", "promoters", "building", "image", "globe", "settings"] as const;

/** Clave de comparación de un nombre: minúsculas, sin tildes, espacios colapsados. */
export function categoryKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Clave de una subcategoría: ruta «padre/hija». */
export function categoryPathKey(parentName: string, childName?: string | null): string {
  const parent = categoryKey(parentName);
  return childName ? `${parent}/${categoryKey(childName)}` : parent;
}

const clean = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** Nombre válido de categoría: sin separadores de ruta y de 1 a 60 caracteres. */
export function categoryNameValid(name: string): boolean {
  const value = clean(name);
  return value.length >= 1 && value.length <= CATEGORY_NAME_MAX && !/[›>/]/.test(value);
}

export type CategoryPath = { parent: string; child: string | null };

/**
 * Categoría y subcategoría de lo que escribió la persona o vino de un archivo. Acepta los dos
 * campos por separado o una ruta en uno solo («Vajilla / Copas», «Vajilla > Copas», «Vajilla ›
 * Copas»). Con más de dos tramos, los restantes se unen en la hija. Vacío = «General».
 */
export function parseCategoryInput(category: unknown, subcategory?: unknown): CategoryPath {
  const parts = clean(category)
    .split(/\s*(?:›|>|\/)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const parent = (parts[0] ?? "General").slice(0, CATEGORY_NAME_MAX);
  const explicit = clean(subcategory);
  const inline = parts.length > 1 ? parts.slice(1).join(" - ") : "";
  const child = (explicit || inline).slice(0, CATEGORY_NAME_MAX).trim();
  return { parent, child: child || null };
}

/** Espejo de texto: «Padre» o «Padre › Hija». */
export function categoryLabel(parentName: string, childName?: string | null): string {
  return childName ? `${parentName}${CATEGORY_SEPARATOR}${childName}` : parentName;
}

export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  key: string;
  sortOrder: number;
  color: string | null;
  icon: string | null;
  archivedAt: string | null;
  itemCount: number;
  children: CategoryNode[];
};

/** Arma el árbol (un nivel) desde filas planas, ordenado por `sortOrder` y nombre. */
export function buildCategoryTree(rows: ReadonlyArray<Omit<CategoryNode, "children">>): CategoryNode[] {
  const order = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es");
  const roots = rows.filter((row) => !row.parentId).sort(order);
  return roots.map((root) => ({
    ...root,
    children: rows
      .filter((row) => row.parentId === root.id)
      .sort(order)
      .map((child) => ({ ...child, children: [] })),
  }));
}

/** Padre y hija de un nodo ya resuelto desde su id (para precargar los formularios). */
export function categoryParts(tree: readonly CategoryNode[], categoryId: string | null | undefined): { parent: string; child: string } | null {
  if (!categoryId) return null;
  for (const root of tree) {
    if (root.id === categoryId) return { parent: root.name, child: "" };
    const child = root.children.find((entry) => entry.id === categoryId);
    if (child) return { parent: root.name, child: child.name };
  }
  return null;
}
