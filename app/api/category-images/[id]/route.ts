import { db } from "@/lib/server/db";
import { isInventoryImageMime } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/category-images/[id]`: sirve la foto de una categoría de inventario. Público por UUID
 * no enumerable (lo consume la tienda) e inmutable: la URL efectiva lleva `?v=`, así reemplazar la
 * foto estrena URL. Una categoría archivada no se sirve. Sin foto, 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.inventoryCategory.findUnique({ where: { id }, select: { imageData: true, imageMime: true, archivedAt: true } });
  if (!row?.imageData || row.archivedAt || !isInventoryImageMime(row.imageMime)) return new Response("No encontramos esa imagen.", { status: 404 });
  return new Response(row.imageData, {
    headers: {
      "Content-Type": row.imageMime,
      "Content-Length": String(row.imageData.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
