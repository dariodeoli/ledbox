/**
 * Parámetros de las tablas de plataforma (puro): `q`, filtros, `orden`, `pag` y `detalle`
 * salen de la URL y se validan contra listas cerradas. Nada de esto toca la base.
 */

export const PAGE_SIZE = 30;
export const MAX_QUERY_LENGTH = 80;
export const SEARCH_LIMIT = 120;
export const EXPORT_LIMIT = 20;
export const EXPORT_MAX_ROWS = 5000;

export type RawParams = Record<string, string | string[] | undefined>;

export type TableParams = {
  q: string;
  filters: Record<string, string>;
  /** Clave de orden ya validada y dirección. */
  sort: string;
  dir: "asc" | "desc";
  page: number;
  detail: string | null;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Pagina: entero ≥ 1; basura → 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const n = Number.parseInt(first(raw), 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 1;
}

/**
 * `sorts`: claves de orden permitidas (la primera es el valor por defecto);
 * `filterOptions`: por filtro, los valores permitidos (otro valor se ignora).
 */
export function parseTableParams(
  raw: RawParams,
  spec: { sorts: readonly string[]; defaultDir?: "asc" | "desc"; filterOptions: Record<string, readonly string[]> },
): TableParams {
  const q = first(raw.q).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  const orderRaw = first(raw.orden);
  const desc = orderRaw.startsWith("-");
  const key = desc ? orderRaw.slice(1) : orderRaw;
  const sorted = spec.sorts.includes(key);
  const filters: Record<string, string> = {};
  for (const [name, allowed] of Object.entries(spec.filterOptions)) {
    const value = first(raw[name]);
    if (value && allowed.includes(value)) filters[name] = value;
  }
  const detail = first(raw.detalle).slice(0, 80);
  return {
    q,
    filters,
    sort: sorted ? key : spec.sorts[0],
    dir: sorted ? (desc ? "desc" : "asc") : spec.defaultDir ?? "asc",
    page: parsePage(raw.pag),
    detail: /^[A-Za-z0-9_-]+$/.test(detail) ? detail : null,
  };
}

/** Patrón `ILIKE` seguro: escapa `\`, `%` y `_` para que el texto del usuario sea literal. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

/** URL con los parámetros actuales y los cambios (valor vacío o `undefined` = quitar). */
export function withParams(basePath: string, raw: RawParams, changes: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    if (name in changes || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(name, item);
  }
  for (const [name, value] of Object.entries(changes)) if (value) query.set(name, value);
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

export type Limiter = (key: string, limit: number) => Promise<{ allowed: boolean; retryAfter: number }>;

/**
 * Límite de búsqueda por usuario, ANTES de consultar. Sin texto de búsqueda no cuenta.
 * Si falla el limitador, se deniega (cerrado) y queda el warn.
 */
export async function searchAllowed(userId: string, q: string, limiter: Limiter): Promise<boolean> {
  if (!q) return true;
  try {
    return (await limiter(`superadmin:buscar:${userId}`, SEARCH_LIMIT)).allowed;
  } catch (error) {
    console.warn("[platform] límite de búsqueda falló; se deniega", error instanceof Error ? error.message : error);
    return false;
  }
}

export function totalPages(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}
