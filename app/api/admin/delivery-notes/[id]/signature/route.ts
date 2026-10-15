import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trazo de la firma (PNG) de un remito firmado de la empresa activa. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const note = await db.deliveryNote.findFirst({
    where: { id, organizationId: auth.context.organizationId, signedAt: { not: null } },
    select: { signatureData: true, signatureMime: true },
  });
  if (!note?.signatureData) return jsonError("El remito no tiene firma.", 404);
  return new Response(new Uint8Array(note.signatureData), {
    headers: { "Content-Type": note.signatureMime ?? "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
