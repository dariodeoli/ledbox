import { isInventoryImageMime } from "@/lib/admin-types";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/inventory-photos/[id]`: foto extra de un producto. Pública por UUID no enumerable (como la foto
 * principal) e inmutable: la URL lleva `?v=<updatedAt>`. Solo imágenes (JPG, PNG o WebP). Sin foto, 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await db.inventoryImage.findUnique({ where: { id }, select: { data: true, mime: true } });
  if (!photo || !isInventoryImageMime(photo.mime)) return new Response("No encontramos esa imagen.", { status: 404 });
  return new Response(photo.data, {
    headers: { "Content-Type": photo.mime, "Content-Length": String(photo.data.byteLength), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
