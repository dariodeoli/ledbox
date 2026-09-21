import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import {
  AUTO_LOCK_OPTIONS,
  PIN_INVALID_MESSAGE,
  autoLockMinutesValid,
  hashPin,
  normalizePin,
  pinValid,
  verifyPin,
  verifyPinCredentials,
} from "@/lib/server/pin";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PIN de desbloqueo y preferencia de auto-bloqueo del propio usuario (issue #21).
 *
 * - `GET`: estado (`hasPin`, `pinUpdatedAt`) y preferencia de auto-bloqueo.
 * - `POST`: configura el PIN (4–6 dígitos) o lo cambia. Para cambiarlo exige el
 *   PIN actual **o** la contraseña; el PIN se guarda hasheado con bcrypt y nunca
 *   se devuelve ni se registra.
 * - `PATCH`: preferencia de auto-bloqueo (5/10/15/30 o «nunca»).
 * - `DELETE`: quita el PIN (mismas credenciales que el cambio).
 *
 * Todo con `profile.write`: cualquier rol edita su propia seguridad y la demo
 * queda en solo lectura. Cada intento pasa por rate limit para que no se pueda
 * adivinar el PIN actual a fuerza de pedidos.
 */

const RATE_LIMIT = 10;

const securitySelect = {
  id: true,
  pinHash: true,
  pinUpdatedAt: true,
  autoLockEnabled: true,
  autoLockMinutes: true,
  passwordHash: true,
} as const;

function pinPayload(user: { pinHash: string | null; pinUpdatedAt: Date | null }) {
  return { hasPin: Boolean(user.pinHash), updatedAt: user.pinUpdatedAt?.toISOString() ?? null };
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const user = await db.adminUser.findUnique({ where: { id: auth.context.user.id }, select: securitySelect });
  if (!user) return jsonError("No encontramos tu cuenta.", 404);
  return Response.json({
    pin: pinPayload(user),
    autoLock: { enabled: user.autoLockEnabled, minutes: user.autoLockMinutes, options: AUTO_LOCK_OPTIONS },
    hasPassword: Boolean(user.passwordHash),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const { user: actor } = auth.context;

  const limited = await rateLimit(`admin:pin:change:${actor.id}`, RATE_LIMIT);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const body = (await readJson(request)) as Record<string, unknown>;
  const pin = normalizePin(body.pin);
  if (!pinValid(pin)) return jsonError(PIN_INVALID_MESSAGE, 400);

  const user = await db.adminUser.findUnique({ where: { id: actor.id }, select: securitySelect });
  if (!user) return jsonError("No encontramos tu cuenta.", 404);

  // Cambiar el PIN pide el PIN anterior o la contraseña; configurarlo por primera
  // vez no pide nada extra (la sesión ya está autenticada).
  if (user.pinHash) {
    const credentials = await verifyPinCredentials(user, { currentPin: body.currentPin, currentPassword: body.currentPassword });
    if (!credentials.ok) return jsonError(credentials.error, 400);
    if (await verifyPin(pin, user.pinHash)) return jsonError("El PIN nuevo tiene que ser distinto del actual.", 400);
  }

  const pinUpdatedAt = new Date();
  await db.adminUser.update({ where: { id: user.id }, data: { pinHash: await hashPin(pin), pinUpdatedAt } });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "AdminUser",
    entityId: user.id,
    summary: user.pinHash ? "Cambió su PIN del panel" : "Configuró su PIN del panel",
    detail: { fields: { pin: user.pinHash ? "cambiado" : "configurado" } },
  });
  return Response.json({ pin: { hasPin: true, updatedAt: pinUpdatedAt.toISOString() } });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const { user: actor } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const enabled = body.autoLockEnabled;
  if (typeof enabled !== "boolean") return jsonError("Indicá si querés el auto-bloqueo por inactividad.", 400);
  const minutes = typeof body.autoLockMinutes === "number" ? body.autoLockMinutes : Number(body.autoLockMinutes);
  if (enabled && !autoLockMinutesValid(minutes)) {
    return jsonError("Elegí 5, 10, 15 o 30 minutos de inactividad.", 400);
  }

  const before = await db.adminUser.findUnique({
    where: { id: actor.id },
    select: { autoLockEnabled: true, autoLockMinutes: true },
  });
  if (!before) return jsonError("No encontramos tu cuenta.", 404);

  const data = { autoLockEnabled: enabled, ...(enabled && minutes !== before.autoLockMinutes ? { autoLockMinutes: minutes } : {}) };
  if (before.autoLockEnabled !== enabled || before.autoLockMinutes !== data.autoLockMinutes) {
    await db.adminUser.update({ where: { id: actor.id }, data });
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "AdminUser",
      entityId: actor.id,
      summary: enabled
        ? `Configuró el auto-bloqueo del panel: ${data.autoLockMinutes} minutos`
        : "Desactivó el auto-bloqueo del panel (nunca)",
      detail: {
        changes: {
          autoLockEnabled: { from: before.autoLockEnabled, to: data.autoLockEnabled },
          autoLockMinutes: { from: before.autoLockMinutes, to: data.autoLockMinutes },
        },
      },
    });
  }
  return Response.json({ autoLock: { enabled: data.autoLockEnabled, minutes: data.autoLockMinutes, options: AUTO_LOCK_OPTIONS } });
}

export async function DELETE(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const { user: actor } = auth.context;

  const limited = await rateLimit(`admin:pin:change:${actor.id}`, RATE_LIMIT);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const body = (await readJson(request)) as Record<string, unknown>;
  const user = await db.adminUser.findUnique({ where: { id: actor.id }, select: securitySelect });
  if (!user) return jsonError("No encontramos tu cuenta.", 404);
  if (!user.pinHash) return jsonError("Tu cuenta no tiene PIN configurado.", 400);

  const credentials = await verifyPinCredentials(user, { currentPin: body.currentPin, currentPassword: body.currentPassword });
  if (!credentials.ok) return jsonError(credentials.error, 400);

  await db.adminUser.update({ where: { id: user.id }, data: { pinHash: null, pinUpdatedAt: null } });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "AdminUser",
    entityId: user.id,
    summary: "Quitó su PIN del panel",
    detail: { fields: { pin: "eliminado" } },
  });
  return Response.json({ pin: { hasPin: false, updatedAt: null } });
}
