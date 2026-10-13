import { requireAdminContext } from "@/lib/server/tenancy";
import { getRentalSettings } from "@/lib/server/rental-settings";
import { listTrash } from "@/lib/server/trash-ops";
import { purgeExpiredTrash } from "@/lib/server/trash-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/trash` (`trash.manage`, OWNER y ADMIN): lo eliminado de la empresa activa
 * con tipo, nombre, quién y cuándo lo eliminó, motivo y bloqueos del borrado definitivo.

 * Si la empresa configuró el vaciado automático (`trashPurgeDays`), antes de listar borra de forma
 * definitiva lo vencido que no tiene bloqueos (hasta 50 por apertura); lo contable queda «Conservado».
 * Lista las 7 entidades: Evento, Producto, Cliente, Oportunidad, Proveedor, Promotora y Presupuesto.
 */
export async function GET() {
  const auth = await requireAdminContext("trash.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { trashPurgeDays } = await getRentalSettings(organizationId);
  await purgeExpiredTrash(organizationId, trashPurgeDays);
  return Response.json({ items: await listTrash(organizationId, trashPurgeDays), purgeDays: trashPurgeDays });
}
