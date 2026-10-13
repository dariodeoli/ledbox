import { requireAdminContext } from "@/lib/server/tenancy";
import { getNavCounts } from "@/lib/server/resumen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pendientes de Ventas para los contadores del menú: leads nuevos sin contactar,
 * presupuestos enviados o en negociación y eventos de los próximos 7 días. Tres
 * `count` de la empresa activa; lectura para todos los roles (no expone datos
 * personales, solo cantidades).
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const navCounts = await getNavCounts(auth.context.organizationId);
  return Response.json({ navCounts });
}
