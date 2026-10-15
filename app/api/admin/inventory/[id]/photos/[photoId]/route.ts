import { readJson } from "@/lib/server/http";
import { removeProductPhoto, updateProductPhotoAlt } from "@/lib/server/product-photos";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `DELETE` quita una foto extra; `PATCH { alt }` cambia su texto alternativo. Exige `inventory.write`; siempre de la empresa de la sesión. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  return removeProductPhoto(auth.context, id, photoId);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  const body = (await readJson(request)) as { alt?: unknown } | null;
  return updateProductPhotoAlt(auth.context, id, photoId, body?.alt ?? null);
}
