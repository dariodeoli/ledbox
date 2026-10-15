import { jsonError, readJson } from "@/lib/server/http";
import { respondToPriceRequest } from "@/lib/server/quote-price-request";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/quote-requests/[id]/price-request/[requestId]` con
 * `{ action: "accept" | "counter" | "reject", offeredAmount?, note? }`: la empresa responde al
 * pedido de mejor precio de un pedido del catálogo. Aceptar o contraofertar deja el pedido en
 * «Propuesta enviada» (el cliente aprueba la versión final); rechazar exige un motivo. Exige
 * `clients.write` y un pedido de la empresa activa (uno ajeno responde 404).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { id, requestId } = await params;
  const body = await readJson(request).catch(() => null);
  const result = await respondToPriceRequest(auth.context, id, requestId, body, { id: auth.context.user.id, name: auth.context.user.name, email: auth.context.user.email });
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ priceRequest: result.request, quoteRequest: { id, status: result.quoteStatus }, mail: result.mail });
}
