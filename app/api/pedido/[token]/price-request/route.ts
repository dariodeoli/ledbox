import { jsonError, readJson } from "@/lib/server/http";
import { requestBetterPrice } from "@/lib/server/quote-price-request";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/pedido/[token]` + `/price-request` con `{ comment, desiredAmount? }`: el cliente pide
 * un mejor precio desde el seguimiento de su pedido. El token del pedido es la única credencial;
 * rate-limit por IP y por pedido (5 intentos cada 15 minutos). El monto nunca se aplica solo: la
 * empresa lo acepta, lo contraoferta o lo rechaza.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const byIp = await rateLimit(`pedido:precio:${getClientIp(request)}`, 5);
  if (!byIp.allowed) return rateLimitResponse(byIp.retryAfter);
  const byOrder = await rateLimit(`pedido:precio:t:${token.slice(0, 64)}`, 5);
  if (!byOrder.allowed) return rateLimitResponse(byOrder.retryAfter);
  const body = await readJson(request).catch(() => null);
  const result = await requestBetterPrice(token, body);
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ priceRequest: result.request }, { status: 201 });
}
