"use client";

import { budgetDepositAmount } from "@/lib/budget-payment-plan";
import { useEffect, useState } from "react";
import {
  budgetApprovalLabel,
  budgetApprovalTone,
  budgetReference,
  budgetStatusLabel,
  daysUntilDue,
  eventStatusLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  statusTone,
} from "@/lib/admin-format";
import { adminApiGet } from "@/lib/admin-api";
import { internalCostOf } from "@/lib/budget-costs";
import { budgetEventPrompt } from "@/lib/budget-event";
import { PIPELINE_STAGE_LABEL, budgetPipelineStage, type BudgetPrimaryAction } from "@/lib/budget-pipeline";
import { budgetStages } from "@/lib/budget-stages";
import { SECURITY_DEPOSIT_LABEL, isSecurityDepositStatus } from "@/lib/budget-security-deposit";
import { clientDisplayName } from "@/lib/client-identity";
import { budgetApprovalState, collectedAmount } from "@/lib/admin-types";
import type { AdminBudgetRow, AdminTimelineEntry } from "@/lib/admin-types";
import { lineMissingPrice } from "@/lib/budget-price-gate";
import { AdminButtonLink, AdminActionsMenu, AdminBadge, AdminButton, AdminCountdown, AdminDialog, AdminNote, AdminTimeline, type AdminMenuItem } from "../AdminUI";
import { BudgetEventNotice } from "../BudgetEventNotice";
import { StageTrail } from "../StageTrail";
import { securityDepositTone } from "./BudgetSecurityDeposit";

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

/** Resumen del plan de pagos: anticipo, cuotas y condiciones. */
export function planSummary(budget: AdminBudgetRow): string {
  const installments = Array.isArray(budget.installmentsJson) ? budget.installmentsJson : [];
  const parts: string[] = [];
  if (budget.advanceAmount > 0) parts.push(`anticipo ${formatMoney(budget.advanceAmount)}`);
  if (installments.length > 0) parts.push(`${formatNumber(installments.length)} cuota${installments.length === 1 ? "" : "s"}`);
  if (budget.paymentTerms) parts.push(budget.paymentTerms);
  return parts.length > 0 ? parts.join(" · ") : "Sin plan de pagos";
}

/**
 * Todo lo que se puede hacer con un presupuesto desde el panel. Cada callback
 * abre la ventana existente de esa edición; el detalle no tiene lógica propia.
 * Un callback ausente oculta el botón (permisos por rol).
 */
export type BudgetDetailActions = {
  /** «•••» de la papelera (Archivar / Desarchivar / Eliminar); vacío sin permiso. */
  trashMenu?: AdminMenuItem[];
  onSend?: () => void;
  onEdit?: () => void;
  onPlan?: () => void;
  onCollect?: () => void;
  onDeposit?: () => void;
  onInventory?: () => void;
  onEventName?: () => void;
  onApprove?: () => void;
  onRequestChanges?: () => void;
  onWhatsapp?: () => void;
  onCreateEvent: () => void;
  onConfirmEvent: () => void;
  onPortal: () => void;
  onCopyLink: () => void;
  onViewClient: () => void;
  onSignature: () => void;
  onProofs?: () => void;
  onPrimary?: () => void;
};

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="admin-bd-section" aria-label={title}>
      <header className="admin-bd-section-head">
        <h3 className="admin-bd-section-title">{title}</h3>
        {actions ? <div className="admin-bd-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Historial real del presupuesto (misma fuente que la cronología). */
function BudgetHistory({ budgetId, revision }: { budgetId: string; revision: string }) {
  const [entries, setEntries] = useState<AdminTimelineEntry[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setEntries(null);
    void adminApiGet<{ timeline?: AdminTimelineEntry[] }>(`/api/admin/timeline?budgetId=${encodeURIComponent(budgetId)}`, {
      fresh: true,
      fallbackError: "No pudimos cargar el historial.",
    }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setEntries([]);
        setError(result.error);
        return;
      }
      setEntries(result.data.timeline ?? []);
    });
    return () => {
      active = false;
    };
  }, [budgetId, revision, attempt]);
  return (
    <AdminTimeline
      entries={entries ?? []}
      loading={entries === null && !error}
      error={error}
      onRetry={() => setAttempt((current) => current + 1)}
      emptyTitle="Todavía no hay hitos registrados"
      emptyHint="Los hitos aparecen solos cuando el presupuesto tiene movimientos reales."
    />
  );
}

