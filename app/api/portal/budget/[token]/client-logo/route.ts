import { detectIdentityImageMime } from "@/lib/admin-types";
import { normalizeBudgetCode } from "@/lib/public-config";
import { quotePortalAvailable } from "@/lib/quote-sharing";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The quote token authorizes only its own client's logo, never a client id. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:client-logo:${getClientIp(request)}`, 120);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const { token } = await params;
  const code = normalizeBudgetCode(token);
  if (!code) return jsonError("Logo no encontrado.", 404);
  const budget = await db.budget.findUnique({ where: { publicToken: code }, select: { clientId: true, organizationId: true, status: true, validUntil: true, approvedAt: true } });
  if (!budget || !quotePortalAvailable(budget)) return jsonError("Logo no encontrado.", 404);
  const logo = await db.clientLogo.findFirst({ where: { clientId: budget.clientId, client: { organizationId: budget.organizationId } }, select: { data: true, mime: true } });
  const mime = logo ? detectIdentityImageMime(logo.data) : null;
  if (!logo || !mime || mime !== logo.mime) return jsonError("Logo no encontrado.", 404);
  return new Response(new Uint8Array(logo.data), { headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
