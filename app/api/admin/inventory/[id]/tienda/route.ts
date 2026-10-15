import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { listProductPhotos, MAX_EXTRA_PHOTOS } from "@/lib/server/product-photos";
import { requireAdminContext } from "@/lib/server/tenancy";
import { parseTags } from "@/lib/store-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lo que el producto muestra en la tienda además de su ficha: fotos extra, «Destacado» (sección Destacados del
 * inicio), estilos o colores (filtro del catálogo) y las colecciones en las que está. `GET` lee; `PATCH { featured?, tags? }`
 * escribe con `inventory.write`. Siempre de la empresa de la sesión (otro producto → 404).
 */
async function view(organizationId: string, id: string) {
  const item = await db.inventoryItem.findFirst({
    where: { id, organizationId },
    select: { id: true, featured: true, tags: true, collectionLinks: { select: { collection: { select: { id: true, name: true } } } } },
  });
  if (!item) return null;
  return {
    featured: item.featured,
    tags: item.tags,
    collections: item.collectionLinks.map((link) => link.collection),
    photos: await listProductPhotos(organizationId, id),
    maxPhotos: MAX_EXTRA_PHOTOS,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const data = await view(auth.context.organizationId, id);
  return data ? Response.json(data) : jsonError("El producto no existe en esta empresa.", 404);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;
  const body = (await readJson(request)) as { featured?: unknown; tags?: unknown } | null;
  const item = await db.inventoryItem.findFirst({ where: { id, organizationId }, select: { id: true, name: true, featured: true, tags: true } });
  if (!item) return jsonError("El producto no existe en esta empresa.", 404);
  const data: { featured?: boolean; tags?: string[] } = {};
  if (body?.featured !== undefined) {
    if (typeof body.featured !== "boolean") return jsonError("«Destacado» se enciende o se apaga.", 400);
    data.featured = body.featured;
  }
  let ignored: string[] = [];
  if (body?.tags !== undefined) {
    if (!Array.isArray(body.tags) && typeof body.tags !== "string") return jsonError("Los estilos tienen que ser una lista de textos.", 400);
    const parsed = parseTags(body.tags);
    data.tags = parsed.tags;
    ignored = parsed.ignored;
  }
  if (Object.keys(data).length > 0) {
    await db.inventoryItem.updateMany({ where: { id, organizationId }, data });
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "InventoryItem",
      entityId: id,
      summary: `Cambió lo que «${item.name}» muestra en la tienda`,
      detail: { fields: { ...(data.featured !== undefined ? { destacado: data.featured ? "sí" : "no" } : {}), ...(data.tags ? { estilos: data.tags.join(", ") } : {}) } },
    });
  }
  return Response.json({ ...(await view(organizationId, id)), ignoredTags: ignored });
}
