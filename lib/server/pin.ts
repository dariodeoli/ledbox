import { FIELD_MESSAGES, pinInput, pinValid } from "@/lib/field-rules";
import { hashPassword, verifyPassword } from "./auth";
import { db } from "./db";

/**
 * PIN de desbloqueo y auto-bloqueo por inactividad del panel (issue #21).
 *
 * Fuente única de las reglas del PIN:
 * - 4–6 dígitos, solo números; se guarda **hasheado con bcrypt** (`pinHash`),
 *   igual que la contraseña, y nunca se devuelve ni se escribe en logs.
 * - El desbloqueo se valida contra el hash al completar el PIN, con tope de
 *   `MAX_PIN_ATTEMPTS` intentos fallidos: al llegar al tope la sesión se revoca
 *   y queda exigido el login completo.
 * - El auto-bloqueo es una preferencia **por usuario** (`autoLockEnabled` +
 *   `autoLockMinutes`, opciones 5/10/15/30, default 10 min). Sin PIN no hay
 *   bloqueo rápido, así que el auto-bloqueo no aplica.
 *
 * La pantalla de bloqueo, el temporizador de inactividad y la sesión bloqueada
 * (`AdminSession.lockedAt`) viven en el shell del panel; acá están las reglas y
 * las verificaciones que usa el API.
 */

export const MAX_PIN_ATTEMPTS = 5;
export const AUTO_LOCK_OPTIONS = [5, 10, 15, 30] as const;

/** Mensaje único de PIN inválido (cliente y servidor usan la misma regla). */
export const PIN_INVALID_MESSAGE = FIELD_MESSAGES.pin;

/** Deja solo dígitos y corta al máximo (lo que se teclea, pegue o dicte el teclado numérico). */
export function normalizePin(value: unknown): string {
  return typeof value === "string" ? pinInput(value) : "";
}

/** ¿Es un PIN válido de 4–6 dígitos? (el API revalida siempre). */
export { pinValid };

/** Hash bcrypt del PIN: misma función que la contraseña, nunca texto plano. */
export async function hashPin(pin: string): Promise<string> {
  return hashPassword(pin);
}

/** Verifica un PIN contra su hash; sin hash (usuario sin PIN) siempre falla. */
export async function verifyPin(pin: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || !pinValid(pin)) return false;
  return verifyPassword(pin, hash);
}

export type AdminSecurity = {
  /** ¿Tiene PIN configurado? Sin PIN no hay pantalla de bloqueo ni auto-bloqueo. */
  hasPin: boolean;
  pinUpdatedAt: string | null;
  autoLockEnabled: boolean;
  /** Minutos de inactividad antes de bloquear (5/10/15/30). */
  autoLockMinutes: number;
};

type SecurityUser = {
  pinHash: string | null;
  pinUpdatedAt: Date | null;
  autoLockEnabled: boolean;
  autoLockMinutes: number;
};

/** Datos de seguridad que viajan al shell (jamás el hash). */
export function securityFromUser(user: SecurityUser): AdminSecurity {
  return {
    hasPin: Boolean(user.pinHash),
    pinUpdatedAt: user.pinUpdatedAt?.toISOString() ?? null,
    autoLockEnabled: user.autoLockEnabled,
    autoLockMinutes: user.autoLockMinutes,
  };
}

/** Seguridad del usuario para la sesión/PIN (`null` si la cuenta no existe). */
export async function loadAdminSecurity(userId: string): Promise<AdminSecurity | null> {
  const user = await db.adminUser.findUnique({
    where: { id: userId },
    select: { pinHash: true, pinUpdatedAt: true, autoLockEnabled: true, autoLockMinutes: true },
  });
  return user ? securityFromUser(user) : null;
}

export function autoLockMinutesValid(value: unknown): value is (typeof AUTO_LOCK_OPTIONS)[number] {
  return typeof value === "number" && (AUTO_LOCK_OPTIONS as readonly number[]).includes(value);
}

export type PinCredentialCheck = { ok: true } | { ok: false; error: string };

/**
 * Verifica las credenciales que exige cambiar o quitar el PIN: el PIN actual
 * **o** la contraseña de la cuenta (cualquiera de las dos alcanza). No revela
 * cuál de las dos falló cuando se mandan las dos.
 */
export async function verifyPinCredentials(
  user: { pinHash: string | null; passwordHash: string | null },
  input: { currentPin?: unknown; currentPassword?: unknown },
): Promise<PinCredentialCheck> {
  const currentPin = normalizePin(input.currentPin);
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  if (!currentPin && !currentPassword) return { ok: false, error: "Ingresá tu PIN actual o tu contraseña." };
  if (currentPin && (await verifyPin(currentPin, user.pinHash))) return { ok: true };
  if (currentPassword) {
    if (!user.passwordHash) {
      return currentPin
        ? { ok: false, error: "El PIN actual no coincide." }
        : { ok: false, error: "Tu cuenta no tiene contraseña propia: verificá con tu PIN actual." };
    }
    if (await verifyPassword(currentPassword, user.passwordHash)) return { ok: true };
  }
  if (currentPin && currentPassword) return { ok: false, error: "El PIN actual y la contraseña no coinciden." };
  return { ok: false, error: currentPin ? "El PIN actual no coincide." : "La contraseña actual no coincide." };
}

/** Texto de intentos restantes tras un PIN fallido. */
export function pinAttemptsMessage(remaining: number): string {
  if (remaining <= 0) return `Fallaste el PIN ${MAX_PIN_ATTEMPTS} veces. Por seguridad tenés que iniciar sesión de nuevo.`;
  return `PIN incorrecto. Te ${remaining === 1 ? "queda 1 intento" : `quedan ${remaining} intentos`} antes de pedirte el login completo.`;
}
