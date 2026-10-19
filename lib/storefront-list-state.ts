import { isSortKey, type SortKey } from "./storefront-ui";
import { EMPTY_FILTERS, parsePriceBound, type StoreFilters } from "./store-filters";

/** Search, ordering and public catalog filters encoded in a shareable storefront URL. */
export type StoreListState = { query: string; sort: SortKey; filters: StoreFilters };
export const EMPTY_STORE_LIST_STATE: StoreListState = { query: "", sort: "destacados", filters: EMPTY_FILTERS };

export function readStoreListState(params: URLSearchParams): StoreListState {
  const tags = params.getAll("etiqueta").filter((tag) => tag.trim()).slice(0, 24);
  return {
    query: (params.get("q") ?? "").slice(0, 120),
    sort: isSortKey(params.get("orden")) ? params.get("orden") as SortKey : "destacados",
    filters: {
      capacity: params.get("capacidad") || null,
      priceMin: parsePriceBound(params.get("precioDesde") ?? ""),
      priceMax: parsePriceBound(params.get("precioHasta") ?? ""),
      tags,
      collection: params.get("coleccion") || null,
      onlyAvailable: params.get("disponible") === "1",
    },
  };
}

export function storeListStateFromQuery(query: Record<string, string | string[] | undefined>): StoreListState {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  }
  return readStoreListState(params);
}

export function writeStoreListState(url: URL, state: StoreListState): void {
  const { query, sort, filters } = state;
  const setOrDelete = (key: string, value: string | null) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  setOrDelete("q", query.trim() || null);
  setOrDelete("orden", sort === "destacados" ? null : sort);
  setOrDelete("capacidad", filters.capacity);
  setOrDelete("precioDesde", filters.priceMin === null ? null : String(filters.priceMin));
  setOrDelete("precioHasta", filters.priceMax === null ? null : String(filters.priceMax));
  url.searchParams.delete("etiqueta");
  for (const tag of filters.tags) url.searchParams.append("etiqueta", tag);
  setOrDelete("coleccion", filters.collection);
  setOrDelete("disponible", filters.onlyAvailable ? "1" : null);
}

/** Add current list controls to a category/collection href while keeping its own dates and route. */
export function mergeStoreListState(href: string, state: StoreListState): string {
  const url = new URL(href, "https://ledbox.invalid");
  writeStoreListState(url, state);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function storeListStateHref(currentHref: string, state: StoreListState): string {
  const url = new URL(currentHref, "https://ledbox.invalid");
  writeStoreListState(url, state);
  return `${url.pathname}${url.search}${url.hash}`;
}
