/**
 * Preferencias de arranque del panel (clave, root y script). Sin React para
 * poder usarse desde el layout servidor. Se guardan en localStorage y se aplican
 * como atributos en `.admin-root` antes del primer pintado:
 * - `data-theme`: modo claro/oscuro.
 * - `data-sidebar`: sidebar de escritorio expandido (default) o colapsado a íconos.
 */

export const ADMIN_THEME_KEY = "ledbox-admin-theme";
export const ADMIN_SIDEBAR_KEY = "ledbox-admin-sidebar";
export const ADMIN_ROOT_ID = "admin-root";

export type AdminTheme = "dark" | "light";
export type AdminSidebarMode = "expanded" | "collapsed";

/**
 * Primer hijo de `.admin-root`: aplica el tema guardado y el sidebar colapsado
 * antes del primer pintado (sin parpadeo de layout al recargar).
 */
export const ADMIN_BOOT_SCRIPT = `(function(){var s=document.currentScript;var r=(s&&s.parentElement)||document.getElementById("${ADMIN_ROOT_ID}");if(!r||r.id!=="${ADMIN_ROOT_ID}")return;try{if(window.localStorage.getItem("${ADMIN_THEME_KEY}")==="light"){r.setAttribute("data-theme","light");}if(window.localStorage.getItem("${ADMIN_SIDEBAR_KEY}")==="collapsed"){r.setAttribute("data-sidebar","collapsed");}}catch(e){}})();`;
