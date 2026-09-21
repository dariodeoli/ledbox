const DEFAULT_SITE_URL = "https://ledbox.online";
const DEFAULT_ADMIN_URL = "https://admin.ledbox.online";
const DEFAULT_CLIENT_URL = "https://cliente.ledbox.online";
const DEFAULT_WHATSAPP_NUMBER = "595982029217";

export const publicConfig = {
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, ""),
  adminUrl: (process.env.NEXT_PUBLIC_ADMIN_URL || DEFAULT_ADMIN_URL).replace(/\/$/, ""),
  /** Portal del cliente (issue #12): host público de los presupuestos aprobables. */
  clientUrl: (process.env.NEXT_PUBLIC_CLIENT_URL || DEFAULT_CLIENT_URL).replace(/\/$/, ""),
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER,
} as const;

export function whatsappUrl(message: string): string {
  return `https://wa.me/${publicConfig.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

// ── Código público del presupuesto (issue #12) ─────────────────────────────
// El código es la única credencial del link: alfabeto sin caracteres ambiguos
// (nada de 0/1/I/L/O) y 20 caracteres (100 bits) en grupos de cuatro para poder
// dictarlo por teléfono. Se genera en el servidor; acá viven el link público y
// la normalización que comparten el portal, el panel y la hoja impresa.

export const BUDGET_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BUDGET_CODE_LENGTH = 20;

/** Link público de un presupuesto en el portal del cliente. */
export function portalBudgetUrl(token: string): string {
  return `${publicConfig.clientUrl}/p/${token}`;
}

/** Código canónico agrupado (`XXXX-XXXX-XXXX-XXXX-XXXX`). */
export function formatBudgetCode(compact: string): string {
  return compact.match(/.{4}/g)?.join("-") ?? compact;
}

/**
 * Acepta el link completo (`https://cliente.ledbox.online/p/<código>`), el
 * path o el código suelto —con o sin guiones, en cualquier caja— y devuelve el
 * código canónico agrupado, o `null` si no tiene la forma esperada.
 */
export function normalizeBudgetCode(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(/\/p\/([^/?#\s]+)/i)?.[1] ?? raw;
  const compact = fromUrl.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (compact.length !== BUDGET_CODE_LENGTH) return null;
  for (const char of compact) {
    if (!BUDGET_CODE_ALPHABET.includes(char)) return null;
  }
  return formatBudgetCode(compact);
}
