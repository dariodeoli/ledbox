import { removeCollectionImage, uploadCollectionImage } from "@/lib/server/collections";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foto de ambientación de la colección: `GET` (con sesión, vista previa), `POST` multipart `file` (JPG/PNG/WebP de hasta 2 MB por magic bytes) y `DELETE`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const row = await db.collection.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { imageData: true, imageMime: true } });
  if (!row?.imageData || !row.imageMime) return jsonError("La colección no tiene foto.", 404);
  return new Response(new Uint8Array(row.imageData), { status: 200, headers: { "Content-Type": row.imageMime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return uploadCollectionImage(auth.context, id, request);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return removeCollectionImage(auth.context, id);
}
