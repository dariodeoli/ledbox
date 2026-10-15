import { removeDeliveryNotePhoto } from "@/lib/server/delivery-notes";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  const photo = await db.deliveryNotePhoto.findFirst({
    where: { id: photoId, noteId: id, organizationId: auth.context.organizationId },
    select: { data: true, mime: true },
  });
  if (!photo) return jsonError("La foto no existe en esta empresa.", 404);
  return new Response(new Uint8Array(photo.data), {
    headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  const result = await removeDeliveryNotePhoto({ organizationId: auth.context.organizationId, noteId: id, photoId });
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ ok: true });
}
