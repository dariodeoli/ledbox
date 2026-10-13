"use client";

import { budgetStatusLabel, budgetReference, formatDate, formatMoney, statusTone, eventStatusLabel } from "@/lib/admin-format";
import { budgetEventPrompt } from "@/lib/budget-event";
import { budgetStages } from "@/lib/budget-stages";
import { clientDisplayName } from "@/lib/client-identity";
import { collectedAmount } from "@/lib/admin-types";
import type { AdminBudgetRow } from "@/lib/admin-types";
import { AdminBadge, AdminButton, AdminDialog } from "../AdminUI";
import { BudgetEventNotice } from "../BudgetEventNotice";
import { StageTrail } from "../StageTrail";

/** Etapas del presupuesto (hook compartido con la tabla y las tarjetas). */
export function stagesOfBudget(budget: AdminBudgetRow) {
  return budgetStages({
    leadId: budget.leadId ?? budget.lead?.id ?? null,
    status: budget.status,
    approvedAt: budget.approvedAt,
    event: budget.event ? { id: budget.event.id, name: budget.event.name } : null,
    total: budget.total,
    expectedPayments: budget.expectedPayments,
    collected: collectedAmount(budget.payments),
  });
}

/**
 * Detalle del presupuesto: la barra de etapas, el aviso de evento pendiente y los
 * datos clave. Es lectura; el botón «Crear evento» / «Confirmar evento» solo
 * existe con permiso de eventos.
 */
export function BudgetDetailDialog({
  budget,
  canAct,
  busy,
  onCreateEvent,
  onConfirmEvent,
  onClose,
}: {
  budget: AdminBudgetRow;
  canAct: boolean;
  busy: boolean;
  onCreateEvent: () => void;
  onConfirmEvent: () => void;
  onClose: () => void;
}) {
  const prompt = budgetEventPrompt(budget);
  const paid = collectedAmount(budget.payments);
  return (
    <AdminDialog title={`Detalle · ${budget.title}`} size="wide" icon="budgets" onClose={onClose}>
      <StageTrail stages={stagesOfBudget(budget)} label={`Etapas de ${budget.title}`} />
      {prompt ? <BudgetEventNotice prompt={prompt} title={budget.title} canAct={canAct} busy={busy} onCreate={onCreateEvent} onConfirm={onConfirmEvent} /> : null}
      <dl className="admin-dialog-facts admin-budget-detail-facts">
        <div><dt>Referencia</dt><dd>PRES-{budgetReference(budget.id)}</dd></div>
        <div><dt>Cliente</dt><dd>{clientDisplayName(budget.client)}</dd></div>
        <div><dt>Estado</dt><dd><AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge></dd></div>
        <div><dt>Total</dt><dd>{formatMoney(budget.total)}</dd></div>
        <div><dt>Cobrado</dt><dd>{formatMoney(paid)}</dd></div>
        <div><dt>Saldo</dt><dd>{formatMoney(Math.max(0, budget.total - paid))}</dd></div>
        <div><dt>Evento</dt><dd>{budget.event ? `${budget.event.name} · ${eventStatusLabel(budget.event.status)}` : "Sin evento"}</dd></div>
        <div><dt>Vence</dt><dd>{budget.validUntil ? formatDate(budget.validUntil) : "—"}</dd></div>
      </dl>
      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton icon="close" onClick={onClose}>Cerrar</AdminButton>
      </div>
    </AdminDialog>
  );
}
