import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bloqueo rápido del panel (issue #21). `POST` marca la sesión como bloqueada
 * (por inactividad o a mano) y la auditoría registra el motivo; a partir de ahí
 * solo el PIN o el login completo la reabren. Es idempotente: si ya estaba
 * bloqueada no cambia nada y no duplica el registro.
 *
 * La demo pública no usa PIN ni bloqueo: responde sin tocar la sesión.
 */
export async function POST(request: Request) {
  const result = await requireAdminContext(undefined, { allowLocked: true });
  if (!result.ok) return result.response;
  const { context } = result;
  if (context.demo) return Response.json({ ok: true, locked: false, demo: true });
  if (context.session.lockedAt) return Response.json({ ok: true, locked: true, alreadyLocked: true });

  const body = (await readJson(request)) as Record<string, unknown>;
  const inactivity = body.reason === "inactivity";
  const lockedAt = new Date();
  await db.adminSession.update({
    where: { id: context.session.id },
    // Cada bloqueo arranca su propio contador de intentos (tope 5).
    data: { lockedAt, lockAttempts: 0 },
  });
  await recordAudit({
    context,
    action: "lock",
    entity: "AdminSession",
    entityId: context.session.id,
    summary: inactivity ? "Bloqueó el panel por inactividad" : "Bloqueó el panel a mano",
    detail: { fields: { reason: inactivity ? "inactivity" : "manual", lockedAt: lockedAt.toISOString() } },
  });
  return Response.json({ ok: true, locked: true });
}
