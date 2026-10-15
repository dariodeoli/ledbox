import { sandboxHiddenHere } from "@/lib/server/demo-host";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { normalizeBudgetCode } from "@/lib/public-config";
import { detectInventoryImageMime } from "@/lib/admin-types";
import { quotePortalAvailable } from "@/lib/quote-sharing";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const limited = await rateLimit(`portal:item-image:${getClientIp(request)}`, 120);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const { token, id } = await params;
  const code = normalizeBudgetCode(token);
  if (!code) return jsonError("Imagen no encontrada.", 404);
  const budget = await db.budget.findUnique({ where: { publicToken: code }, select: { id: true, organizationId: true, status: true, validUntil: true, approvedAt: true } });
  if (!budget || !quotePortalAvailable(budget)) return jsonError("Imagen no encontrada.", 404);
  if (await sandboxHiddenHere(budget.organizationId)) return jsonError("Imagen no encontrada.", 404);
  const item = await db.budgetItem.findFirst({ where: { id, budgetId: budget.id, budget: { publicToken: code }, inventory: { organizationId: budget.organizationId } }, select: { inventory: { select: { imageData: true, imageMime: true } } } });
  const data = item?.inventory?.imageData;
  const mime = data ? detectInventoryImageMime(data) : null;
  if (!data || !mime || mime !== item?.inventory?.imageMime) return jsonError("Imagen no encontrada.", 404);
  return new Response(new Uint8Array(data), { headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
