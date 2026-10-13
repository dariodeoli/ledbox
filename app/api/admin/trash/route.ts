import { requireAdminContext } from "@/lib/server/tenancy";
import { listTrash } from "@/lib/server/trash-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/trash` (`trash.manage`, OWNER y ADMIN): lo eliminado de la empresa activa
 * con tipo, nombre, quién y cuándo lo eliminó, motivo y bloqueos del borrado definitivo.
 * Hoy lista Evento y Producto; la etapa 3 suma las demás entidades.
 */
export async function GET() {
  const auth = await requireAdminContext("trash.manage");
  if (!auth.ok) return auth.response;
  return Response.json({ items: await listTrash(auth.context.organizationId) });
}
