/**
 * Preferencias de arranque del panel (clave, root y script). Sin React para
 * poder usarse desde el layout servidor. Se guardan en localStorage y se aplican
 * como atributos en `.admin-root` antes del primer pintado:
 * - `data-theme`: modo claro/oscuro.
 * - `data-sidebar`: sidebar de escritorio expandido (default) o colapsado a íconos.
 * - `ADMIN_NAV_GROUP_KEY`: grupo abierto del nav en acordeón (issue #50).
 * - `ADMIN_PIN_DIGITS_KEY`: largo del PIN aprendido por navegador (issue #54).
 */

export const ADMIN_THEME_KEY = "ledbox-admin-theme";
export const ADMIN_SIDEBAR_KEY = "ledbox-admin-sidebar";
export const ADMIN_NAV_GROUP_KEY = "ledbox-admin-nav-group";
/**
 * Largo del PIN aprendido por navegador (issue #54), por usuario: se guarda
 * **solo la cantidad de dígitos** (4 o 6) después de un desbloqueo correcto, para
 * que el siguiente PIN se envíe exacto sin esperar la pausa. Nunca el PIN.
 */
export const ADMIN_PIN_DIGITS_KEY = "ledbox-admin-pin-digits";
export const ADMIN_ROOT_ID = "admin-root";

export type AdminTheme = "dark" | "light";
export type AdminSidebarMode = "expanded" | "collapsed";

/**
 * Primer hijo de `.admin-root`: aplica el tema guardado y el sidebar colapsado
 * antes del primer pintado (sin parpadeo de layout al recargar).
 */
export const ADMIN_BOOT_SCRIPT = `(function(){var s=document.currentScript;var r=(s&&s.parentElement)||document.getElementById("${ADMIN_ROOT_ID}");if(!r||r.id!=="${ADMIN_ROOT_ID}")return;try{if(window.localStorage.getItem("${ADMIN_THEME_KEY}")==="light"){r.setAttribute("data-theme","light");}if(window.localStorage.getItem("${ADMIN_SIDEBAR_KEY}")==="collapsed"){r.setAttribute("data-sidebar","collapsed");}}catch(e){}})();`;

/** Consulta los dígitos del PIN aprendidos para ese usuario en este navegador. */
export function readStoredPinDigits(userId: string | null | undefined): number | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const stored = Number(window.localStorage.getItem(`${ADMIN_PIN_DIGITS_KEY}:${userId}`));
    return Number.isInteger(stored) && stored >= 4 && stored <= 6 ? stored : null;
  } catch {
    return null;
  }
}

/** Guarda (o borra, con `null`) el largo del PIN aprendido; nunca guarda el PIN. */
export function storePinDigits(userId: string | null | undefined, digits: number | null): void {
  if (!userId || typeof window === "undefined") return;
  try {
    const key = `${ADMIN_PIN_DIGITS_KEY}:${userId}`;
    if (digits) window.localStorage.setItem(key, String(digits));
    else window.localStorage.removeItem(key);
  } catch {
    /* almacenamiento no disponible: el envío automático usa la pausa */
  }
}
