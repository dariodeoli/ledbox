/**
 * Buscador global del panel (⌘/Ctrl + K): contrato compartido entre el API
 * (`app/api/admin/search/route.ts`) y la paleta del shell
 * (`components/admin/AdminCommandPalette.tsx`).
 *
 * El API decide qué entra (empresa activa y permisos reales por rol) y entrega
 * resultados planos; la UI solo los agrupa con estas etiquetas y este orden.
 */

/** Mínimo de caracteres para buscar (menos que esto es «seguí escribiendo»). */
export const SEARCH_MIN_QUERY = 2;

/** Tope de resultados por tipo (clientes, presupuestos, eventos y usuarios). */
export const SEARCH_LIMIT_PER_TYPE = 6;

/** Tipos buscables, en el orden en que se agrupan en la paleta. */
export const SEARCH_GROUP_ORDER = ["client", "budget", "event", "user"] as const;

export type AdminSearchResultType = (typeof SEARCH_GROUP_ORDER)[number];

export const SEARCH_GROUP_LABELS: Record<AdminSearchResultType, string> = {
  client: "Clientes",
  budget: "Presupuestos",
  event: "Eventos",
  user: "Usuarios",
};

/** Un resultado del buscador: a dónde lleva y cómo se muestra. */
export type AdminSearchResult = {
  type: AdminSearchResultType;
  id: string;
  title: string;
  subtitle: string;
  /** Ruta real del panel donde vive el registro. */
  href: string;
};

export type AdminSearchGroup = {
  type: AdminSearchResultType;
  label: string;
  items: AdminSearchResult[];
};

/** Agrupa los resultados por tipo respetando `SEARCH_GROUP_ORDER`; sin grupos vacíos. */
export function groupSearchResults(results: readonly AdminSearchResult[]): AdminSearchGroup[] {
  return SEARCH_GROUP_ORDER.map((type) => ({
    type,
    label: SEARCH_GROUP_LABELS[type],
    items: results.filter((result) => result.type === type),
  })).filter((group) => group.items.length > 0);
}
