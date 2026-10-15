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
import { PORTAL_PRICE_MESSAGE } from "@/lib/budget-price-gate";
import { budgetPriceGate } from "@/lib/server/budget-price-gate";
import { checkStockBeforeApproval, PORTAL_STOCK_MESSAGE, sendBudgetToReviewForStock, snapshotEventAssignments, releaseOrphanedGateReservation } from "@/lib/server/approval-stock";
import { isDemoOrganizationId } from "@/lib/server/demo-data";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { readApprovalVersion, lockApprovalVersion, assertApprovalVersion } from "@/lib/server/approval-version";
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
  // Stock antes de aprobar la alternativa elegida (mismo lock que el resto del motor): si falta,
  // no se aprueba ni se reserva y queda en revisión; la comparación sigue abierta para elegir otra.
  const chosen = group.budgets.find((q) => q.id === body.budgetId);
  if (!chosen) return jsonError("La alternativa no existe.", 404);
  const before = await readApprovalVersion(db, group.organizationId, chosen.id);
  if (!before) return jsonError("La alternativa no existe.", 404);
  const assignments = await snapshotEventAssignments(group.organizationId, chosen.eventId);
  const releaseGate = () => releaseOrphanedGateReservation({ organizationId: group.organizationId, budgetId: chosen.id, eventId: chosen.eventId, before: assignments });
  if (!chosen.approvedAt && await budgetPriceGate(group.organizationId, chosen.id, "aprobar")) {
    return jsonError(PORTAL_PRICE_MESSAGE, 409, "price_missing");
  }
  if (chosen && !chosen.approvedAt) {
    const actor = portalAuditContext(group.organizationId, name);
    const gate = await checkStockBeforeApproval({ organizationId: group.organizationId, budgetId: chosen.id, context: actor });
    if (!gate.ok) {
      await sendBudgetToReviewForStock({ organizationId: group.organizationId, budgetId: chosen.id, title: chosen.title, actor, lines: gate.lines });
      return jsonError(PORTAL_STOCK_MESSAGE, 409, "stock_insufficient");
    }
  }
  try {
    const updated = await db.$transaction(async (tx) => {
      await lockApprovalVersion(tx, before);
      const quote = await guardQuoteApproval(tx, body.budgetId, group.organizationId, undefined, code!);
      if (quote.comparisonId !== group.id) throw new QuoteComparisonError(409, "La alternativa cambió.");
      if (quote.approvedAt) return { count: 0 };
      const current = await readApprovalVersion(tx, group.organizationId, quote.id);
      if (!current) throw new QuoteComparisonError(404, "La alternativa no existe.");
      assertApprovalVersion(before, current);
      const priceBlock = await budgetPriceGate(group.organizationId, quote.id, "aprobar", tx);
      if (priceBlock) throw new QuoteComparisonError(409, PORTAL_PRICE_MESSAGE, "price_missing");
      const applied = await tx.budget.updateMany({ where: { id: quote.id, approvedAt: null }, data: {
        status: "APPROVED", approvedAt: new Date(), approvedByName: name, approvalMethod: "digital",
        approvalIp: evidence.ip, approvalUserAgent: evidence.userAgent,
      } });
      if (applied.count) await syncBudgetExpectedPayments({ tx, organizationId: group.organizationId, budgetId: quote.id });
      return applied;
    });
    if (!updated.count) await releaseGate();
    if (updated.count) {
      const context = portalAuditContext(group.organizationId, name);
      await recordAudit({ context, action: "status", entity: "Budget", entityId: body.budgetId, summary: "El cliente eligió una alternativa de la comparación", detail: { fields: { comparisonId: group.id } } });
      const auto = await ensureEventForApprovedBudget({ organizationId: group.organizationId, budgetId: body.budgetId, actor: context });
      if (!auto.reservations) {
        try { await reserveBudgetInventory({ organizationId: group.organizationId, budgetId: body.budgetId, context }); }
        catch (error) { console.error("[comparison/approve] la reserva quedó pendiente", { budgetId: body.budgetId, error }); }
      }
    }
    return Response.json({ comparison: await loadPublicComparison(code!), alreadyApproved: !updated.count });
  } catch (error) {
    await releaseGate();
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status, error.code);
    throw error;
  }
}
