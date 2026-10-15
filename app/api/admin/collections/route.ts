import { catalogAudienceWhere } from "@/lib/catalog-audience";
import { createCollection, listCollections } from "@/lib/server/collections";
import { db } from "@/lib/server/db";
import { readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Colecciones de la tienda (Ajustes → Tienda → Colecciones). `GET` lista las de la empresa de la sesión; `POST` crea. Solo OWNER/ADMIN (`org.manage`) escriben. */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  // Productos que se pueden elegir: los publicados en alguna de las dos tiendas (sin archivados ni retirados), de ESTA empresa.
  const products = await db.inventoryItem.findMany({
    where: { organizationId, archivedAt: null, status: { not: "RETIRED" }, OR: [{ AND: [catalogAudienceWhere("RETAIL")] }, { AND: [catalogAudienceWhere("WHOLESALE")] }] },
    orderBy: { name: "asc" },
    take: 2000,
    select: { id: true, name: true, sku: true, category: true },
  });
  return Response.json({ collections: await listCollections(organizationId), products });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  return createCollection(auth.context, await readJson(request));
}
