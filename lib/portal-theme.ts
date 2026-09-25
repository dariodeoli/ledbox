/**
 * Tema del portal del cliente (25-09-2026), sin React para usarse desde el
 * layout servidor. Igual que el panel: la preferencia vive en `localStorage` y
 * se aplica como `data-theme` en el contenedor del portal **antes del primer
 * pintado**, así el cambio no parpadea al recargar.
 *
 * El portal nace oscuro (identidad LedBox) y el visitante decide si lo quiere
 * claro; la elección es de este navegador, no de una cuenta.
 */

export const PORTAL_THEME_KEY = "ledbox-portal-theme";
export const PORTAL_ROOT_ID = "portal-root";

export type PortalTheme = "dark" | "light";

/**
 * Primer hijo de `.portal`: aplica el tema guardado antes del primer pintado.
 * Sin preferencia guardada queda el oscuro del HTML.
 */
export const PORTAL_BOOT_SCRIPT = `(function(){var s=document.currentScript;var r=(s&&s.parentElement)||document.getElementById("${PORTAL_ROOT_ID}");if(!r||r.id!=="${PORTAL_ROOT_ID}")return;try{if(window.localStorage.getItem("${PORTAL_THEME_KEY}")==="light"){r.setAttribute("data-theme","light");}}catch(e){}})();`;
