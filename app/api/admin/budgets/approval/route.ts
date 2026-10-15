import { withQuoteApproval, QuoteComparisonError } from "@/lib/server/quote-comparison";
import { db } from "@/lib/server/db";
import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { reserveBudgetInventory, type BudgetReservation } from "@/lib/server/inventory-availability";
import { ensureEventForApprovedBudget } from "@/lib/server/budget-event";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";
import { budgetPriceGate } from "@/lib/server/budget-price-gate";
import { checkStockBeforeApproval, decideStockApproval, releaseOrphanedGateReservation, snapshotEventAssignments, type AssignmentSnapshot } from "@/lib/server/approval-stock";

export const runtime = "nodejs";
import { clientDisplayName } from "@/lib/client-identity";
export const dynamic = "force-dynamic";

const select = {
  id: true,
  title: true,
  status: true,
  publicToken: true,
  publicTokenCreatedAt: true,
  approvedAt: true,
  approvedByName: true,
  approvalMethod: true,
  approvalNote: true,
  revisionRequestedAt: true,
  revisionNote: true,
  client: { select: { name: true, company: true, tradeName: true, legalName: true } },
} as const;

const MAX_NOTE = 1000;

/**
 * `POST /api/admin/budgets/approval` (issue #12): aprobación manual o pedido de
 * cambios del equipo (OWNER/ADMIN/FINANCE) sobre un presupuesto de la empresa
 * activa. La aprobación manual queda con actor y fecha y no pisa una ya
 * registrada (ni digital ni manual).
 *
 * Al aprobar se reserva el stock de los ítems vinculados al inventario con el
 * rango del evento (issue #18). Un conflicto de disponibilidad no bloquea la
 * aprobación: queda auditado y la respuesta trae `reservations` para que el
 * panel muestre qué se reservó y qué quedó pendiente.
 *
 * Al aprobar también se generan los pagos esperados del plan (issue #28):
 * anticipo, cuotas y saldo quedan como `ExpectedPayment` en `AWAITING` para que
 * Finanzas los vea y confirme cuando el cliente transfiera. La sincronización es
 * idempotente.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const decision = body.decision === "approve" ? "approve" : body.decision === "request_revision" ? "request_revision" : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!budgetId || !decision) return jsonError("Falta el presupuesto o la decisión.", 400);
  if (note.length > MAX_NOTE) return jsonError(`La nota no puede superar los ${MAX_NOTE} caracteres.`, 400);
  if (decision === "request_revision" && !note) return jsonError("Indicá qué cambios se piden.", 400);

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { id: true, title: true, status: true, approvedAt: true, eventId: true, client: { select: { name: true, company: true, tradeName: true, legalName: true } } },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);
  const clientLabel = clientDisplayName(budget.client);
  let reservations: BudgetReservation | null = null;

  if (decision === "approve") {
    // «Falta precio»: una línea en 0 sin confirmar como gratis frena la aprobación (no se fuerza).
    const priceBlock = await budgetPriceGate(organizationId, budget.id, "aprobar");
    if (priceBlock) return jsonError(priceBlock, 409, "price_missing");
    // Stock antes de aprobar (alquileres P1-3), con el lock de ítems del motor. Si falta, se
    // frena con el detalle; «Aprobar igual» (`force`) solo lo puede OWNER/ADMIN y queda auditado.
    let forcedShortage: string[] | null = null;
    // La verificación deja el stock reservado: si la aprobación falla o pierde la carrera se deshace.
    let gateSnapshot: AssignmentSnapshot | null = null;
    if (!budget.approvedAt) {
      gateSnapshot = await snapshotEventAssignments(organizationId, budget.eventId);
      const gate = await checkStockBeforeApproval({ organizationId, budgetId: budget.id, context: auth.context });
      const decision = decideStockApproval(gate, body.force === true, user.role);
      if (decision.kind === "blocked") return jsonError(decision.message, 409, "stock_insufficient");
      if (decision.kind === "forbidden") return jsonError(decision.message, 403, "stock_force_forbidden");
      if (decision.kind === "forced") forcedShortage = decision.lines;
    }
    const releaseGate = async () => {
      if (!gateSnapshot) return;
      try { await releaseOrphanedGateReservation({ organizationId, budgetId: budget.id, eventId: budget.eventId, before: gateSnapshot }); }
      catch (releaseError) { console.error("[budgets/approval] no se pudo liberar la reserva de la verificación", { budgetId: budget.id, error: releaseError }); }
    };
    // Idempotente: si ya hay una aprobación registrada, se devuelve tal cual.
    let applied: { count: number };
    try { applied = await withQuoteApproval(budget.id, organizationId, (tx) => tx.budget.updateMany({
      where: { id: budget.id, approvedAt: null },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByName: user.name,
        approvalMethod: "manual",
        approvalNote: note || null,
      },
    })); } catch (error) {
      await releaseGate();
      if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
      throw error;
    }
    // Perdió la carrera (otro pedido aprobó primero): lo reservado por esta verificación se libera
    // salvo que el presupuesto ya esté aprobado (entonces la reserva es de quien ganó).
    if (applied.count === 0) await releaseGate();
    if (applied.count > 0) {
      await recordAudit({
        context: auth.context,
        action: "status",
        entity: "Budget",
        entityId: budget.id,
        summary: `Aprobó manualmente el presupuesto «${budget.title}» del cliente «${clientLabel}»`,
        detail: { changes: { status: { from: budget.status, to: "APPROVED" }, approvalMethod: { from: null, to: "manual" } } },
      });
      if (forcedShortage) {
        await recordAudit({
          context: auth.context,
          action: "status",
          entity: "Budget",
          entityId: budget.id,
          summary: `Aprobó igual el presupuesto «${budget.title}» del cliente «${clientLabel}» sin stock suficiente (${forcedShortage.join(" · ")})`,
          detail: { fields: { aprobarIgual: true, actor: user.name, rol: user.role, faltantes: forcedShortage } },
        });
      }
      // Evento automático (CONFIRMED) y su reserva; el panel ya validó budgets.write, el evento se crea
      // como parte de la aprobación. Si falla, la aprobación sigue y queda auditado.
      const auto = await ensureEventForApprovedBudget({ organizationId, budgetId: budget.id, actor: auth.context, plan: auth.context });
      reservations = auto.reservations;
      if (!reservations) {
        try { reservations = await reserveBudgetInventory({ organizationId, budgetId: budget.id, context: auth.context }); }
        catch (error) { console.error("[budgets/approval] la reserva quedó pendiente", { budgetId: budget.id, error }); }
      }
      // Pagos esperados del plan (issue #28): idempotente y sin tocar lo confirmado.
      await syncBudgetExpectedPayments({
        organizationId,
        budgetId: budget.id,
        actor: auth.context,
        reason: "aprobación manual",
      });
    }
  } else {
    if (budget.approvedAt) return jsonError("El presupuesto ya está aprobado.", 409);
    await db.budget.update({
      where: { id: budget.id },
      data: {
        status: budget.status === "APPROVED" ? budget.status : "NEGOTIATING",
        revisionRequestedAt: new Date(),
        revisionNote: note,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Budget",
      entityId: budget.id,
      summary: `Pidió cambios en el presupuesto «${budget.title}» del cliente «${clientLabel}»`,
      detail: { fields: { revisionNote: note } },
    });
  }

  const updated = await db.budget.findUnique({ where: { id: budget.id }, select });
  return Response.json({ budget: updated, reservations });
}
