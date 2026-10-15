/**
 * Acceso al catálogo (lo elige cada empresa): quién puede entrar a la tienda.
 *
 * - OPEN: cualquiera entra y pide (es lo de hoy).
 * - REQUEST: la persona pide acceso con sus datos; la empresa lo aprueba o rechaza desde el
 *   panel y, al aprobar, le llega su link por correo.
 * - PRIVATE: solo entra quien tenga el link que le dio la empresa.
 *
 * Reglas puras, compartidas por el servidor, el panel y la tienda.
 */

export const CATALOG_ACCESS_MODES = ["OPEN", "REQUEST", "PRIVATE"] as const;
export type CatalogAccessMode = (typeof CATALOG_ACCESS_MODES)[number];

export const CATALOG_ACCESS_MODE_LABEL: Record<CatalogAccessMode, string> = {
  OPEN: "Abierto",
  REQUEST: "Con solicitud",
  PRIVATE: "Privado",
};

export const CATALOG_ACCESS_MODE_HINT: Record<CatalogAccessMode, string> = {
  OPEN: "Cualquiera entra a la tienda y hace su pedido.",
  REQUEST: "El cliente pide acceso con sus datos y vos lo aprobás o rechazás. Al aprobar, le llega su link por correo.",
  PRIVATE: "Solo entra quien tenga el link que le des vos (desde la ficha del cliente o al aprobar una solicitud).",
};

export function isCatalogAccessMode(value: unknown): value is CatalogAccessMode {
  return typeof value === "string" && (CATALOG_ACCESS_MODES as readonly string[]).includes(value);
}

export const ACCESS_REQUEST_KINDS = ["RETAIL", "WHOLESALE"] as const;
export type AccessRequestKind = (typeof ACCESS_REQUEST_KINDS)[number];
export const ACCESS_REQUEST_KIND_LABEL: Record<AccessRequestKind, string> = { RETAIL: "Cliente final", WHOLESALE: "Mayorista" };

export const ACCESS_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
export const ACCESS_REQUEST_STATUS_LABEL: Record<AccessRequestStatus, string> = { PENDING: "Pendiente", APPROVED: "Aprobada", REJECTED: "Rechazada" };

/** Respuesta idéntica exista o no el correo: no revela si alguien ya pidió acceso. */
export const ACCESS_REQUEST_ACK = "Recibimos tu solicitud. Si la empresa la aprueba, te escribe al correo que dejaste con tu link de acceso.";
