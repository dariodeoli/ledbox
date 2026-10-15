import { jsonError } from "@/lib/server/http";
import { listQuoteItemSubstitutes } from "@/lib/server/quote-request-response";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/quote-requests/[id]/substitutes?itemId=`: reemplazos posibles de una línea del
 * pedido (misma categoría, con stock libre en el período y visibles en ese catálogo), con la
 * misma lógica de sustitutos de la reserva. Lectura para cualquier rol de la empresa.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const itemId = new URL(request.url).searchParams.get("itemId")?.trim() ?? "";
  if (!itemId) return jsonError("Indicá la línea (itemId).", 400);
  const result = await listQuoteItemSubstitutes(auth.context, id, itemId);
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ substitutes: result.substitutes });
}