/**
 * Detalle del presupuesto en un panel lateral: etapas, cliente y evento, ítems,
 * condiciones, portal y firma, e historial en una sola vista. Las ediciones
 * abren sus ventanas; acá solo se lee y se navega.
 */
export function BudgetDetailDialog({
  budget,
  canAct,
  busy,
  primary,
  proofCount,
  actions,
  onClose,
}: {
  budget: AdminBudgetRow;
  /** Permiso de eventos: habilita «Crear evento» / «Confirmar evento». */
  canAct: boolean;
  busy: boolean;
  primary: BudgetPrimaryAction | null;
  proofCount: number;
  actions: BudgetDetailActions;
  onClose: () => void;
}) {
  const prompt = budgetEventPrompt(budget);
  const paid = collectedAmount(budget.payments);
  const balance = Math.max(0, budget.total - paid);
  const approvalState = budgetApprovalState(budget);
  const stage = budgetPipelineStage(budget);
  const days = daysUntilDue(budget.validUntil);
  const deposit = budget.securityDeposit && isSecurityDepositStatus(budget.securityDepositStatus) ? budget : null;
  const internalCost = internalCostOf({ materialCost: budget.materialCost ?? 0, laborCost: budget.laborCost ?? 0, items: budget.items });
  const linked = budget.items.filter((item) => item.inventoryId).length;
  const portalMenu: AdminMenuItem[] = [
    { label: "Copiar enlace", icon: "copy", onClick: actions.onCopyLink },
    { label: "Firma del cliente", icon: "pen", onClick: actions.onSignature },
  ];
  if (actions.onProofs && proofCount > 0) portalMenu.push({ label: `Comprobantes (${formatNumber(proofCount)})`, icon: "upload", onClick: actions.onProofs });
  if (actions.onApprove) portalMenu.push({ label: "Aprobar manualmente", icon: "check", onClick: actions.onApprove });
  if (actions.onRequestChanges) portalMenu.push({ label: "Pedir cambios", icon: "alert", onClick: actions.onRequestChanges });
  return (
    <AdminDialog
      title={`PRES-${budgetReference(budget.id)} · ${budget.title}`}
      size="ficha"
      icon="budgets"
      description={`${clientDisplayName(budget.client)} · ${PIPELINE_STAGE_LABEL[stage]}`}
      onClose={onClose}
      footer={
        <div className="admin-bd-footer">
          <AdminButtonLink href={`/imprimir/presupuesto/${budget.id}`} target="_blank" rel="noreferrer">Imprimir / PDF</AdminButtonLink>
          {actions.trashMenu && actions.trashMenu.length > 0 ? <AdminActionsMenu label={`Más acciones de ${budget.title}`} items={actions.trashMenu} /> : null}
          <span className="admin-dialog-spacer" />
          <AdminButton onClick={onClose}>Cerrar</AdminButton>
          {primary && actions.onPrimary ? <AdminButton variant="primary" busy={busy} busyLabel="Procesando…" onClick={actions.onPrimary}>{primary.label}</AdminButton> : null}
        </div>
      }
    >
      <StageTrail stages={stagesOfBudget(budget)} label={`Etapas de ${budget.title}`} />
      {prompt ? <BudgetEventNotice prompt={prompt} title={budget.title} canAct={canAct} busy={busy} onCreate={actions.onCreateEvent} onConfirm={actions.onConfirmEvent} /> : null}

      {budget.event && !budget.event.startsAt && linked > 0 && (budget.approvedAt || budget.status === "APPROVED") ? (
        <AdminNote tone="warn">
          La aprobación está registrada. Falta definir la fecha del evento para reservar los productos.
          <AdminButtonLink variant="link" href={`/eventos?evento=${encodeURIComponent(budget.event.id)}`}>Completar fechas en el evento</AdminButtonLink>
        </AdminNote>
      ) : null}

      <div className="admin-bd-grid">
        <Section title="Cliente y evento" actions={actions.onEventName && budget.event ? <AdminButton icon="edit" onClick={actions.onEventName}>Nombre del evento</AdminButton> : undefined}>
          <dl className="admin-dialog-facts">
            <div><dt>Cliente</dt><dd>{clientDisplayName(budget.client)}</dd></div>
            <div><dt>Evento</dt><dd>{budget.event ? `${budget.event.name} · ${eventStatusLabel(budget.event.status)}` : "Sin evento"}</dd></div>
            <div><dt>Estado</dt><dd><AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge></dd></div>
            <div>
              <dt>Vence</dt>
              <dd>{budget.validUntil ? <>{formatDate(budget.validUntil)} {days !== null ? <AdminCountdown value={budget.validUntil} className="admin-countdown--inline" title="Validez de la oferta" /> : null}</> : "Sin vencimiento"}</dd>
            </div>
            {budget.lead ? <div><dt>Origen</dt><dd><a href={`/leads?lead=${encodeURIComponent(budget.lead.id)}`}>Viene del lead del {formatDate(budget.lead.createdAt)}</a></dd></div> : null}
          </dl>
        </Section>

        <Section title="Condiciones" actions={
          <>
            {actions.onCollect ? <AdminButton icon="finance" onClick={actions.onCollect}>Cobrar en Finanzas</AdminButton> : null}
            {actions.onPlan ? <AdminButton icon="clock" onClick={actions.onPlan}>Plan de pagos</AdminButton> : null}
            {actions.onDeposit ? <AdminButton icon="wallet" onClick={actions.onDeposit}>{budget.securityDeposit ? "Garantía" : "Definir garantía"}</AdminButton> : null}
          </>
        }>
          <dl className="admin-dialog-facts">
            <div><dt>Total</dt><dd><strong>{formatMoney(budget.total)}</strong>{budget.discount > 0 ? ` · descuento ${formatMoney(budget.discount)}` : ""}</dd></div>
            <div><dt>Seña</dt><dd>{budgetDepositAmount(budget) > 0 ? formatMoney(budgetDepositAmount(budget)) : "Sin seña definida"}</dd></div>
            <div><dt>Cobrado</dt><dd>{formatMoney(paid)} · saldo {formatMoney(balance)}</dd></div>
            <div><dt>Margen</dt><dd title={`Costo interno ${formatMoney(internalCost.total)}`}>{formatMoney(budget.total - internalCost.total)}</dd></div>
            <div><dt>Plan de pagos</dt><dd>{planSummary(budget)}</dd></div>
            <div>
              <dt>Garantía</dt>
              <dd>
                {deposit && isSecurityDepositStatus(deposit.securityDepositStatus)
                  ? <>{formatMoney(deposit.securityDeposit ?? 0)} <AdminBadge tone={securityDepositTone(deposit.securityDepositStatus)}>{SECURITY_DEPOSIT_LABEL[deposit.securityDepositStatus]}</AdminBadge></>
                  : "Sin depósito de garantía"}
              </dd>
            </div>
            {budget.warranty ? <div><dt>Garantía ofrecida</dt><dd>{budget.warranty}</dd></div> : null}
          </dl>
        </Section>
      </div>

      <Section title={`Ítems (${formatNumber(budget.items.length)})`} actions={
        <>
          {actions.onEdit ? <AdminButton icon="edit" onClick={actions.onEdit}>Editar ítems y precio</AdminButton> : null}
          {actions.onInventory ? <AdminButton icon="inventory" onClick={actions.onInventory}>Inventario</AdminButton> : null}
        </>
      }>
        {budget.items.length === 0 ? (
          <p className="admin-dialog-text">Este presupuesto todavía no tiene ítems.</p>
        ) : (
          <div className="admin-bd-items" role="table" aria-label="Ítems del presupuesto">
            <div className="admin-bd-items-head" role="row">
              <span role="columnheader">Ítem</span>
              <span role="columnheader">Cant. × días</span>
              <span role="columnheader">Precio</span>
              <span role="columnheader">Subtotal</span>
            </div>
            {budget.items.map((item) => (
              <div className="admin-bd-items-row" role="row" key={item.id} data-excluded={item.excluded ? "true" : undefined}>
                <span role="cell" title={item.inventory ? `Vinculado a ${item.inventory.name}` : "No reserva stock"}>{item.name}{item.excluded ? " (no incluido)" : ""}</span>
                <span role="cell">{formatNumber(item.quantity)} × {formatNumber(item.days)}</span>
                <span role="cell">{formatMoney(item.unitPrice)}{lineMissingPrice(item) ? <> <AdminBadge tone="danger" title="Cargá el precio para poder enviar, aprobar y cobrar">Falta precio</AdminBadge></> : item.unitPrice === 0 && item.freeOnPurpose && !item.excluded ? <> <AdminBadge tone="neutral">Gratis</AdminBadge></> : null}</span>
                <span role="cell"><strong>{formatMoney(item.subtotal)}</strong></span>
              </div>
            ))}
          </div>
        )}
        <p className="admin-bd-note">
          {linked > 0 ? `${formatNumber(linked)} de ${formatNumber(budget.items.length)} ítems vinculados al inventario.` : "Ningún ítem vinculado al inventario: no reservan stock."}
        </p>
      </Section>

      <Section title="Portal y firma" actions={
        <>
          {actions.onSend ? <AdminButton icon="mail" onClick={actions.onSend}>Enviar por correo</AdminButton> : null}
          {actions.onWhatsapp ? <AdminButton icon="external" onClick={actions.onWhatsapp}>WhatsApp</AdminButton> : null}
          <AdminButton icon="globe" onClick={actions.onPortal}>{budget.publicToken ? "Portal y QR" : "Generar link"}</AdminButton>
          <AdminButton icon="eye" onClick={actions.onViewClient}>Ver como cliente</AdminButton>
          <AdminActionsMenu label="Más acciones del portal y firma" items={portalMenu} />
        </>
      }>
        <dl className="admin-dialog-facts">
          <div><dt>Aprobación</dt><dd><AdminBadge tone={budgetApprovalTone(approvalState)}>{budgetApprovalLabel(approvalState)}</AdminBadge>{budget.approvedAt ? ` ${formatDateTime(budget.approvedAt)}${budget.approvedByName ? ` · ${budget.approvedByName}` : ""}` : ""}</dd></div>
          <div><dt>Link del cliente</dt><dd>{budget.publicToken ? "Activo" : "Sin link"}{budget.viewedAt ? ` · visto el ${formatDateTime(budget.viewedAt)}` : ""}</dd></div>
          {budget.revisionRequestedAt ? <div><dt>Cambios pedidos</dt><dd>{formatDateTime(budget.revisionRequestedAt)}{budget.revisionNote ? `: ${budget.revisionNote}` : ""}</dd></div> : null}
          {proofCount > 0 ? <div><dt>Comprobantes</dt><dd>{formatNumber(proofCount)} del portal</dd></div> : null}
        </dl>
      </Section>

      <Section title="Historial">
        <BudgetHistory budgetId={budget.id} revision={`${budget.updatedAt ?? ""}:${budget.status}:${budget.approvedAt ?? ""}:${budget.viewedAt ?? ""}:${budget.revisionRequestedAt ?? ""}`} />
      </Section>
    </AdminDialog>
  );
}
