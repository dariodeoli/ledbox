import { isInventoryImageMime } from "@/lib/admin-types";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/collection-images/[id]`: foto de ambientación de una colección visible. Pública por UUID, con versión (`?v=`) para la caché. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.collection.findFirst({ where: { id, visible: true }, select: { imageData: true, imageMime: true } });
  if (!row?.imageData || !isInventoryImageMime(row.imageMime)) return new Response("No encontramos esa imagen.", { status: 404 });
  return new Response(new Uint8Array(row.imageData), {
    headers: { "Content-Type": row.imageMime, "Content-Length": String(row.imageData.byteLength), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
