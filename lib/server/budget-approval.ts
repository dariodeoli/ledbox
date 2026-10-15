import { withQuoteApproval, withQuoteCommercialEdit, QuoteComparisonError } from "@/lib/server/quote-comparison";
import { db } from "@/lib/server/db";
import { recordAudit } from "@/lib/server/audit";
import { jsonError } from "@/lib/server/http";
import type { AdminContext } from "@/lib/server/tenancy";
import { reserveBudgetInventory, type BudgetReservation } from "@/lib/server/inventory-availability";
import { ensureEventForApprovedBudget } from "@/lib/server/budget-event";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";
import { budgetPriceGate } from "@/lib/server/budget-price-gate";
import { checkStockBeforeApproval, decideStockApproval, releaseOrphanedGateReservation, snapshotEventAssignments, type AssignmentSnapshot } from "@/lib/server/approval-stock";

import { readApprovalVersion, lockApprovalVersion, assertApprovalVersion } from "@/lib/server/approval-version";
import { CommercialStatus } from "@prisma/client";
import { budgetStatusLabel } from "@/lib/admin-format";
import { clientDisplayName } from "@/lib/client-identity";

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
 * rango del evento (issue #18). Un faltante bloquea salvo autorización explícita
 * de OWNER/ADMIN; la respuesta trae `reservations` para el detalle del panel.
 *
 * Al aprobar también se generan los pagos esperados del plan (issue #28):
 * anticipo, cuotas y saldo quedan como `ExpectedPayment` en `AWAITING` para que
 * Finanzas los vea y confirme cuando el cliente transfiera. La sincronización es
 * idempotente.
 */
export async function applyManualBudgetDecision(context: AdminContext, body: Record<string, unknown>): Promise<Response> {
  try { return await decideBudget(context, body); }
  catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status, error.code);
    throw error;
  }
}

