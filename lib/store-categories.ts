import { collectionSlug } from "./collections";

export type StoreDateRange = { fromKey: string; toKey: string } | null;
export type StoreCategory = { name: string; slug: string };

/** Huella del nombre público, no de los identificadores internos de la empresa. */
function fingerprint(name: string): string {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) hash = Math.imul(hash ^ name.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const baseSlug = (name: string) => collectionSlug(name) || "categoria";
const collisionSlug = (name: string) => `${baseSlug(name)}--${fingerprint(name)}`;

/** Solo recibe nombres del catálogo ya autorizado: nunca consulta categorías privadas o de otra empresa. */
export function storeCategories(items: ReadonlyArray<{ category: string }>): StoreCategory[] {
  const names = [...new Set(items.map((item) => item.category))];
  const groups = new Map<string, string[]>();
  for (const name of names) groups.set(baseSlug(name), [...(groups.get(baseSlug(name)) ?? []), name]);
  return names.map((name) => {
    const peers = groups.get(baseSlug(name))!;
    if (peers.length === 1) return { name, slug: baseSlug(name) };
    const sameHash = peers.filter((peer) => fingerprint(peer) === fingerprint(name));
    // Incluso una colisión de la huella tiene una salida única y determinista.
    const suffix = sameHash.length > 1 ? Array.from(name).map((character) => character.codePointAt(0)!.toString(16)).join("-") : fingerprint(name);
    return { name, slug: `${baseSlug(name)}--${suffix}` };
  });
}

/** Acepta el enlace con huella anterior si una categoría homónima dejó de ser pública; luego se canonicaliza. */
export function resolveStoreCategory(categories: readonly StoreCategory[], slug: string): StoreCategory | null {
  return categories.find((category) => category.slug === slug) ?? categories.find((category) => collisionSlug(category.name) === slug) ?? null;
}

/** Rango ya validado por parsePublicRange; no arrastra filtros, tokens ni otros parámetros de la URL actual. */
export function withStoreDates(path: string, range: StoreDateRange): string {
  if (!range) return path;
  const params = new URLSearchParams({ desde: range.fromKey, hasta: range.toKey });
  const [location, fragment] = path.split("#", 2);
  return `${location}${location.includes("?") ? "&" : "?"}${params}${fragment ? `#${fragment}` : ""}`;
}

export function storeCategoryHref(basePath: string, category: StoreCategory, range: StoreDateRange): string {
  return withStoreDates(`${basePath}/categoria/${encodeURIComponent(category.slug)}`, range);
}

/** Actualiza el filtro de categoría en la URL actual sin navegación ni pérdida de filtros/fecha/scroll. */
export function storeCategoryStateHref(currentHref: string, category: string | null): string {
  const url = new URL(currentHref, "https://ledbox.invalid");
  if (category) url.searchParams.set("categoria", category);
  else url.searchParams.delete("categoria");
  return `${url.pathname}${url.search}${url.hash}`;
}
