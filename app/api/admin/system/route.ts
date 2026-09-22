import { after } from "next/server";
import { jsonError } from "@/lib/server/http";
import { alertBackupIssueIfNeeded, systemStatus } from "@/lib/server/system-status";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estado del sistema (issue #43): versión, base, migraciones aplicadas y último
 * respaldo real (fecha, tamaño, resultado y último error), leído del archivo de
 * estado que escribe `scripts/backup.mjs`.
 *
 * Solo OWNER y ADMIN (el resto responde 403) y **nunca en la demo**: el estado
 * del servidor no es un dato del producto, así que la demo no lo expone.
 * Al responder, evalúa el respaldo y manda la alerta por correo si falta, está
 * vencido o falló (idempotente por día; ver `lib/server/system-status.ts`).
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { context } = auth;
  if (context.demo) return jsonError("El estado del sistema no está disponible en la demo.", 403);
  if (context.role !== "OWNER" && context.role !== "ADMIN") return jsonError("Forbidden", 403);

  after(async () => {
    try {
      const outcome = await alertBackupIssueIfNeeded(context);
      if (outcome.issue && !outcome.alreadyAlertedToday) {
        console.info(
          `[system] Respaldo ${outcome.issue}: ${outcome.sent} alerta(s) enviada(s), ${outcome.failed} fallida(s)` +
            (outcome.reason ? ` (${outcome.reason})` : ""),
        );
      }
    } catch (error) {
      console.error("[system] No se pudo evaluar la alerta de respaldo:", error instanceof Error ? error.message : error);
    }
  });

  return Response.json({ system: await systemStatus() });
}
