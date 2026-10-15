import type { PublicCatalogItem } from "@/lib/server/catalog-public";

/** Categorías con más equipos (hasta 6), cada una con la foto de su primer equipo que la tenga. */
export function featuredCategories(items: ReadonlyArray<Pick<PublicCatalogItem, "category" | "imageUrl">>) {
  const map = new Map<string, { category: string; count: number; imageUrl: string | null }>();
  for (const item of items) {
    const entry = map.get(item.category) ?? { category: item.category, count: 0, imageUrl: null };
    entry.count += 1;
    entry.imageUrl = entry.imageUrl ?? item.imageUrl;
    map.set(item.category, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "es")).slice(0, 6);
}
