/**
 * Alcance de un producto en la tienda web de la empresa. Reglas puras (sin base
 * ni red) compartidas por el servidor, el API del panel y la UI de inventario.
 *
 * `visibleOnWeb` sigue existiendo y se mantiene sincronizado: es `true` cuando el
 * alcance no es HIDDEN. Una fila vieja sin alcance (NULL) se lee por ese booleano.
 */

export const CATALOG_AUDIENCES = ["HIDDEN", "RETAIL", "WHOLESALE", "BOTH"] as const;
export type CatalogAudience = (typeof CATALOG_AUDIENCES)[number];

/** Lista de precios de un pedido o de un catálogo: cliente final o mayorista. */
export const PRICE_LISTS = ["RETAIL", "WHOLESALE"] as const;
export type PriceList = (typeof PRICE_LISTS)[number];

export const CATALOG_AUDIENCE_LABEL: Record<CatalogAudience, string> = {
  HIDDEN: "Oculto",
  RETAIL: "Cliente final",
  WHOLESALE: "Mayorista",
  BOTH: "Ambos",
};

export function isCatalogAudience(value: unknown): value is CatalogAudience {
  return typeof value === "string" && (CATALOG_AUDIENCES as readonly string[]).includes(value);
}

export function isPriceList(value: unknown): value is PriceList {
  return typeof value === "string" && (PRICE_LISTS as readonly string[]).includes(value);
}

/** Alcance efectivo de una fila: el guardado o, en filas viejas, el que dice `visibleOnWeb`. */
export function effectiveAudience(row: { catalogAudience?: string | null; visibleOnWeb?: boolean | null }): CatalogAudience {
  if (isCatalogAudience(row.catalogAudience)) return row.catalogAudience;
  return row.visibleOnWeb ? "BOTH" : "HIDDEN";
}

/** `visibleOnWeb` que corresponde a un alcance (distinto de HIDDEN). */
export const visibleOnWebFor = (audience: CatalogAudience): boolean => audience !== "HIDDEN";

/** ¿Un producto con este alcance aparece en el catálogo de esa lista de precios? */
export function audienceShownIn(audience: CatalogAudience, list: PriceList): boolean {
  return audience === "BOTH" || audience === list;
}

/** Alcances que muestra cada catálogo. */
export const AUDIENCES_FOR: Record<PriceList, readonly CatalogAudience[]> = {
  RETAIL: ["RETAIL", "BOTH"],
  WHOLESALE: ["WHOLESALE", "BOTH"],
};

/**
 * Filtro de Prisma de los productos publicados en un catálogo. Las filas viejas
 * sin alcance (NULL) siguen el booleano, pero solo para el catálogo de cliente
 * final: un producto nunca llega al mayorista sin elegirlo de forma explícita.
 */
export function catalogAudienceWhere(list: PriceList) {
  const explicit = { catalogAudience: { in: [...AUDIENCES_FOR[list]] } };
  if (list === "WHOLESALE") return explicit;
  return { OR: [explicit, { catalogAudience: null, visibleOnWeb: true }] };
}

/**
 * Normaliza lo que manda el panel: acepta `catalogAudience` o, por compatibilidad, el
 * booleano viejo `visibleOnWeb` (true = BOTH, false = HIDDEN). `undefined` = no tocar.
 */
export function readAudienceInput(body: { catalogAudience?: unknown; visibleOnWeb?: unknown }):
  | { ok: true; audience: CatalogAudience | undefined }
  | { ok: false; error: string } {
  if (body.catalogAudience !== undefined) {
    if (!isCatalogAudience(body.catalogAudience)) {
      return { ok: false, error: "El alcance en la tienda tiene que ser Oculto, Cliente final, Mayorista o Ambos." };
    }
    return { ok: true, audience: body.catalogAudience };
  }
  if (body.visibleOnWeb !== undefined) {
    if (typeof body.visibleOnWeb !== "boolean") return { ok: false, error: "La visibilidad web tiene que ser sí o no." };
    return { ok: true, audience: body.visibleOnWeb ? "BOTH" : "HIDDEN" };
  }
  return { ok: true, audience: undefined };
}

/** Opciones del campo segmentado «Oculto / Cliente final / Mayorista / Ambos» (en ese orden). */
export const CATALOG_AUDIENCE_OPTIONS: ReadonlyArray<{ value: CatalogAudience; label: string }> = CATALOG_AUDIENCES.map((value) => ({
  value,
  label: CATALOG_AUDIENCE_LABEL[value],
}));
