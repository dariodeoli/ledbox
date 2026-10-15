import { deleteCollection, updateCollection } from "@/lib/server/collections";
import { readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `PATCH` edita nombre, descripción, orden, visibilidad y productos (con su orden); `DELETE` elimina la colección. Siempre de la empresa de la sesión (otra → 404). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return updateCollection(auth.context, id, await readJson(request));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return deleteCollection(auth.context, id);
}
