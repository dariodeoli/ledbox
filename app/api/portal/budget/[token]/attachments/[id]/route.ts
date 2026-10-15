import { sandboxHiddenHere } from "@/lib/server/demo-host";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { normalizeBudgetCode } from "@/lib/public-config";
import { budgetAttachmentFileName } from "@/lib/admin-types";
import { quotePortalAvailable } from "@/lib/quote-sharing";
import { quotePdfValid } from "@/lib/server/pdf-validation";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const limited = await rateLimit(`portal:attachment:${getClientIp(request)}`, 60);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const { token, id } = await params;
  const code = normalizeBudgetCode(token);
  if (!code) return jsonError("Adjunto no encontrado.", 404);
  const budget = await db.budget.findUnique({ where: { publicToken: code, deletedAt: null, client: { deletedAt: null } }, select: { id: true, organizationId: true, status: true, validUntil: true, approvedAt: true } });
  if (!budget || !quotePortalAvailable(budget)) return jsonError("Adjunto no encontrado.", 404);
  if (await sandboxHiddenHere(budget.organizationId)) return jsonError("Adjunto no encontrado.", 404);
  const file = await db.budgetAttachment.findFirst({ where: { id, budgetId: budget.id, organizationId: budget.organizationId, clientVisible: true, mime: "application/pdf", budget: { publicToken: code } }, select: { name: true, data: true, mime: true } });
  if (!file || !await quotePdfValid(file.data)) return jsonError("Adjunto no encontrado.", 404);
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(file.data), { headers: {
    "Content-Type": "application/pdf",
    "Content-Length": String(file.data.byteLength),
    "Content-Disposition": `${disposition}; filename="${budgetAttachmentFileName(file.name, file.mime, "presupuesto")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}
