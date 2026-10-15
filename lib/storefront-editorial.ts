import { storefrontTheme, type StorefrontTheme } from "./storefront-theme";

/**
 * Plantilla «Catálogo editorial» (referencia visual: catálogos impresos de alquiler). Fondo crema,
 * títulos serif, acento manuscrito opcional y un verde oliva oscuro como color de marca por defecto.
 * Si la empresa configuró su color de marca, manda ese; el oliva solo rige cuando no hay ninguno.
 */

/** Fondo crema de la plantilla (la empresa puede pisarlo con su fondo claro propio). */
export const EDITORIAL_BG = "#f4efe8";
/** Superficie de las tarjetas: un crema más claro, casi blanco, para que la foto «respire». */
export const EDITORIAL_SURFACE = "#fbf8f3";
/** Verde oliva (más verde que gris, para que el botón principal no parezca apagado) por defecto (contraste ≥ 4,5:1 contra el crema y contra el blanco). */
export const EDITORIAL_BRAND = "#556b2f";

/** Tema de la tienda para la plantilla editorial: marca de la empresa o, si no hay, el oliva. */
export function editorialTheme(theme: StorefrontTheme): StorefrontTheme {
  return theme.branded ? theme : storefrontTheme(EDITORIAL_BRAND);
}
