import { requireAdminContext } from "@/lib/server/tenancy";
import { getOccupancyWindow } from "@/lib/server/rental-report";
import { weekWindow } from "@/lib/server/resumen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ocupación de esta semana del inventario alquilable (KPI del módulo Inventario).
 *
 * Solo lectura y acotada a la empresa activa: reutiliza el mismo cálculo que el
 * Resumen (`getOccupancyWindow`, días-unidad comprometidos sobre disponibles de
 * hoy a +7 días). Cualquier rol de la empresa puede leerla; no muta nada.
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const now = new Date();
  const window = weekWindow(now);
  const occupancy = await getOccupancyWindow(auth.context.organizationId, window, now, 0);
  return Response.json({
    occupancy: {
      percent: occupancy.percent,
      committedDays: occupancy.committedDays,
      availableDays: occupancy.availableDays,
      items: occupancy.items,
      truncated: occupancy.truncated,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
    },
  });
}
