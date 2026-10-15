import { jsonError, readJson } from "@/lib/server/http";
import { respondToProposal } from "@/lib/server/quote-request-response";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/pedido/[token]` con `{ action: "approve" | "decline", note? }`: el cliente aprueba o
 * rechaza la propuesta de la empresa desde su seguimiento. El token del pedido es la única
 * credencial (no enumerable); rate-limit por IP. Al aprobar se vuelve a verificar el stock.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`pedido:respuesta:${getClientIp(request)}`, 20);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const { token } = await params;
  const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== "approve" && action !== "decline") return jsonError("La acción tiene que ser «approve» o «decline».", 400);
  const result = await respondToProposal(token, action, body?.note);
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ status: result.status });
}
