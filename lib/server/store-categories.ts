import { resolveStoreCategory, storeCategories } from "@/lib/store-categories";
import { loadPublicCatalogItems, resolvePublicCatalog, type PublicRange } from "./catalog-public";

/** Las páginas y sus metadatos comparten el mismo límite: tienda OPEN, empresa actual y productos RETAIL/BOTH. */
export async function loadPublicCategory(orgSlug: string, categorySlug: string, range: PublicRange | null) {
  const context = await resolvePublicCatalog(orgSlug);
  if (!context || context.settings.catalogAccessMode !== "OPEN") return null;
  const items = await loadPublicCatalogItems(context, range);
  const categories = storeCategories(items);
  const category = resolveStoreCategory(categories, categorySlug);
  return category ? { context, items, categories, category } : null;
}
