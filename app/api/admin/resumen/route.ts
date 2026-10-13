import { requireAdminContext } from "@/lib/server/tenancy";
import { getResumen } from "@/lib/server/resumen";
import { getResumenBoard } from "@/lib/server/resumen-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Datos del Resumen: embudo del mes, plata (por cobrar, mora, cobrado del mes),
 * atención de hoy (leads sin contestar, cheques rechazados, comprobantes por
 * confirmar) y eventos de la semana, más el tablero gráfico (`board`: previsibilidad de cobros,
 * antigüedad, presupuestos en juego, tendencia de 6 meses y operación). Todo se calcula con `count`/`sum` de la
 * empresa activa; lectura para todos los roles (como `/api/admin/overview`).
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const organizationId = auth.context.organizationId;
  const [resumen, board] = await Promise.all([getResumen(organizationId), getResumenBoard(organizationId)]);
  return Response.json({ resumen, board });
}
