import { publicConfig } from "@/lib/public-config";

/**
 * Dueño de la plataforma (docs/SUPERADMIN.md §2). Constante a propósito, sin variable
 * de entorno: una variable mal cargada entregaría el panel; el código pasa por revisión.
 */
export const PLATFORM_OWNER_EMAIL = "dariodeoli@gmail.com";

export type PlatformAccessInput = {
  user: { active: boolean; email: string; emailVerifiedAt: Date | string | null } | null | undefined;
  session: { lockedAt: Date | string | null } | null | undefined;
  /** Host del request (`x-forwarded-host` o `host`). */
  host: string | null | undefined;
  isProd: boolean;
  /** Host esperado del panel; por defecto el de `publicConfig.adminUrl`. */
  adminHost?: string;
};

export type PlatformAccessDecision =
  | { ok: true }
  | { ok: false; reason: "no-user" | "no-session" | "inactive" | "not-owner" | "email-unverified" | "locked" | "wrong-host" };

function normalizeHost(value: string | null | undefined): string {
  return (value ?? "").split(",")[0].trim().toLowerCase();
}

function configuredAdminHost(): string {
  try {
    return new URL(publicConfig.adminUrl).host.toLowerCase();
  } catch {
    return "app.ledbox.online";
  }
}

export function isPlatformOwnerEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === PLATFORM_OWNER_EMAIL;
}

/** Decisión pura de acceso al panel de plataforma: todo o nada, sin efectos. */
export function decidePlatformAccess(input: PlatformAccessInput): PlatformAccessDecision {
  const { user, session } = input;
  if (!user) return { ok: false, reason: "no-user" };
  if (!session) return { ok: false, reason: "no-session" };
  if (user.active !== true) return { ok: false, reason: "inactive" };
  if (!isPlatformOwnerEmail(user.email)) return { ok: false, reason: "not-owner" };
  if (!user.emailVerifiedAt) return { ok: false, reason: "email-unverified" };
  if (session.lockedAt) return { ok: false, reason: "locked" };
  if (input.isProd) {
    const expected = normalizeHost(input.adminHost) || configuredAdminHost();
    if (normalizeHost(input.host) !== expected) return { ok: false, reason: "wrong-host" };
  }
  return { ok: true };
}

/**
 * Reserva del correo del dueño (docs/SUPERADMIN.md §2): ninguna empresa puede asignarlo a
 * otra cuenta ni cambiar el correo de la cuenta del dueño. `currentEmail` es el de la cuenta
 * que se edita (null al crear una cuenta). Devuelve true si hay que responder 409.
 */
export function ownerEmailConflict(input: { currentEmail: string | null; nextEmail: string }): boolean {
  const next = input.nextEmail.trim().toLowerCase();
  const current = input.currentEmail?.trim().toLowerCase() ?? null;
  if (current !== null && current === next) return false;
  return isPlatformOwnerEmail(next) || isPlatformOwnerEmail(current);
}

/** Datos de cuenta al cambiar el correo: el correo nuevo vuelve a estar sin verificar. */
export function emailChangePatch(email: string): { email: string; emailVerifiedAt: null } {
  return { email, emailVerifiedAt: null };
}
