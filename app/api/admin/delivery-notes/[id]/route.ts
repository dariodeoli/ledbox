import { jsonError } from "@/lib/server/http";
import { loadDeliveryNote } from "@/lib/server/delivery-notes";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const note = await loadDeliveryNote(auth.context.organizationId, id);
  if (!note) return jsonError("El remito no existe en esta empresa.", 404);
  return Response.json({ note });
}
