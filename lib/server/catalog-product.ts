import { db } from "./db";
import { inventoryImageUrl } from "./inventory-images";
import { loadPublicCatalogItems, type PublicCatalogContext, type PublicCatalogItem } from "./catalog-public";

/**
 * Ficha de un producto de la tienda (`/tienda/<slug>/p/<id o código>`): solo lo que la empresa publicó en ESE
 * catálogo (cliente final o mayorista, según el link). Un producto oculto, de otra empresa o de otra lista responde
 * `null` (404). Sin costos ni stock exacto: el mismo DTO público del catálogo.
 */

export type ProductDetail = {
  item: PublicCatalogItem;
  /** Piezas del juego con mini-foto (solo en combos). */
  includes: Array<{ name: string; quantity: number; sku: string | null; imageUrl: string | null }>;
  /** «Te puede interesar»: combos que contienen este producto + de la misma categoría (4 a 8 si hay). */
  related: PublicCatalogItem[];
};

export const RELATED_MIN = 4;
export const RELATED_MAX = 8;

/** Orden de sugeridos: primero los combos que lo contienen, después la misma categoría, después el resto; sin repetir. */
export function pickRelated(item: Pick<PublicCatalogItem, "id" | "category">, all: readonly PublicCatalogItem[], containingIds: ReadonlySet<string>): PublicCatalogItem[] {
  const others = all.filter((entry) => entry.id !== item.id);
  const groups = [
    others.filter((entry) => containingIds.has(entry.id)),
    others.filter((entry) => !containingIds.has(entry.id) && entry.category === item.category),
    others.filter((entry) => !containingIds.has(entry.id) && entry.category !== item.category),
  ];
  const picked: PublicCatalogItem[] = [];
  for (const group of groups) for (const entry of group) if (picked.length < RELATED_MAX) picked.push(entry);
  return picked;
}

export async function loadProductDetail(context: PublicCatalogContext, code: string): Promise<ProductDetail | null> {
  const wanted = code.trim();
  if (!wanted || wanted.length > 80) return null;
  const all = await loadPublicCatalogItems(context, null);
  const item = all.find((entry) => entry.id === wanted) ?? all.find((entry) => entry.sku && entry.sku.toLowerCase() === wanted.toLowerCase());
  if (!item) return null;
  const organizationId = context.organization.id;
  const [parts, containing] = await Promise.all([
    db.inventoryComponent.findMany({
      where: { organizationId, parentId: item.id },
      orderBy: { component: { name: "asc" } },
      select: { quantity: true, component: { select: { id: true, name: true, sku: true, imageUrl: true, imageMime: true, updatedAt: true } } },
    }),
    db.inventoryComponent.findMany({ where: { organizationId, componentId: item.id }, select: { parentId: true } }),
  ]);
  return {
    item,
    includes: parts.map((part) => ({ name: part.component.name, quantity: part.quantity, sku: part.component.sku, imageUrl: inventoryImageUrl(part.component) })),
    related: pickRelated(item, all, new Set(containing.map((row) => row.parentId))),
  };
}
