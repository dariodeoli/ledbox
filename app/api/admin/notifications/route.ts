import { requireAdminContext } from "@/lib/server/tenancy";
import { listAdminNotifications } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Avisos y recordatorios operativos del panel (`issue #10`).
 *
 * Lectura para todos los roles (VIEWER incluido): no expone datos sensibles, solo
 * hechos de la empresa activa. Cada aviso sale de un dato real con fecha real (ver
 * `lib/server/notifications.ts`) y viene normalizado como
 * `{ id, kind, level, title, subtitle, date, href }`, ordenado por urgencia
 * (vencido → próximo → informativo), sin duplicados por día y recortado a 20.
 *
 * `notificationCounts` cuenta el feed completo (no el recorte) para el contador
 * de la campana; `href` es la ruta limpia del módulo donde se resuelve el aviso.
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { notifications, notificationCounts } = await listAdminNotifications(auth.context.organizationId);
  return Response.json({ notifications, notificationCounts });
}
