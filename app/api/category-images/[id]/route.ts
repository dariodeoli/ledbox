import { db } from "@/lib/server/db";
import { isInventoryImageMime } from "@/lib/admin-types";
import { categoryImageServable } from "@/lib/category-image-access";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/category-images/[id]`: sirve la foto de una categoría de inventario. Público por UUID
 * no enumerable (lo consume la tienda) e inmutable: la URL efectiva lleva `?v=`, así reemplazar la
 * foto estrena URL. Una categoría archivada, o de una empresa inactiva (salvo para una sesión del panel de esa empresa), no se sirve. Sin foto, 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.inventoryCategory.findUnique({ where: { id }, select: { organizationId: true, imageData: true, imageMime: true, archivedAt: true, organization: { select: { active: true } } } });
  const notFound = () => new Response("No encontramos esa imagen.", { status: 404 });
  if (!row?.imageData || row.archivedAt || !isInventoryImageMime(row.imageMime)) return notFound();
  let sessionOrganizationId: string | null = null;
  if (!row.organization.active) {
    const auth = await requireAdminContext();
    sessionOrganizationId = auth.ok ? auth.context.organizationId : null;
  }
  if (!categoryImageServable({ organizationActive: row.organization.active, archived: false, organizationId: row.organizationId, sessionOrganizationId })) return notFound();
  const privateCopy = !row.organization.active;
  return new Response(row.imageData, {
    headers: {
      "Content-Type": row.imageMime,
      "Content-Length": String(row.imageData.byteLength),
      "Cache-Control": privateCopy ? "private, no-store" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
