import { publicConfig } from "@/lib/public-config";
import { recordAudit } from "@/lib/server/audit";
import { catalogAccessStatus, issueCatalogAccess, revokeCatalogAccess } from "@/lib/server/catalog-access";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { getRentalSettings } from "@/lib/server/rental-settings";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link privado del catálogo mayorista de un cliente (tienda web por empresa).
 *
 * - `GET`: estado del link (vigente o no, creado y último uso). Lectura para cualquier
 *   rol de la empresa; NUNCA devuelve el token (solo existe su hash).
 * - `POST`: genera un link nuevo y revoca el anterior del cliente. El link completo
 *   viaja UNA sola vez en esta respuesta. Requiere `clients.write`.
 * - `DELETE`: revoca el link vigente. Requiere `clients.write`.
 *
 * Todo se scopea a la empresa activa: un cliente de otra empresa responde 404.
 */

const NOT_FOUND = "No encontramos ese cliente en la empresa activa.";

async function storeBase(organizationId: string) {
  const [organization, settings] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } }),
    getRentalSettings(organizationId),
  ]);
  return { slug: organization?.slug ?? "", storeEnabled: settings.publicCatalogEnabled };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const status = await catalogAccessStatus(auth.context.organizationId, id);
  if (!status) return jsonError(NOT_FOUND, 404);
  const store = await storeBase(auth.context.organizationId);
  return Response.json({ access: status, storeEnabled: store.storeEnabled });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;
  const issued = await issueCatalogAccess(organizationId, id);
  if (!issued) return jsonError("No encontramos ese cliente activo en la empresa.", 404);
  const store = await storeBase(organizationId);
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Client",
    entityId: id,
    summary: "Generó el link del catálogo mayorista del cliente",
    detail: { fields: { catalogAccessId: issued.id } },
  });
  return Response.json(
    {
      url: `${publicConfig.storeUrl}/tienda/${store.slug}/mayorista/${issued.token}`,
      storeEnabled: store.storeEnabled,
      access: await catalogAccessStatus(organizationId, id),
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;
  const client = await db.client.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!client) return jsonError(NOT_FOUND, 404);
  const revoked = await revokeCatalogAccess(organizationId, id);
  if (revoked > 0) {
    await recordAudit({
      context: auth.context,
      action: "delete",
      entity: "Client",
      entityId: id,
      summary: "Revocó el link del catálogo mayorista del cliente",
      detail: { fields: { revoked } },
    });
  }
  return Response.json({ revoked, access: await catalogAccessStatus(organizationId, id) });
}
