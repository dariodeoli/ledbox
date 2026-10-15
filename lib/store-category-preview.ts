/** Vista acotada; no mezcla una categoría jerárquica con su padre ni con sus hermanas. */
export const CATEGORY_PREVIEW_LIMIT = 4;
export const CATEGORY_PREVIEW_EVENT = "cp:category-preview";
export type CategoryPreviewRequest = { catalogKey: string; category: string | null; targetId: string | null };
export function categoryPreviewItems<T extends { category: string }>(items: readonly T[], category: string): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (item.category === category) result.push(item);
    if (result.length === CATEGORY_PREVIEW_LIMIT) break;
  }
  return result;
}
