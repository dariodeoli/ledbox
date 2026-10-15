import { isCoverKind } from "@/lib/appearance";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/catalog/[orgSlug]/cover/[kind]`: portada de la tienda (`desktop` o `mobile`).
 * Público, pero solo si la empresa encendió la tienda (si no, 404) y solo la de ESA empresa.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; kind: string }> }) {
  const { orgSlug, kind } = await params;
  if (!isCoverKind(kind)) return jsonError("Portada no encontrada.", 404);
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return jsonError("Portada no encontrada.", 404);
  const cover = await db.organizationCover.findUnique({
    where: { organizationId_kind: { organizationId: context.organization.id, kind } },
    select: { mime: true, size: true, data: true },
  });
  if (!cover) return jsonError("Portada no encontrada.", 404);
  return new Response(new Uint8Array(cover.data), {
    status: 200,
    headers: { "Content-Type": cover.mime, "Content-Length": String(cover.size), "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
