/**
 * Orden de la tienda web que decide la empresa (Ajustes → Tienda). Reglas puras, sin base ni red:
 * las comparten el servidor (que ordena el catálogo público y guarda el orden) y el panel.
 *
 * - **Secciones** = categorías del árbol de inventario, ordenadas por `InventoryCategory.sortOrder`.
 * - **Productos** dentro de cada sección, ordenados por `InventoryItem.webSortOrder` (por empresa).
 * - Lo que no tiene orden cargado (valor 0 o categoría sin nodo en el árbol) queda al final de su
 *   grupo y, a igual orden, alfabético: la tienda nunca queda desordenada por no haber ordenado.
 */

export type OrderableItem = {
  name: string;
  /** Texto de la sección (espejo «Categoría › Subcategoría»). */
  category: string;
  /** `sortOrder` del nodo del árbol; `null` si el producto no tiene categoría en el árbol. */
  categorySort: number | null;
  webSortOrder: number;
};

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Orden único de la tienda: secciones por su orden, productos por el suyo, después por nombre. */
export function compareStorefrontItems(a: OrderableItem, b: OrderableItem): number {
  const sa = a.categorySort ?? Number.MAX_SAFE_INTEGER;
  const sb = b.categorySort ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  const byCategory = collator.compare(a.category, b.category);
  if (byCategory !== 0) return byCategory;
  if (a.webSortOrder !== b.webSortOrder) return a.webSortOrder - b.webSortOrder;
  return collator.compare(a.name, b.name);
}

export function sortStorefrontItems<T extends OrderableItem>(items: readonly T[]): T[] {
  return [...items].sort(compareStorefrontItems);
}

/** Mueve `id` una posición (`-1` arriba, `+1` abajo); sin cambios si ya está en el borde o no existe. */
export function moveId<T>(list: readonly T[], id: T, delta: -1 | 1): T[] {
  const from = list.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Mueve `id` a la posición de `target` (arrastrar y soltar). */
export function moveIdBefore<T>(list: readonly T[], id: T, target: T): T[] {
  const from = list.indexOf(id);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...list];
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Valor de orden que se guarda para la posición `index` (0 = primero). Deja huecos y nunca es 0. */
export const sortValueAt = (index: number): number => (index + 1) * 10;

export const STOREFRONT_ORDER_LIMITS = { sections: 300, items: 2000 } as const;

export type StorefrontOrderInput = { sections: Array<{ categoryId: string; itemIds: string[] }> };

/**
 * Valida lo que manda el panel: `{ sections: [{ categoryId, itemIds[] }] }` en el orden deseado.
 * Ids no vacíos y sin repetir; el servidor además verifica que todos sean de la empresa activa.
 */
export function parseStorefrontOrder(body: unknown): { ok: true; value: StorefrontOrderInput } | { ok: false; error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!Array.isArray(record.sections) || record.sections.length === 0) return { ok: false, error: "No hay secciones para ordenar." };
  if (record.sections.length > STOREFRONT_ORDER_LIMITS.sections) return { ok: false, error: "Hay demasiadas secciones." };
  const seenSections = new Set<string>();
  const seenItems = new Set<string>();
  const sections: StorefrontOrderInput["sections"] = [];
  for (const raw of record.sections) {
    const section = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const categoryId = typeof section.categoryId === "string" ? section.categoryId.trim() : "";
    if (!categoryId || categoryId.length > 64 || seenSections.has(categoryId)) return { ok: false, error: "Hay una sección repetida o sin identificar." };
    seenSections.add(categoryId);
    const rawItems = Array.isArray(section.itemIds) ? section.itemIds : [];
    const itemIds: string[] = [];
    for (const id of rawItems) {
      if (typeof id !== "string" || !id.trim() || id.length > 64 || seenItems.has(id)) return { ok: false, error: "Hay un producto repetido o sin identificar." };
      seenItems.add(id);
      itemIds.push(id);
    }
    sections.push({ categoryId, itemIds });
  }
  if (seenItems.size > STOREFRONT_ORDER_LIMITS.items) return { ok: false, error: "Hay demasiados productos." };
  return { ok: true, value: { sections } };
}
