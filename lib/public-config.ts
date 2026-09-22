const DEFAULT_SITE_URL = "https://ledbox.online";
const DEFAULT_ADMIN_URL = "https://app.ledbox.online";
const DEFAULT_CLIENT_URL = "https://clientes.ledbox.online";
const DEFAULT_DEMO_URL = "https://demo.ledbox.online";
const DEFAULT_PRODUCT_URL = "https://eventos.ledbox.online";
const DEFAULT_WHATSAPP_NUMBER = "595982029217";

export const publicConfig = {
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, ""),
  /** App de EventOS (instancia de la empresa): el panel vive acá (issue #39). */
  adminUrl: (process.env.NEXT_PUBLIC_ADMIN_URL || DEFAULT_ADMIN_URL).replace(/\/$/, ""),
  /** Portal del cliente (issue #12): host público de los presupuestos aprobables. */
  clientUrl: (process.env.NEXT_PUBLIC_CLIENT_URL || DEFAULT_CLIENT_URL).replace(/\/$/, ""),
  /** Demo pública (issue #15): host de la demo con datos simulados. */
  demoUrl: (process.env.NEXT_PUBLIC_DEMO_URL || DEFAULT_DEMO_URL).replace(/\/$/, ""),
  /** Landing de ventas de EventOS (issue #39); al comprar el dominio propio se cambia esta variable. */
  productUrl: (process.env.NEXT_PUBLIC_PRODUCT_URL || DEFAULT_PRODUCT_URL).replace(/\/$/, ""),
  /** Host viejo del panel: queda solo para redirigir a `adminUrl` (transición). */
  legacyAdminUrl: "https://admin.ledbox.online",
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER,
} as const;

export function whatsappUrl(message: string): string {
  return `https://wa.me/${publicConfig.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/** Host (sin puerto) de una URL de configuración; `""` si no es una URL válida. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// ── Código público del presupuesto (issue #12) ─────────────────────────────
// El código es la única credencial del link: alfabeto sin caracteres ambiguos
// (nada de 0/1/I/O) y 20 caracteres (100 bits) en grupos de cuatro para poder
// dictarlo por teléfono. Se genera en el servidor; acá viven el link público y
// la normalización que comparten el portal, el panel y la hoja impresa.

/**
 * Alfabeto de los tokens públicos (el código del presupuesto y el token de
 * invitación al equipo): sin los caracteres que se confunden con dígitos
 * (nada de 0/1/I/O).
 */
export const UNAMBIGUOUS_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Alfabeto del código del presupuesto (alias del alfabeto público único). */
export const BUDGET_CODE_ALPHABET = UNAMBIGUOUS_ALPHABET;

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

// ── Token de invitación al equipo (issue #31) ──────────────────────────────
// El token del link de invitación es la única credencial de la página pública
// de aceptación: mismo alfabeto sin caracteres ambiguos que el código del
// presupuesto y 24 caracteres (120 bits), largo suficiente para que no se
// enumere. Se genera en el servidor (`lib/server/invitations.ts`); acá viven el
// link y la normalización que comparten la página, el API y el correo.

export const INVITATION_TOKEN_LENGTH = 24;

/**
 * Token de invitación canónico (mayúsculas, sin separadores) o `null` si no
 * tiene la forma esperada. Acepta el link completo, el path o el token suelto.
 */
export function normalizeInvitationToken(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(/\/invitacion\/([^/?#\s]+)/i)?.[1] ?? raw;
  const token = fromUrl.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (token.length !== INVITATION_TOKEN_LENGTH) return null;
  for (const char of token) {
    if (!UNAMBIGUOUS_ALPHABET.includes(char)) return null;
  }
  return token;
}

/** Link público de aceptación de una invitación al equipo (host del panel). */
export function invitationAcceptUrl(token: string): string {
  return `${publicConfig.adminUrl}/invitacion/${token}`;
}
