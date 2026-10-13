import { db } from "@/lib/server/db";
import { guardQuoteApproval, QuoteComparisonError, findPublicComparison } from "@/lib/server/quote-comparison";
import { approvalEvidence } from "@/lib/server/budget-portal";
import { loadPublicComparison } from "@/lib/server/quote-comparison-view";
import { normalizeBudgetCode } from "@/lib/public-config";
import { jsonError } from "@/lib/server/http";
import { recordAudit, portalAuditContext } from "@/lib/server/audit";
import { reserveBudgetInventory } from "@/lib/server/inventory-availability";
import { ensureEventForApprovedBudget } from "@/lib/server/budget-event";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";
import { isDemoOrganizationId } from "@/lib/server/demo-data";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limit = await rateLimit(`comparison:approve:${getClientIp(request)}`, 20);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfter);
  const code = normalizeBudgetCode((await params).token);
  const group = code ? await findPublicComparison(code) : null;
  if (!group) return jsonError("Comparación no encontrada o vencida.", 404);
  if (await isDemoOrganizationId(group.organizationId)) return jsonError("Modo demo: solo lectura", 403);
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (body?.consent !== true || name.length < 3 || name.length > 120 || !group.budgets.some((q) => q.id === body?.budgetId)) return jsonError("Elegí una alternativa e indicá tu nombre y consentimiento.", 400);
  const evidence = approvalEvidence(request);
  try {
    const updated = await db.$transaction(async (tx) => {
      const quote = await guardQuoteApproval(tx, body.budgetId, group.organizationId, undefined, code!);
      if (quote.comparisonId !== group.id) throw new QuoteComparisonError(409, "La alternativa cambió.");
      return tx.budget.updateMany({ where: { id: quote.id, approvedAt: null }, data: {
        status: "APPROVED", approvedAt: new Date(), approvedByName: name, approvalMethod: "digital",
        approvalIp: evidence.ip, approvalUserAgent: evidence.userAgent,
      } });
    });
    if (updated.count) {
      const context = portalAuditContext(group.organizationId, name);
      await recordAudit({ context, action: "status", entity: "Budget", entityId: body.budgetId, summary: "El cliente eligió una alternativa de la comparación", detail: { fields: { comparisonId: group.id } } });
      const auto = await ensureEventForApprovedBudget({ organizationId: group.organizationId, budgetId: body.budgetId, actor: context });
      if (!auto.reservations) {
        try { await reserveBudgetInventory({ organizationId: group.organizationId, budgetId: body.budgetId, context }); }
        catch (error) { console.error("[comparison/approve] la reserva quedó pendiente", { budgetId: body.budgetId, error }); }
      }
      await syncBudgetExpectedPayments({ organizationId: group.organizationId, budgetId: body.budgetId, actor: context, reason: "alternativa elegida" });
    }
    return Response.json({ comparison: await loadPublicComparison(code!), alreadyApproved: !updated.count });
  } catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    throw error;
  }
}