async function decideBudget(context: AdminContext, body: Record<string, unknown>): Promise<Response> {
  const { organizationId, user } = context;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const decision = body.decision === "approve" ? "approve" : body.decision === "request_revision" ? "request_revision" : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!budgetId || !decision) return jsonError("Falta el presupuesto o la decisión.", 400);
  if (note.length > MAX_NOTE) return jsonError(`La nota no puede superar los ${MAX_NOTE} caracteres.`, 400);
  if (decision === "request_revision" && !note) return jsonError("Indicá qué cambios se piden.", 400);

  const budget = await readApprovalVersion(db, organizationId, budgetId);
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);
  if (budget.status === "LOST" || budget.status === "CANCELLED") return jsonError("El presupuesto está cerrado. Reabrilo explícitamente antes de aprobar o pedir cambios.", 409);
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
      const gate = await checkStockBeforeApproval({ organizationId, budgetId: budget.id, context });
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
    let applied: { count: number; from: string };
    try { applied = await withQuoteApproval(budget.id, organizationId, async (tx) => {
      // El preflight puede esperar por stock: precio, estado y evidencia se validan de nuevo
      // bajo el candado compartido con edición/firma, nunca desde la pestaña anterior.
      const current = await readApprovalVersion(tx, organizationId, budget.id);
      if (!current) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
      if (current.approvedAt) return { count: 0, from: current.status };
      assertApprovalVersion(budget, current);
      const priceBlock = await budgetPriceGate(organizationId, budget.id, "aprobar", tx);
      if (priceBlock) throw new QuoteComparisonError(409, priceBlock, "price_missing");
      await tx.budget.update({
        where: { id: budget.id },
        data: { status: "APPROVED", approvedAt: new Date(), approvedByName: user.name, approvalMethod: "manual", approvalNote: note || null },
      });
      // Aprobación y promesa de pago son una sola escritura económica. Un reintento
      // simultáneo no puede generar dos conceptos ni dejar el plan a mitad de camino.
      await syncBudgetExpectedPayments({ tx, organizationId, budgetId: budget.id });
      return { count: 1, from: current.status };
    }, undefined, {
      beforeBudgetLock: (tx) => lockApprovalVersion(tx, budget),
    }); } catch (error) {
      await releaseGate();
      throw error;
    }
    // Perdió la carrera (otro pedido aprobó primero): lo reservado por esta verificación se libera
    // salvo que el presupuesto ya esté aprobado (entonces la reserva es de quien ganó).
    if (applied.count === 0) await releaseGate();
    if (applied.count > 0) {
      await recordAudit({
        context,
        action: "status",
        entity: "Budget",
        entityId: budget.id,
        summary: `Aprobó manualmente el presupuesto «${budget.title}» del cliente «${clientLabel}»`,
        detail: { changes: { status: { from: applied.from, to: "APPROVED" }, approvalMethod: { from: null, to: "manual" } } },
      });
      if (forcedShortage) {
        await recordAudit({
          context,
          action: "status",
          entity: "Budget",
          entityId: budget.id,
          summary: `Aprobó igual el presupuesto «${budget.title}» del cliente «${clientLabel}» sin stock suficiente (${forcedShortage.join(" · ")})`,
          detail: { fields: { aprobarIgual: true, actor: user.name, rol: user.role, faltantes: forcedShortage } },
        });
      }
      // Evento automático (CONFIRMED) y su reserva; el panel ya validó budgets.write, el evento se crea
      // como parte de la aprobación. Si falla, la aprobación sigue y queda auditado.
      const auto = await ensureEventForApprovedBudget({ organizationId, budgetId: budget.id, actor: context, plan: context });
      reservations = auto.reservations;
      if (!reservations) {
        try { reservations = await reserveBudgetInventory({ organizationId, budgetId: budget.id, context }); }
        catch (error) { console.error("[budgets/approval] la reserva quedó pendiente", { budgetId: budget.id, error }); }
      }
    }
  } else {
    await withQuoteCommercialEdit(budget.id, organizationId, true, async (tx) => {
      await tx.budget.update({
        where: { id: budget.id },
        data: { status: "NEGOTIATING", revisionRequestedAt: new Date(), revisionNote: note },
      });
    });
    await recordAudit({
      context,
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

/** Tablero y API: cada cambio relee el presupuesto bajo el mismo candado que firma y edición. */
export async function setBudgetCommercialStatus(context: AdminContext, body: Record<string, unknown>): Promise<Response> {
  try { return await changeBudgetStatus(context, body); }
  catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status, error.code);
    throw error;
  }
}

async function changeBudgetStatus(context: AdminContext, body: Record<string, unknown>): Promise<Response> {
  const { organizationId } = context;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  if (!budgetId) return jsonError("Falta el presupuesto.", 400);
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
  if (!Object.values(CommercialStatus).includes(status as CommercialStatus)) return jsonError("El estado del presupuesto no es válido.", 400);
  if (status === "APPROVED") return applyManualBudgetDecision(context, { ...body, decision: "approve" });
  const moved = await withQuoteCommercialEdit(budgetId, organizationId, false, async (tx) => {
    const current = await tx.budget.findFirst({
      where: { id: budgetId, organizationId },
      select: { id: true, title: true, status: true, approvedAt: true, client: { select: { name: true, company: true } } },
    });
    if (!current) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
    if (current.status === status) return { budget: current, updated: { id: current.id, status: current.status }, unchanged: true };
    if (current.approvedAt || current.status === "APPROVED" || await tx.signatureRequest.count({ where: { budgetId, status: { in: ["SIGNED", "VALIDATED"] } } })) {
      throw new QuoteComparisonError(409, "El presupuesto ya está aprobado o firmado: no se puede cambiar su estado comercial.");
    }
    if (status === "SENT") {
      const priceBlock = await budgetPriceGate(organizationId, budgetId, "enviar", tx);
      if (priceBlock) throw new QuoteComparisonError(409, priceBlock, "price_missing");
    }
    const updated = await tx.budget.update({ where: { id: budgetId }, data: { status: status as CommercialStatus }, select: { id: true, status: true } });
    return { budget: current, updated, unchanged: false };
  });
  const { budget, updated } = moved;
  if (moved.unchanged) return Response.json({ budget: updated, unchanged: true });
  await recordAudit({
    context,
    action: "status",
    entity: "Budget",
    entityId: budget.id,
    summary: `Cambió el estado del presupuesto «${budget.title}» del cliente «${budget.client.company?.trim() || budget.client.name}» a ${budgetStatusLabel(updated.status)}`,
    detail: { changes: { status: { from: budget.status, to: updated.status } } },
  });
  return Response.json({ budget: updated });
}
