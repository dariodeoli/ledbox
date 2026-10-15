import { resolvePublicCatalog } from "@/lib/server/catalog-public";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { isHomePhotoSlot } from "@/lib/store-home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/catalog/[orgSlug]/home/[slot]`: foto de ambientación del inicio. Pública, solo con la tienda encendida y solo la de ESA empresa. */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; slot: string }> }) {
  const { orgSlug, slot } = await params;
  if (!isHomePhotoSlot(slot)) return jsonError("Foto no encontrada.", 404);
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return jsonError("Foto no encontrada.", 404);
  const row = await db.organizationCover.findUnique({ where: { organizationId_kind: { organizationId: context.organization.id, kind: slot } }, select: { mime: true, size: true, data: true } });
  if (!row) return jsonError("Foto no encontrada.", 404);
  return new Response(new Uint8Array(row.data), { status: 200, headers: { "Content-Type": row.mime, "Content-Length": String(row.size), "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
