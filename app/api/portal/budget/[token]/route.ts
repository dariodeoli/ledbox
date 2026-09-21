import { loadPublicBudget } from "@/lib/server/budget-portal";
import { jsonError } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/portal/budget/[token]`: vista pública del presupuesto (issue #12).
 * Sin sesión: el código del link es la única credencial. Devuelve solo la venta
 * (ítems, totales, descuento, validez, notas, cliente, evento) y el estado de
 * aprobación; el costo, el margen y la evidencia técnica no salen nunca.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:budget:${getClientIp(request)}`, 120);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const { token } = await params;
  const budget = await loadPublicBudget(token);
  if (!budget) return jsonError("No encontramos ese presupuesto.", 404);
  return Response.json({ budget });
}
