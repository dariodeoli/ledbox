import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { MAX_PIN_ATTEMPTS, normalizePin, pinAttemptsMessage, pinValid, verifyPin } from "@/lib/server/pin";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Desbloqueo del panel con PIN (issue #21). Valida el PIN contra el hash del
 * usuario y limpia el bloqueo de la sesión; **nunca** viaja ni se registra el
 * PIN en claro.
 *
 * Tope de intentos: 5 fallidos seguidos → la sesión se revoca y se exige login
 * completo (además queda auditado). El contador es por sesión y hay rate limit
 * por IP para que no se pueda barrer el PIN a fuerza de pedidos.
 */
export async function POST(request: Request) {
  const result = await requireAdminContext(undefined, { allowLocked: true });
  if (!result.ok) return result.response;
  const { context } = result;
  if (context.demo) return Response.json({ ok: true, locked: false, demo: true });

  const limited = await rateLimit(`admin:unlock:ip:${getClientIp(request)}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const body = (await readJson(request)) as Record<string, unknown>;
  const pin = normalizePin(body.pin);
  const user = await db.adminUser.findUnique({ where: { id: context.user.id }, select: { id: true, pinHash: true } });
  if (!user?.pinHash) {
    return jsonError("Tu cuenta no tiene PIN configurado: entrá con tu correo y contraseña.", 400);
  }

  const valid = pinValid(pin) && (await verifyPin(pin, user.pinHash));
  if (!valid) {
    const attempts = context.session.lockAttempts + 1;
    const remaining = Math.max(MAX_PIN_ATTEMPTS - attempts, 0);
    // Un PIN mal tecleado con la sesión sin bloquear también la bloquea: el
    // bloqueo no depende de que el aviso al servidor haya llegado.
    const lockedAt = context.session.lockedAt ?? new Date();
    if (remaining === 0) {
      await db.adminSession.update({
        where: { id: context.session.id },
        data: { lockAttempts: attempts, lockedAt, revokedAt: new Date() },
      });
      await recordAudit({
        context,
        action: "deny",
        entity: "AdminSession",
        entityId: context.session.id,
        summary: `Falló el PIN ${MAX_PIN_ATTEMPTS} veces seguidas: se exigió el login completo`,
        detail: { fields: { attempts, requireLogin: true } },
      });
      return Response.json({ error: pinAttemptsMessage(0), requireLogin: true }, { status: 403 });
    }
    await db.adminSession.update({
      where: { id: context.session.id },
      data: { lockAttempts: attempts, lockedAt },
    });
    await recordAudit({
      context,
      action: "deny",
      entity: "AdminSession",
      entityId: context.session.id,
      summary: `Falló el PIN del panel (intento ${attempts} de ${MAX_PIN_ATTEMPTS})`,
      detail: { fields: { attempts, remaining } },
    });
    return jsonError(pinAttemptsMessage(remaining), 400);
  }

  const wasLocked = context.session.lockedAt !== null;
  await db.adminSession.update({
    where: { id: context.session.id },
    data: { lockedAt: null, lockAttempts: 0, lockReason: null },
  });
  if (wasLocked) {
    await recordAudit({
      context,
      action: "unlock",
      entity: "AdminSession",
      entityId: context.session.id,
      summary: "Desbloqueó el panel con su PIN",
    });
  }
  return Response.json({ ok: true, locked: false });
}
