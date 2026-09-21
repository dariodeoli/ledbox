/**
 * Tema del panel (clave, root y script de arranque). Sin React para poder usarse desde el layout servidor.
 * El modo claro/oscuro se guarda en localStorage y se aplica como `data-theme` en `.admin-root`.
 */

export const ADMIN_THEME_KEY = "ledbox-admin-theme";
export const ADMIN_ROOT_ID = "admin-root";

export type AdminTheme = "dark" | "light";

/** Primer hijo de `.admin-root`: aplica el tema guardado antes del primer pintado. */
export const ADMIN_THEME_SCRIPT = `(function(){var s=document.currentScript;var r=(s&&s.parentElement)||document.getElementById("${ADMIN_ROOT_ID}");try{if(window.localStorage.getItem("${ADMIN_THEME_KEY}")==="light"&&r&&r.id==="${ADMIN_ROOT_ID}"){r.setAttribute("data-theme","light");}}catch(e){}})();`;
