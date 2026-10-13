import { requireAdminContext } from "@/lib/server/tenancy";
import { getResumen } from "@/lib/server/resumen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Datos del Resumen: embudo del mes, plata (por cobrar, mora, cobrado del mes),
 * atención de hoy (leads sin contestar, cheques rechazados, comprobantes por
 * confirmar) y eventos de la semana. Todo se calcula con `count`/`sum` de la
 * empresa activa; lectura para todos los roles (como `/api/admin/overview`).
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const resumen = await getResumen(auth.context.organizationId);
  return Response.json({ resumen });
}
