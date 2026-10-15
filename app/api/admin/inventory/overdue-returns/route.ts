import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError } from "@/lib/server/http";
import { listExpiringHolds, listOverdueReturns } from "@/lib/server/rental-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Devoluciones vencidas y retenciones de la tienda por vencer (alquileres P1-3).
 *
 * Solo lectura y acotada a la empresa activa; cualquier rol de la empresa la lee. Sin montos.
 * - `overdue`: equipos que salieron y siguen afuera con el fin planeado ya pasado.
 * - `holds`: pedidos de la tienda cuya retención de stock vence en menos de 6 h.
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  try {
    const now = new Date();
    const [overdue, holds] = await Promise.all([
      listOverdueReturns(auth.context.organizationId, now),
      listExpiringHolds(auth.context.organizationId, now),
    ]);
    return Response.json({ overdue, holds });
  } catch (error) {
    console.error("[inventory/overdue-returns] no se pudo leer", error);
    return jsonError("No pudimos leer las devoluciones vencidas.", 500);
  }
}
