import { jsonError } from "@/lib/server/http";
import { runDailyPaymentReminders } from "@/lib/server/reminders";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/reminders/run` (issue #19): fuerza la corrida diaria de
 * recordatorios de la empresa activa sin esperar al primer uso del panel.
 *
 * Solo OWNER y ADMIN (el resto responde 403, VIEWER incluido) y la corrida es
 * idempotente: un cobro recibe como máximo un recordatorio por día y canal.
 * Devuelve el resumen real (`candidates`, `sent`, `failed`, `skipped`,
 * `alreadySentToday`) y, si no se envió nada, el motivo (`reason`).
 */
export async function POST() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return jsonError("Forbidden", 403);
  }

  const result = await runDailyPaymentReminders({
    organizationId: auth.context.organizationId,
    actor: auth.context,
  });
  return Response.json({ result });
}
