"use client";
import { PaymentDetailsDialog } from "./PaymentDetailsDialog";
import { ClientIdentityView, clientComboboxOption } from "../ClientIdentity";
import { useClientSelector } from "@/lib/admin-client-selector";
import { BudgetComparisons } from "./BudgetComparisons";
import { inputDateTime } from "./EventoFicha";
import { BudgetDetailDialog, type BudgetDetailActions } from "./BudgetDetailDialog";
import { PIPELINE_STAGE_LABEL, budgetPipelineStage, budgetPrimaryAction, matchesPipelineFilter, type BudgetPipelineFilter, type BudgetPipelineInput, type BudgetPipelineStage, type BudgetPrimaryAction } from "@/lib/budget-pipeline";
import { budgetEventPrompt } from "@/lib/budget-event";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PresupuestosTabs } from "./PresupuestosTabs";
import { AdminMailPreview } from "../AdminMailPreview";
import { AdminSimulatedMailDialog } from "../AdminSimulatedMail";
import { SIMULATED_MAIL_NOTICE, type MailPreview, type SimulatedMail } from "@/lib/mail-preview";
import {
  budgetApprovalLabel,
  budgetApprovalTone,
  budgetChangeKindLabel,
  budgetChangeStatusLabel,
  budgetChangeStatusTone,
  budgetReference,
  budgetStatusLabel,
  daysUntilDue,
  formatBytes,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  paymentProofMimeLabel,
  statusTone,
  type AdminTone,
} from "@/lib/admin-format";
import { InventoryLinkPicker } from "./BudgetInventoryPicker";
import { counterofferExclusion } from "@/lib/quote-selection";
import { BudgetPricingDialog } from "./BudgetPricingDialog";
import { BudgetItemsEditor } from "./BudgetItemsEditor";
import { BudgetCreationDeposit, EMPTY_CREATION_DEPOSIT, SecurityDepositDialog, creationDepositBody } from "./BudgetSecurityDeposit";
import { BudgetPaymentPlanEditor, conditionDrafts, conditionPayload, type BudgetConditionDraft } from "./BudgetPaymentPlanEditor";
import { budgetDraftSubtotal, budgetItemError, type BudgetItemDraft } from "@/lib/budget-items";
import { budgetDepositAmount, budgetMoneyValid, resolveBudgetPaymentPlan } from "@/lib/budget-payment-plan";
import { BUDGET_APPROVAL_NOTE_MAX, budgetApprovalNoteError } from "@/lib/budget-approval-validation";
import { clientDisplayName } from "@/lib/client-identity";
import { ClientQuickCreateDialog, EventQuickCreateDialog } from "./BudgetQuickCreate";
import { canWriteClients, canWriteFinance, canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import {
  budgetApprovalState,
  collectedAmount,
  groupProofsByBudget,
  type AdminBudgetPaymentProofRow,
  type AdminBudgetPortalPayload,
  type AdminBudgetRequestRow,
  type AdminBudgetReservation,
  type AdminBudgetRow,
  type AdminClientOption,
  type AdminInventoryLink,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";
import { qrDataUrl } from "@/lib/qr";
import { useTrashFlow } from "../TrashDialogs";
import { budgetArchiveBlockedReason } from "@/lib/trash-shared";
import { useAdminSession } from "../AdminShell";
import { AdminBoard, AdminViewSwitch, useAdminBoardMove, useAdminModuleView, useAdminNarrowViewport, type AdminBoardCardData, type AdminBoardColumn } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import {
  AdminActionsMenu,
  AdminSelect,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminDialog,
  AdminDialogSection,
  AdminDisclosure,
  AdminEmpty,
  AdminKpi,
  AdminKpis,
  AdminModuleContext,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminTimelineDialog,
  AdminToolbar,
  type AdminMenuItem,
} from "../AdminUI";
import { MessageTemplateSendDialog, type MessageTemplateTarget } from "../AdminMessageTemplateDialog";
import { SignatureDialog } from "./SignatureDialog";
import {
  CheckboxField,
  Combobox,
  DateTimeField,
  EmailField,
  MoneyField,
  NumberField,
  SearchField,
  TextAreaField,
  TextField,
  type ComboboxOption,
} from "../AdminFields";
import { kpiState } from "@/components/admin/kpi-state";
import { adminApiGet, adminSend, useAdminResource } from "@/lib/admin-api";
import { emailValid, FIELD_MESSAGES, normalizeEmail } from "@/lib/field-rules";

/** Tablero kanban: una columna por estado comercial (set de estados, sin máquina). */
const BOARD_COLUMNS: AdminBoardColumn[] = [
  { value: "DRAFT", label: "Borrador" },
  { value: "SENT", label: "Enviado" },
  { value: "NEGOTIATING", label: "En negociación" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "LOST", label: "Perdido" },
  { value: "CANCELLED", label: "Cancelado" },
];

/** KPIs por etapa: cada uno filtra la lista al tocarlo. */
const STAGE_KPIS: Array<{ stage: BudgetPipelineStage; icon: "budgets" | "mail" | "alert" | "check" | "close"; tone?: AdminTone }> = [
  { stage: "draft", icon: "budgets" },
  { stage: "sent", icon: "mail", tone: "accent" },
  { stage: "approved_pending_event", icon: "alert", tone: "warn" },
  { stage: "approved", icon: "check", tone: "ok" },
  { stage: "lost", icon: "close" },
];

const FILTER_LABEL: Record<BudgetPipelineFilter, string> = {
  all: "Todos",
  approved_any: "Aprobados",
  ...PIPELINE_STAGE_LABEL,
};

/** `?estado=` de los enlaces del Resumen → filtro de etapa. */
const ESTADO_PARAM_FILTER: Record<string, BudgetPipelineFilter> = {
  DRAFT: "draft",
  SENT: "sent",
  NEGOTIATING: "sent",
  APPROVED: "approved_any",
  LOST: "lost",
  CANCELLED: "lost",
};

/** Entrada de las reglas de etapa y acción principal para un presupuesto de la lista. */
function pipelineInput(budget: AdminBudgetRow): BudgetPipelineInput {
  return {
    status: budget.status,
    approvedAt: budget.approvedAt,
    event: budget.event,
    total: budget.total,
    advanceAmount: budget.advanceAmount,
    revisionRequested: budgetApprovalState(budget) === "CAMBIOS_SOLICITADOS",
    expectedPayments: budget.expectedPayments,
    collected: collectedAmount(budget.payments),
  };
}

/** ¿El presupuesto sigue en juego? Mismo criterio del resumen: ni perdido ni cancelado. */
function budgetInPlay(budget: AdminBudgetRow): boolean {
  return budget.status !== "LOST" && budget.status !== "CANCELLED";
}

/**
 * Urgencia comercial del presupuesto, el orden por defecto de la lista y de las
 * columnas del tablero:
 *
 * 0 · vigencia por delante: lo que vence antes (hoy o más adelante) va primero.
 * 1 · vigencia ya vencida, de la más reciente a la más vieja: hay que reenviarlo
 *     o renovarlo, pero no es «lo que vence».
 * 2 · sin validez cargada.
 * 3 · perdido o cancelado (al final, del más reciente al más viejo).
 */
function budgetUrgencyRank(budget: AdminBudgetRow): number {
  if (!budgetInPlay(budget)) return 3;
  const days = daysUntilDue(budget.validUntil);
  if (days === null) return 2;
  return days >= 0 ? 0 : 1;
}

function compareBudgetUrgency(a: AdminBudgetRow, b: AdminBudgetRow): number {
  const rankA = budgetUrgencyRank(a);
  const rankB = budgetUrgencyRank(b);
  if (rankA !== rankB) return rankA - rankB;
  const timeA = a.validUntil ? new Date(a.validUntil).getTime() : Number.POSITIVE_INFINITY;
  const timeB = b.validUntil ? new Date(b.validUntil).getTime() : Number.POSITIVE_INFINITY;
  // Lo que todavía vence se lee del más próximo al más lejano; lo vencido y lo
  // cerrado, del más reciente al más viejo.
  return rankA === 0 ? timeA - timeB : timeB - timeA;
}

/** Precarga del alta desde un lead (`GET /api/admin/budgets/lead-draft`). */
type LeadDraft = {
  lead: { id: string; name: string; company: string | null; status: string; createdAt: string };
  title: string;
  notes: string;
  eventDate: string | null;
  client: { id: string; name: string; company: string | null } | null;
  canCreateClient: boolean;
  existingBudgets: Array<{ id: string; title: string; status: string; createdAt: string }>;
};

const EMPTY_FORM = {
  clientId: "",
  eventId: "",
  title: "",
};

/** `id` del `<datalist>` con el catálogo de bancos (owncoding-ui) de Datos de pago. */

type ApprovalDecision = "approve" | "request_revision";
type RequestDecision = "accept" | "reject";

/** Cuota en edición dentro del diálogo del plan de pagos. */

/** Resumen textual del estado del portal, para el `title` de la celda. */
function portalSummary(budget: AdminBudgetRow): string {
  const state = budgetApprovalState(budget);
  const link = budget.publicToken ? "Link activo" : "Sin link público";
  if (state === "APROBADO_DIGITAL" || state === "APROBADO_MANUAL") {
    const via = state === "APROBADO_MANUAL" ? "aprobación manual del panel" : "aprobación digital del cliente";
    const when = budget.approvedAt ? formatDateTime(budget.approvedAt) : "sin fecha";
    const note = budget.approvalNote ? ` · Nota: ${budget.approvalNote}` : "";
    return `${budgetApprovalLabel(state)} (${via}) · ${budget.approvedByName || "—"} · ${when}${note} · ${link}`;
  }
  if (state === "CAMBIOS_SOLICITADOS") {
    const when = budget.revisionRequestedAt ? formatDateTime(budget.revisionRequestedAt) : "sin fecha";
    return `Cambios solicitados el ${when}: ${budget.revisionNote || "sin comentario"} · ${link}`;
  }
  return `Pendiente de aprobación · ${link}`;
}

/** Qué pide una solicitud del portal, en una línea, con el antes → después. */
function requestDelta(request: AdminBudgetRequestRow): string {
  if (request.kind === "items") {
    const items = request.payload.items ?? [];
    if (items.length === 0) return "Propuesta de ítems";
    return items
      .map((row) => {
        const current = request.budget.items.find((item) => item.id === row.id);
        const name = current?.name ?? "Ítem";
        const from = current ? `${formatNumber(current.quantity)} × ${formatNumber(current.days)} d` : "—";
        return `${name}: ${from} → ${row.excluded ? "Retirado / no incluido" : `${formatNumber(row.quantity)} × ${formatNumber(row.days)} d`}`;
      })
      .join(" · ");
  }
  if (request.kind === "discount" && request.payload.discount) {
    const discount = request.payload.discount;
    const asked = discount.type === "percent" ? `${discount.value} %` : formatMoney(discount.value);
    return `Rebaja: ${asked} → ${formatMoney(discount.amount)} · descuento actual ${formatMoney(request.budget.discount)}`;
  }
  return request.payload.comment || request.note || "Pedido de cambios";
}

/**
 * Comparación original vs propuesta del cliente (issue #143): lo que el
 * presupuesto tiene hoy al lado de lo que pidió el portal, ítem por ítem o en
 * el descuento. La usan la tarjeta de la solicitud y el diálogo de conversación.
 */
function RequestComparison({ request }: { request: AdminBudgetRequestRow }) {
  if (request.kind === "items") {
    const items = request.payload.items ?? [];
    return (
      <div className="admin-dialog-table admin-dialog-table--compare" role="table" aria-label="Comparación: original vs propuesta del cliente">
        <div className="admin-dialog-table-head" role="row">
          <span role="columnheader">Ítem</span>
          <span role="columnheader">Original</span>
          <span role="columnheader">Propuesta del cliente</span>
        </div>
        {items.length === 0 ? (
          <div className="admin-dialog-table-row" role="row">
            <span role="cell">Sin detalle de ítems</span>
            <span role="cell">—</span>
            <span role="cell">—</span>
          </div>
        ) : (
          items.map((row) => {
            const current = request.budget.items.find((item) => item.id === row.id);
            return (
              <div className="admin-dialog-table-row" role="row" key={row.id}>
                <span role="cell">{current?.name ?? "Ítem"}</span>
                <span role="cell">{current ? `${formatNumber(current.quantity)} × ${formatNumber(current.days)} d` : "—"}</span>
                <span role="cell">
                  <strong>
                    {row.excluded ? "Retirado / no incluido" : `${formatNumber(row.quantity)} × ${formatNumber(row.days)} d`}
                  </strong>
                </span>
              </div>
            );
          })
        )}
      </div>
    );
  }
  if (request.kind === "discount" && request.payload.discount) {
    const discount = request.payload.discount;
    const asked = discount.type === "percent" ? `${formatNumber(discount.value)} %` : formatMoney(discount.value);
    return (
      <dl className="admin-dialog-facts">
        <div>
          <dt>Descuento actual</dt>
          <dd>{formatMoney(request.budget.discount)}</dd>
        </div>
        <div>
          <dt>Pidió el cliente</dt>
          <dd>
            {asked} · {formatMoney(discount.amount)}
          </dd>
        </div>
      </dl>
    );
  }
  return <p className="admin-dialog-text">{request.payload.comment || request.note || "Pedido de cambios"}</p>;
}

// ── Reserva automática al aprobar (issue #18) ────────────────────────────────
// Estado de cada ítem vinculado después de la reserva; el API manda el motivo.

const RESERVATION_STATUS: Record<string, string> = {
  created: "Reservado",
  updated: "Actualizado",
  unchanged: "Ya reservado",
  conflict: "Conflicto",
  blocked: "Bloqueado",
  "missing-event": "Sin evento",
  "missing-range": "Sin fechas",
  "in-movement": "Movimiento en curso",
};

const RESERVATION_STATUS_TONES: Record<string, AdminTone> = {
  created: "ok",
  updated: "info",
  unchanged: "neutral",
  conflict: "danger",
  blocked: "danger",
  "missing-event": "warn",
  "missing-range": "warn",
  "in-movement": "warn",
};

function reservationStatusLabel(status: string): string {
  return RESERVATION_STATUS[status] ?? status;
}

function reservationStatusTone(status: string): AdminTone {
  return RESERVATION_STATUS_TONES[status] ?? "neutral";
}

/**
 * Rango del evento para pedir disponibilidad y reservar (issue #18): montaje →
 * desmontaje. `null` cuando el evento no tiene el rango completo (no se
 * inventan fechas): en ese caso se muestra la disponibilidad de hoy y la reserva
 * queda pendiente hasta definirlo.
 */
function eventAvailabilityRange(
  event: { setupAt?: string | null; startsAt?: string | null; strikeAt?: string | null; endsAt?: string | null } | null,
): { startsAt: string; endsAt: string } | null {
  if (!event) return null;
  const startsAt = event.setupAt ?? event.startsAt ?? null;
  const endsAt = event.strikeAt ?? event.endsAt ?? null;
  if (!startsAt || !endsAt) return null;
  return { startsAt, endsAt };
}

/** Rango del evento en una línea: `21-sept. 08:00 → 23-sept. 20:00`. */
function eventRangeLabel(range: { startsAt: string; endsAt: string }): string {
  return `${formatDateTime(range.startsAt)} → ${formatDateTime(range.endsAt)}`;
}

/**
 * Visor de comprobantes de pago (issue #17). Lo comparten Presupuestos (ficha
 * del presupuesto) y Finanzas (cobro pendiente): los metadatos llegan del API y
 * cada archivo se sirve con sesión desde `/api/admin/budgets/proofs/[id]`, en
 * línea (imagen en el visor, PDF embebido) o en una pestaña nueva.
 *
 * Cuando llega `onCollect`, el pie del diálogo ofrece "Marcar cobrado" para el
 * cobro que se está mirando: un clic y el cobro queda cerrado con su auditoría.
 */
export function BudgetProofDialog({
  title,
  subtitle,
  proofs,
  onClose,
  onCollect,
  collectBusy,
  collectLabel,
}: {
  title: string;
  subtitle?: string;
  proofs: AdminBudgetPaymentProofRow[];
  onClose: () => void;
  onCollect?: () => void;
  collectBusy?: boolean;
  collectLabel?: string;
}) {
  return (
    <AdminDialog
      title={title}
      size="lg"
      icon="budgets"
      description={subtitle}
      onClose={onClose}
      footer={
        <>
          <AdminButton icon="close" type="button" onClick={onClose}>Cerrar</AdminButton>
          {onCollect ? (
            <AdminButton variant="primary" icon="check" type="button" busy={collectBusy} busyLabel="Cobrando…" onClick={onCollect}>
              {collectLabel ?? "Marcar cobrado"}
            </AdminButton>
          ) : null}
        </>
      }
    >
      <AdminDialogSection title="Comprobantes" stack>
      {proofs.length === 0 ? (
        <p className="admin-dialog-text">Este presupuesto todavía no tiene comprobantes subidos desde el portal.</p>
      ) : (
        <div className="admin-proof-list">
          {proofs.map((proof) => {
            const url = `/api/admin/budgets/proofs/${proof.id}`;
            const when = formatDateTime(proof.createdAt);
            return (
              <article className="admin-proof" key={proof.id}>
                <header className="admin-proof-head">
                  <AdminBadge tone="info">{paymentProofMimeLabel(proof.mime)}</AdminBadge>
                  <span className="admin-proof-meta">
                    {formatBytes(proof.size)} · {proof.uploadedByName} · {when}
                  </span>
                </header>
                {proof.mime === "application/pdf" ? (
                  <iframe
                    className="admin-proof-pdf"
                    src={url}
                    title={`Comprobante PDF de ${proof.uploadedByName} del ${when}`}
                  />
                ) : (
                  <a
                    className="admin-proof-frame"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Abrir el comprobante de ${proof.uploadedByName} en una pestaña nueva`}
                  >
                    <img
                      className="admin-proof-image"
                      src={url}
                      alt={`Comprobante subido por ${proof.uploadedByName} el ${when}`}
                    />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
      </AdminDialogSection>
    </AdminDialog>
  );
}

/**
 * Vínculo de los ítems del presupuesto con el inventario (issue #18). Cada
 * cambio se guarda al instante (`PATCH /api/admin/budgets` con
 * `kind: "item-link"`) y queda auditado; el presupuesto y el inventario se
 * recargan al cerrar. Sin vínculo, el ítem no reserva nada al aprobar.
 */
function ItemLinksDialog({
  budget,
  onClose,
  onSaved,
}: {
  budget: AdminBudgetRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [links, setLinks] = useState<Record<string, AdminInventoryLink | null>>(() =>
    Object.fromEntries(budget.items.map((item) => [item.id, item.inventory ?? null])),
  );
  const [openId, setOpenId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const range = eventAvailabilityRange(budget.event);
  const locked = Boolean(budget.inventoryLinksLocked || budget.approvedAt || budget.status === "APPROVED" || !budgetInPlay(budget));
  const linkedCount = budget.items.filter((item) => links[item.id]).length;

  async function save(item: AdminBudgetRow["items"][number], inventory: AdminInventoryLink | null) {
    if (locked) return;
    setBusyId(item.id);
    setError("");
    setNotice("");
    const result = await adminSend(
      "/api/admin/budgets",
      { kind: "item-link", budgetId: budget.id, itemId: item.id, inventoryId: inventory?.id ?? null },
      "PATCH",
    );
    setBusyId("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLinks((current) => ({ ...current, [item.id]: inventory }));
    setOpenId("");
    setNotice(
      inventory
        ? `«${item.name}» vinculado con «${inventory.name}»: al aprobar reserva stock.`
        : `«${item.name}» quedó sin vínculo: no reserva stock.`,
    );
    onSaved();
  }

  return (
    <AdminDialog
      title={`Inventario del presupuesto · ${budget.title}`}
      size="lg"
      icon="inventory"
      error={error}
      onClose={onClose}
      footer={
        <AdminButton variant="primary" icon="check" type="button" onClick={onClose} busy={Boolean(busyId)} busyLabel="Guardando…">
          Listo
        </AdminButton>
      }
    >
      {locked ? <AdminNote>Los vínculos de un presupuesto aprobado, firmado o cerrado se conservan. Para preparar la entrega y asignar equipos, usá <a href="/eventos">Eventos</a>.</AdminNote> : null}
      <p className="admin-dialog-text">
        Solo los ítems vinculados con un artículo del inventario reservan stock cuando el presupuesto se aprueba (portal o
        panel), usando el rango del evento: montaje → desmontaje. Un ítem sin vínculo no reserva nada.
        {budget.event
          ? range
            ? ` Rango del evento «${budget.event.name}»: ${eventRangeLabel(range)}.`
            : ` El evento «${budget.event.name}» no tiene fechas: la reserva queda pendiente hasta definirlas.`
          : " El presupuesto no tiene evento asociado: la reserva queda pendiente hasta asociarlo."}
      </p>
      <p className="admin-dialog-text">
        {formatNumber(linkedCount)} de {formatNumber(budget.items.length)} ítems vinculados. Los conflictos de disponibilidad
        bloquean la aprobación: ajustá las cantidades o elegí sustitutos. Solo el propietario puede autorizar una excepción explícita, que queda auditada.
      </p>

      <AdminDialogSection title="Ítems del presupuesto" stack>
      <div className="admin-link-list">
        {budget.items.map((item) => {
          const link = links[item.id] ?? null;
          const open = openId === item.id;
          const busy = busyId === item.id;
          return (
            <div className="admin-link-item" key={item.id}>
              <div className="admin-link-row">
                <span className="admin-link-name" title={item.name}>
                  <strong>{item.name}</strong>
                  <small className="admin-cell-sub">
                    {" "}
                    · {formatNumber(item.quantity)} × {formatNumber(item.days)} d
                  </small>
                </span>
                <span className="admin-link-free" title={link ? `Vinculado con ${link.name}` : "Sin vínculo: el ítem no reserva stock"}>
                  {link ? (
                    <>
                      Inventario: <strong>{link.name}</strong>
                    </>
                  ) : (
                    <span className="admin-muted">Sin vínculo · no reserva</span>
                  )}
                </span>
                <span className="admin-actions">
                  <AdminButton
                    icon={link ? "edit" : "check"}
                    busy={busy}
                    title={link ? `Cambiar el artículo de «${item.name}»` : `Vincular «${item.name}» con el inventario`}
                    aria-label={link ? `Cambiar el artículo de «${item.name}»` : `Vincular «${item.name}» con el inventario`}
                    disabled={busy || locked}
                    onClick={() => setOpenId(open ? "" : item.id)}
                  >
                    {link ? "Cambiar" : "Vincular"}
                  </AdminButton>
                  {link ? (
                    <AdminButton
                      icon="close"
                      title={`Quitar el vínculo de «${item.name}»`}
                      aria-label={`Quitar el vínculo de «${item.name}»`}
                      disabled={busy || locked}
                      onClick={() => void save(item, null)}
                    />
                  ) : null}
                </span>
              </div>
              {open && !locked ? (
                <InventoryLinkPicker
                  label={`Artículo de inventario para «${item.name}»`}
                  hint={
                    range
                      ? `Disponibilidad calculada entre ${eventRangeLabel(range)}.`
                      : "Sin fechas del evento: se muestra la disponibilidad de hoy."
                  }
                  range={range}
                  selected={link}
                  disabled={busy || locked}
                  onSelect={(next) => void save(item, next)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      </AdminDialogSection>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
    </AdminDialog>
  );
}

export function PresupuestosModule() {
  const { role } = useAdminSession();
  const budgetsResource = useAdminResource("/api/admin/budgets", (payload) => ({
    budgets: payload.budgets ?? [],
    requests: payload.budgetRequests ?? [],
    rentalDefaults: payload.rentalDefaults ?? { depositPercent: null, securityDepositDefault: null },
  }));

  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<BudgetPipelineFilter>("all");
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createItems, setCreateItems] = useState<BudgetItemDraft[]>([]);
  /** Seña y garantía del alta: sin tocar rige el default de Ajustes (ver BudgetCreationDeposit). */
  const [createDeposit, setCreateDeposit] = useState(EMPTY_CREATION_DEPOSIT);
  const [depositBudget, setDepositBudget] = useState<AdminBudgetRow | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventEdit, setEventEdit] = useState<AdminBudgetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  /** Lead → Presupuesto: id del lead de origen y lo que el API precargó (sin datos personales en la URL). */
  const [leadId, setLeadId] = useState("");
  const [leadDraft, setLeadDraft] = useState<LeadDraft | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const searchParams = useSearchParams();
  // Catálogos del alta de presupuesto (issue #59): cliente y evento solo se usan
  // en ese formulario, así que se piden al abrirlo y no en el primer render (la
  // lista ya trae cliente y evento de cada presupuesto).
  // El cliente llega con los campos mínimos del selector (issue #62). El evento
  // se pide completo a propósito: el rango de disponibilidad del issue #18
  // (setupAt/strikeAt/endsAt) todavía no viaja en el selector; si OPS lo agrega,
  // el alta puede recortar la respuesta sin tocar nada más.
  const events = useAdminResource("/api/admin/events", (payload) => payload.events ?? [], { enabled: showForm });
  const [notice, setNotice] = useState("");
  const writableForLead = canWriteFinance(role);
  const leadParam = searchParams.get("lead")?.trim() ?? "";
  const newRequested = searchParams.get("nuevo") === "1";
  // Enlaces del Resumen: `?estado=APPROVED` abre la lista ya filtrada.
  const estadoParam = (searchParams.get("estado") ?? "").trim().toUpperCase();
  useEffect(() => {
    const mapped = ESTADO_PARAM_FILTER[estadoParam];
    if (mapped) setStageFilter(mapped);
  }, [estadoParam]);
  // Pestaña «Solicitudes del portal» (`?vista=solicitudes`) y detalle por enlace
  // (`?detalle=<id>`, lo usan los links del Inicio): el panel lateral se abre al
  // cargar y el parámetro desaparece al cerrarlo.
  const vistaParam = searchParams.get("vista")?.trim() ?? "";
  const detalleParam = searchParams.get("detalle")?.trim() ?? "";
  function clearDetailParam() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("detalle")) return;
    url.searchParams.delete("detalle");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  // «Nuevo presupuesto» desde la ficha del cliente: `?nuevo=1&cliente=<id>`.
  // Enlace del Resumen: `?detalle=<id>` abre el detalle de ese presupuesto.
  const clientParam = searchParams.get("cliente")?.trim() ?? "";
  useEffect(() => {
    if (!newRequested || !writableForLead) return;
    setShowForm(true);
    if (clientParam && !leadParam) setForm((current) => ({ ...current, clientId: current.clientId || clientParam }));
    if (!leadParam) return;
    let active = true;
    setLeadId(leadParam);
    setLeadLoading(true);
    setFormError("");
    adminApiGet<LeadDraft>(`/api/admin/budgets/lead-draft?leadId=${encodeURIComponent(leadParam)}`, { fresh: true }).then((result) => {
      if (!active) return;
      setLeadLoading(false);
      if (!result.ok) {
        setLeadId("");
        setFormError(result.error);
        return;
      }
      const draft = result.data;
      setLeadDraft(draft);
      setForm((current) => ({ ...current, title: current.title || draft.title, clientId: current.clientId || draft.client?.id || "" }));
      setNotes((current) => current || draft.notes);
    });
    return () => {
      active = false;
    };
  }, [newRequested, leadParam, clientParam, writableForLead]);
  /** Altas rápidas desde el propio formulario (issue #88): nombre tipeado o null. */
  const [newClientName, setNewClientName] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState<string | null>(null);
  const [boardError, setBoardError] = useState("");
  const [view, setView] = useAdminModuleView("presupuestos");
  /** Ancho compacto (issue #143): pestañas de estado y tarjetas, sin tablero. */
  const narrow = useAdminNarrowViewport();
  /** Precio, costos y condiciones del presupuesto (issue #65). */
  const [pricing, setPricing] = useState<AdminBudgetRow | null>(null);

  // Portal del cliente (issue #12): diálogo de link/QR y diálogo de aprobación.
  const [portalBudget, setPortalBudget] = useState<AdminBudgetRow | null>(null);
  const [qr, setQr] = useState("");
  const [approval, setApproval] = useState<{ budget: AdminBudgetRow; decision: ApprovalDecision } | null>(null);
  const [note, setNote] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  /** Aviso de bloqueo por falta de stock al aprobar (alquileres P1-3); «Aprobar igual» solo OWNER/ADMIN. */
  const [stockWarning, setStockWarning] = useState("");
  const forceApprovalRef = useRef(false);

  // Autogestión (issue #14): solicitudes, plan de pagos y datos de pago.
  const [resolution, setResolution] = useState<{ request: AdminBudgetRequestRow; decision: RequestDecision } | null>(null);
  /** Conversación comparativa de una solicitud del portal (issue #143). */
  const [talkRequest, setTalkRequest] = useState<AdminBudgetRequestRow | null>(null);
  const [counterItems, setCounterItems] = useState<Record<string, { quantity: number; days: number; excluded?: boolean }>>({});
  const [counterDiscount, setCounterDiscount] = useState("");
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [plan, setPlan] = useState<{ budget: AdminBudgetRow; advance: string; terms: string; installments: BudgetConditionDraft[] } | null>(null);
  // Foto del plan al abrirlo: «hay cambios sin guardar» es distinto de ella.
  const planRef = useRef(plan);
  planRef.current = plan;
  const planBaseRef = useRef("");
  const planBudgetId = plan?.budget.id ?? "";
  useEffect(() => {
    const current = planRef.current;
    planBaseRef.current = current ? JSON.stringify({ advance: current.advance, terms: current.terms, installments: current.installments }) : "";
  }, [planBudgetId]);

  // Vínculo con inventario y reserva automática (issue #18).
  const [linksBudget, setLinksBudget] = useState<AdminBudgetRow | null>(null);
  // Cronología real del presupuesto (issue #33).
  const [timelineBudget, setTimelineBudget] = useState<AdminBudgetRow | null>(null);
  // Portal de firma del cliente (issue #79): solicitudes y auditoría del presupuesto.
  const [signatureBudget, setSignatureBudget] = useState<AdminBudgetRow | null>(null);
  // Evento del presupuesto aprobado: detalle abierto y acción en curso (una sola a la vez).
  const [detailBudgetId, setDetailBudgetId] = useState<string | null>(null);
  const [eventBusyId, setEventBusyId] = useState<string | null>(null);
  const eventInFlight = useRef(false);
  const [reservationReport, setReservationReport] = useState<{ title: string; reservation: AdminBudgetReservation } | null>(null);
  // Comprobantes de pago (issue #17): metadatos por presupuesto y visor.
  const [proofsByBudget, setProofsByBudget] = useState<Record<string, AdminBudgetPaymentProofRow[]>>({});
  const [proofDialog, setProofDialog] = useState<AdminBudgetRow | null>(null);

  // Envío del presupuesto por correo (issue #30): destinatario editable y mensaje corto.
  const [sendBudget, setSendBudget] = useState<AdminBudgetRow | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendPreview, setSendPreview] = useState<MailPreview | null>(null);
  /** Demo: correo que no salió, con su vista previa. */
  const [simulatedMail, setSimulatedMail] = useState<SimulatedMail | null>(null);
  const mailInFlight = useRef(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendStartsAt, setSendStartsAt] = useState("");
  const [sendEndsAt, setSendEndsAt] = useState("");
  const [sendDatesBusy, setSendDatesBusy] = useState(false);
  const sendDatesInFlight = useRef(false);
  const sendDatesDirty = Boolean(sendBudget && (sendStartsAt !== inputDateTime(sendBudget.event?.startsAt) || sendEndsAt !== inputDateTime(sendBudget.event?.endsAt)));
  /** Envío por WhatsApp con plantilla (issue #35) para el cliente del presupuesto. */
  const [templateTarget, setTemplateTarget] = useState<MessageTemplateTarget | null>(null);

  const writable = canWriteFinance(role);
  // Altas rápidas del formulario (issue #88): mismas capacidades del API
  // (`clients.write` para el cliente y `events.write` para el evento).
  const canCreateClient = canWriteClients(role);
  const canCreateEvent = canWriteOperations(role);
  const canManagePayments = role === "OWNER" || role === "ADMIN";
  const clients = useClientSelector(form.clientId);
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  const eventOptions = useMemo(() => events.data ?? [], [events.data]);
  const portalToken = portalBudget?.publicToken ?? null;

  // Opciones del combobox (issue #88): cliente con empresa/nombre y evento con
  // fechas + cliente, sobre los catálogos que ya carga el alta.
  const clientChoices = useMemo<ComboboxOption[]>(
    () => clientOptions.map(clientComboboxOption),
    [clientOptions],
  );
  const eventChoices = useMemo<ComboboxOption[]>(
    () =>
      eventOptions.map((event) => {
        const when = event.startsAt ? `${formatDateShort(event.startsAt)} · ${formatTime(event.startsAt)}` : "Sin fecha";
        const client = clientDisplayName(event.client);
        return { value: event.id, label: event.name, description: `${when} · ${client}` };
      }),
    [eventOptions],
  );

  // Rango del evento elegido en el alta: define la disponibilidad que muestra el
  // buscador de inventario y lo que se reservará al aprobar (issue #18).
  const formEvent = useMemo(() => eventOptions.find((event) => event.id === form.eventId) ?? null, [eventOptions, form.eventId]);
  const formRange = useMemo(() => eventAvailabilityRange(formEvent), [formEvent]);

  // Lo archivado (papelera) sale de la lista, el tablero y las etapas; se ve con el filtro «Archivados».
  const allBudgetRows = useMemo(() => budgetsResource.data?.budgets ?? [], [budgetsResource.data]);
  const budgetRows = useMemo(() => allBudgetRows.filter((budget) => !budget.archivedAt), [allBudgetRows]);
  const archivedBudgetRows = useMemo(() => allBudgetRows.filter((budget) => Boolean(budget.archivedAt)), [allBudgetRows]);
  const [archivedView, setArchivedView] = useState(false);
  const trash = useTrashFlow("Budget", {
    onChanged: budgetsResource.reload,
    onTrashed: (id) => setDetailBudgetId((current) => (current === id ? null : current)),
  });
  // `?detalle=<id>`: abre el detalle si el presupuesto es de esta empresa; si no existe
  // (otra empresa, borrado) se ignora. En ambos casos se limpia de la URL.
  useEffect(() => {
    if (!detalleParam || budgetsResource.loading || !budgetsResource.data) return;
    if (allBudgetRows.some((budget) => budget.id === detalleParam)) setDetailBudgetId(detalleParam);
    const url = new URL(window.location.href);
    url.searchParams.delete("detalle");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [detalleParam, budgetsResource.loading, budgetsResource.data, allBudgetRows]);
  const requestRows = useMemo(() => budgetsResource.data?.requests ?? [], [budgetsResource.data]);
  const showRequests = vistaParam === "solicitudes" && requestRows.length > 0;
  const pendingRequests = useMemo(() => requestRows.filter((request) => request.status === "pending"), [requestRows]);

  const rows = useMemo(() => {
    return (archivedView ? archivedBudgetRows : budgetRows)
      .filter((budget) => archivedView || matchesPipelineFilter(budgetPipelineStage(budget), stageFilter))
      .filter((budget) => matchesQuery(query, [budget.title, budget.client.company, budget.client.name, budget.event?.name, budgetReference(budget.id)]))
      .sort(compareBudgetUrgency);
  }, [budgetRows, archivedBudgetRows, archivedView, query, stageFilter]);

  /** Cantidad y monto por etapa para los KPIs-filtro. */
  const stageTotals = useMemo(() => {
    const totals = new Map<BudgetPipelineStage, { count: number; amount: number }>();
    for (const budget of budgetRows) {
      const stage = budgetPipelineStage(budget);
      const current = totals.get(stage) ?? { count: 0, amount: 0 };
      totals.set(stage, { count: current.count + 1, amount: current.amount + budget.total });
    }
    return totals;
  }, [budgetRows]);

  // Tablero (issue #26): el estado vive en las columnas; el filtro por etapa de
  // los KPIs recorta las tarjetas y el orden por urgencia fija cada columna.
  const boardRows = rows;

  const moveBudget = useCallback(async (budget: AdminBudgetRow, nextStatus: string) => {
    setBoardError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets", { budgetId: budget.id, status: nextStatus }, "PATCH");
    if (!result.ok) return { ok: false as const, error: result.error };
    if (nextStatus === "APPROVED" && result.data.reservations?.outcomes.length) {
      setReservationReport({ title: budget.title, reservation: result.data.reservations });
    }
    // El movimiento puede crear evento y pagos: releer el objeto completo evita
    // dejar «Crear evento» o acciones de borrador sobre la tarjeta aprobada.
    budgetsResource.reload();
    return { ok: true as const };
  }, [budgetsResource.reload]);
  const board = useAdminBoardMove({ rows: boardRows, move: moveBudget, onError: setBoardError });

  /** Siguiente acción lógica del presupuesto según su etapa y los permisos del rol. */
  function primaryOf(budget: AdminBudgetRow): BudgetPrimaryAction | null {
    return budgetPrimaryAction(pipelineInput(budget), { write: writable, createEvent: canCreateEvent });
  }

  function runPrimary(budget: AdminBudgetRow, action: BudgetPrimaryAction) {
    switch (action.kind) {
      case "send": return openSend(budget);
      case "approve": return openApproval(budget, "approve");
      case "edit": return setPricing(budget);
      case "create_event": return void createEventFor(budget);
      case "confirm_event": return void confirmEventFor(budget);
      case "collect":
      case "review_proof": return router.push(`/finanzas/por-confirmar?presupuesto=${encodeURIComponent(budget.id)}`);
    }
  }

  /** La única acción visible de la fila o tarjeta, más el menú «•••» con todo lo demás. */
  function rowActions(budget: AdminBudgetRow, menuOnly = false) {
    const primary = menuOnly ? null : primaryOf(budget);
    return (
      <span className="admin-actions">
        {primary ? (
          <AdminButton
            size="sm"
            busy={eventBusyId === budget.id && (primary.kind === "create_event" || primary.kind === "confirm_event")}
            title={`${primary.label}: ${budget.title}`}
            aria-label={`${primary.label}: ${budget.title}`}
            onClick={() => runPrimary(budget, primary)}
          >
            {primary.label}
          </AdminButton>
        ) : null}
        <AdminActionsMenu label={`Acciones del presupuesto ${budget.title}`} items={budgetMenuItems(budget, menuOnly)} shortcuts={budgetShortcuts(budget)} />
      </span>
    );
  }

  /** Abre el portal del cliente en otra pestaña (genera el link si hace falta). */
  function viewAsClient(budget: AdminBudgetRow) {
    if (budget.publicToken) window.open(portalBudgetUrl(budget.publicToken), "_blank", "noopener,noreferrer");
    else if (writable) void issueClientLink(budget, "view");
    else setNotice("Este presupuesto todavía no tiene link público.");
  }

  function copyClientLink(budget: AdminBudgetRow) {
    if (budget.publicToken) void copyPortalLink(budget);
    else if (writable) void issueClientLink(budget, "copy");
    else setNotice("Este presupuesto todavía no tiene link público.");
  }

  function openWhatsapp(budget: AdminBudgetRow) {
    setTemplateTarget({ kind: "budget", id: budget.id, label: `${budget.title} · ${clientDisplayName(budget.client)}`, phone: budget.client.phone });
  }

  const boardCards: AdminBoardCardData[] = board.rows.map((budget) => {
    const paid = collectedAmount(budget.payments);
    const balance = budget.total - paid;
    const advance = budgetDepositAmount(budget);
    const approvalState = budgetApprovalState(budget);
    const stage = budgetPipelineStage(budget);
    return {
      id: budget.id,
      status: budget.status,
      title: budget.title,
      identity: <ClientIdentityView client={budget.client} />,
      subtitle: budget.event?.name ?? null,
      amount: budget.total,
      amountNote: balance > 0 ? `saldo ${formatMoney(balance)}` : "cobrado",
      date: budget.validUntil,
      dateTitle: `Validez de la oferta: ${budget.title}`,
      badges: [
        { label: PIPELINE_STAGE_LABEL[stage], tone: statusTone(budget.status) },
        ...(approvalState === "CAMBIOS_SOLICITADOS" ? [{ label: budgetApprovalLabel(approvalState), tone: budgetApprovalTone(approvalState), title: portalSummary(budget) }] : []),
      ],
      detail: `PRES-${budgetReference(budget.id)} · ${formatNumber(budget.items.length)} ítem${budget.items.length === 1 ? "" : "s"} · cobrado ${formatMoney(paid)}`,
      // Las columnas del tablero son angostas: acá solo el menú «•••» (la acción
      // lógica está arriba de todo en él y en el detalle).
      actions: rowActions(budget, true),
    };
  });

  /**
   * Todas las acciones del presupuesto en un solo menú «•••». El detalle reúne pagos,
   * inventario, firma e historial; el menú conserva los accesos frecuentes.
   */
  /** Archivar / Desarchivar / Eliminar (`budgets.write`); solo se archivan borradores, perdidos o cancelados. */
  function budgetTrashMenu(budget: AdminBudgetRow): AdminMenuItem[] {
    return trash.menu({
      id: budget.id,
      name: budget.title,
      archived: Boolean(budget.archivedAt),
      canWrite: writable,
      archiveBlockedReason: budgetArchiveBlockedReason(budget.status),
    });
  }

  /** Documentos y compartir: una fila de iconos, sin repetirlos en la lista. */
  function budgetShortcuts(budget: AdminBudgetRow): AdminMenuItem[] {
    return [
      { label: "Imprimir / PDF", icon: "print", href: `/imprimir/presupuesto/${budget.id}`, external: true },
      ...(writable ? [{ label: "Enviar por correo", icon: "mail" as const, onClick: () => openSend(budget) }] : []),
      ...(writable && budget.client.phone ? [{ label: "WhatsApp con plantilla", icon: "whatsapp" as const, onClick: () => openWhatsapp(budget) }] : []),
      ...(budget.publicToken || writable ? [
        { label: "Copiar enlace del cliente", icon: "copy" as const, onClick: () => copyClientLink(budget) },
        { label: "Ver como cliente", icon: "eye" as const, onClick: () => viewAsClient(budget) },
      ] : []),
    ];
  }

  function budgetMenuItems(budget: AdminBudgetRow, menuOnly = false): AdminMenuItem[] {
    const primary = primaryOf(budget);
    // La fila ya muestra el siguiente paso. En el tablero sigue accesible arriba.
    return [
      ...(menuOnly && primary ? [{ label: primary.label, icon: "check" as const, onClick: () => runPrimary(budget, primary) }] : []),
      { label: "Ver detalle", icon: "eye", onClick: () => openDetail(budget.id), title: "Cliente, pagos, garantía, inventario, firma e historial" },
      ...(writable && !(menuOnly && primary?.kind === "edit") ? [{ label: "Editar presupuesto", icon: "edit" as const, onClick: () => setPricing(budget) }] : []),
      { label: budget.publicToken ? "Portal del cliente" : "Generar link del portal", icon: "globe", onClick: () => openPortal(budget) },
      ...budgetTrashMenu(budget),
    ];
  }

  /** Tarjetas del ancho compacto: etapa, monto, saldo, vencimiento y la siguiente acción. */
  const budgetCards: AdminCardData[] = rows.map((budget) => {
    const paid = collectedAmount(budget.payments);
    const balance = budget.total - paid;
    const advance = budgetDepositAmount(budget);
    const approvalState = budgetApprovalState(budget);
    return {
      id: budget.id,
      title: <AdminButton type="button" variant="link" onClick={() => openDetail(budget.id)}><strong className="admin-quote-title">{budget.title}</strong></AdminButton>,
      titleTooltip: `PRES-${budgetReference(budget.id)} · ${budget.title}${budget.event ? ` · ${budget.event.name}` : ""}`,
      identity: <ClientIdentityView client={budget.client} />,
      subtitle: budget.event?.name ?? null,
      badges: [
        { label: PIPELINE_STAGE_LABEL[budgetPipelineStage(budget)], tone: statusTone(budget.status) },
        ...(approvalState === "CAMBIOS_SOLICITADOS" ? [{ label: budgetApprovalLabel(approvalState), tone: budgetApprovalTone(approvalState), title: portalSummary(budget) }] : []),
      ],
      fields: [
        { label: "Monto", value: <strong>{formatMoney(budget.total)}</strong>, title: formatMoney(budget.total) },
        { label: advance > 0 && paid < advance ? "Seña" : "Saldo", value: formatMoney(advance > 0 && paid < advance ? advance - paid : balance), title: `Total ${formatMoney(budget.total)} · cobrado ${formatMoney(paid)} · saldo ${formatMoney(balance)}` },
        {
          label: "Vence",
          value: budget.validUntil ? (
            <>
              <span className="admin-nowrap">{formatDateShort(budget.validUntil)}</span>{" "}
              <AdminCountdown value={budget.validUntil} className="admin-countdown--inline" title={`Validez de la oferta: ${budget.title}`} />
            </>
          ) : "—",
          title: budget.validUntil ? `Vence el ${formatDate(budget.validUntil)}` : "Sin vencimiento",
        },
      ],
      footer: rowActions(budget),
    };
  });

  /** Acciones del panel de detalle: cada una abre la ventana existente de esa edición. */
  function detailActionsOf(budget: AdminBudgetRow): BudgetDetailActions {
    const primary = primaryOf(budget);
    return {
      onPrimary: primary ? () => runPrimary(budget, primary) : undefined,
      trashMenu: budgetTrashMenu(budget),
      onSend: writable ? () => openSend(budget) : undefined,
      onEdit: writable ? () => setPricing(budget) : undefined,
      onPlan: writable ? () => openPlan(budget) : undefined,
      onCollect: writable && budget.status === "APPROVED" && primary?.kind !== "collect" && primary?.kind !== "review_proof"
        ? () => router.push(`/finanzas/por-confirmar?presupuesto=${encodeURIComponent(budget.id)}`) : undefined,
      onDeposit: writable ? () => setDepositBudget(budget) : undefined,
      onInventory: writable ? () => setLinksBudget(budget) : undefined,
      onEventName: writable && canCreateEvent && budget.event ? () => { setEventEdit(budget); setEventName(budget.event!.name); setDialogError(""); } : undefined,
      onApprove: writable && !budget.approvedAt && budgetInPlay(budget) ? () => openApproval(budget, "approve") : undefined,
      onRequestChanges: writable && !budget.approvedAt && budgetInPlay(budget) ? () => openApproval(budget, "request_revision") : undefined,
      onWhatsapp: writable && budget.client.phone ? () => openWhatsapp(budget) : undefined,
      onProofs: () => setProofDialog(budget),
      onCreateEvent: () => void createEventFor(budget),
      onConfirmEvent: () => void confirmEventFor(budget),
      onPortal: () => openPortal(budget),
      onCopyLink: () => copyClientLink(budget),
      onViewClient: () => viewAsClient(budget),
      onSignature: () => setSignatureBudget(budget),
    };
  }

  function openDetail(id: string) {
    setDetailBudgetId(id);
  }

  function closeDetail() {
    setDetailBudgetId(null);
    clearDetailParam();
  }

  // Comprobantes del portal (issue #17): una sola consulta de metadatos por
  // carga de presupuestos; el visor los agrupa por presupuesto.
  const proofSignature = useMemo(() => budgetRows.map((budget) => budget.id).join(","), [budgetRows]);
  useEffect(() => {
    if (!proofSignature) {
      setProofsByBudget({});
      return;
    }
    let active = true;
    void adminApiGet<{ proofs?: AdminBudgetPaymentProofRow[] }>("/api/admin/budgets/proofs", {
      fallbackError: "No pudimos cargar los comprobantes.",
    }).then((result) => {
      if (!active || !result.ok) return;
      setProofsByBudget(groupProofsByBudget(result.data.proofs ?? []));
    });
    return () => {
      active = false;
    };
  }, [proofSignature]);

  // El QR se arma en el navegador con la URL pública del presupuesto abierto.
  useEffect(() => {
    let active = true;
    setQr("");
    if (!portalBudget?.publicToken) return;
    qrDataUrl(portalBudgetUrl(portalBudget.publicToken), 240)
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr("");
      });
    return () => {
      active = false;
    };
  }, [portalBudget]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // El combobox no tiene `required` nativo (puede llevar texto sin elegir):
    // se valida acá y el API revalida.
    if (!form.clientId && !leadId) {
      setFormError("Elegí el cliente del presupuesto.");
      return;
    }
    if (!form.title.trim() || !createItems.length || createItems.some((item) => !item.unitPrice.trim() || !item.quantity || !item.days || budgetItemError({ name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice) })) || !budgetMoneyValid(budgetDraftSubtotal(createItems))) {
      setFormError("Completá el título y todos los ítems con cantidades y montos válidos."); return;
    }
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/budgets", {
      clientId: form.clientId || undefined,
      leadId: leadId || undefined,
      notes: leadId && notes.trim() ? notes : undefined,
      eventId: form.eventId || undefined,
      title: form.title,
      ...creationDepositBody(createDeposit),
      items: createItems.map((item) => ({ name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice), freeOnPurpose: Boolean(item.freeOnPurpose) && Number(item.unitPrice) === 0, inventoryId: item.inventory?.id, notes: item.notes, ...(item.inventory && item.rentalDays && Number.isInteger(Number(item.rentalDays)) ? { rentalDays: Number(item.rentalDays) } : {}) })),
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setForm(EMPTY_FORM);
    setCreateItems([]);
    setCreateDeposit(EMPTY_CREATION_DEPOSIT);
    if (leadId) closeLeadDraft();
    setNotice(`Presupuesto «${form.title}» creado como borrador${leadId ? " desde el lead; el lead quedó en Cotizado si todavía no estaba ganado" : ""}. Podés abrir vista previa o enviarlo desde sus acciones.`);
    budgetsResource.reload();
  }

  /** Cierra la precarga del lead y limpia `?nuevo=1&lead=` de la URL. */
  function closeLeadDraft() {
    setLeadId("");
    setLeadDraft(null);
    setNotes("");
    if (typeof window !== "undefined" && window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }

  /** Alta rápida de cliente (issue #88): lo deja elegido y refresca el catálogo. */
  function selectCreatedClient(client: AdminClientOption) {
    setNewClientName(null);
    setForm((current) => ({ ...current, clientId: client.id }));
    clients.reload();
    setNotice(`Cliente «${clientDisplayName(client)}» creado y seleccionado.`);
  }

  /** Alta rápida de evento (issue #88): queda elegido y con su rango disponible. */
  function selectCreatedEvent(event: { id: string; name: string }, clientId: string) {
    setNewEventName(null);
    setForm((current) => ({ ...current, eventId: event.id, clientId: current.clientId || clientId }));
    events.reload();
    setNotice(`Evento «${event.name}» creado y seleccionado.`);
  }

  function openPortal(budget: AdminBudgetRow) {
    setDialogError("");
    setPortalBudget(budget);
  }

  function openApproval(budget: AdminBudgetRow, decision: ApprovalDecision) {
    setDialogError("");
    setStockWarning("");
    setNote("");
    setApproval({ budget, decision });
  }

  function openResolution(request: AdminBudgetRequestRow, decision: RequestDecision) {
    setDialogError("");
    setNote("");
    setCounterDiscount(
      request.kind === "discount" && request.payload.discount
        ? String(request.payload.discount.amount)
        : "",
    );
    setCounterItems(
      Object.fromEntries((request.payload.items ?? []).map((item) => [item.id, { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) }])),
    );
    setResolution({ request, decision });
  }

  function openPlan(budget: AdminBudgetRow) {
    setDialogError("");
    setPlan({
      budget,
      advance: budget.advanceAmount > 0 ? String(budget.advanceAmount) : "",
      terms: budget.paymentTerms ?? "",
      installments: conditionDrafts(budget.installmentsJson ?? []),
    });
  }

  async function issueClientLink(budget: AdminBudgetRow, intent: "copy" | "view") {
    if (linkBusy) return;
    setLinkBusy(true);
    // Reserve the blank tab during the user gesture to avoid popup blocking.
    const tab = intent === "view" ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/token", { budgetId: budget.id, action: "ensure" });
      if (!result.ok || !result.data.budget?.publicToken) {
        tab?.close(); setNotice(!result.ok ? result.error : "No recibimos el enlace del cliente."); return;
      }
      const current = { ...budget, ...result.data.budget };
      if (intent === "copy") await copyPortalLink(current);
      else if (tab) tab.location.href = portalBudgetUrl(current.publicToken!);
      else setNotice(`El navegador bloqueó la pestaña. Enlace del cliente: ${portalBudgetUrl(current.publicToken!)}`);
      budgetsResource.reload();
    } finally { setLinkBusy(false); }
  }

  async function copyPortalLink(budget: AdminBudgetRow) {
    if (!budget.publicToken) return;
    const url = portalBudgetUrl(budget.publicToken);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Link copiado: ${url}`);
    } catch {
      setNotice(`No pudimos copiar automáticamente; el link es ${url}`);
    }
  }

  async function submitPortalAction(action: "generate" | "revoke") {
    if (!portalBudget) return;
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/token", {
      budgetId: portalBudget.id,
      action,
    });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    const updated = result.data.budget;
    if (updated) setPortalBudget({ ...portalBudget, ...updated });
    setNotice(
      action === "generate"
        ? `Link del portal generado para «${portalBudget.title}». El link anterior dejó de funcionar.`
        : `Link del portal revocado para «${portalBudget.title}».`,
    );
    budgetsResource.reload();
  }

  /** Abre el diálogo de envío por correo con el destinatario del cliente ya cargado. */
  function openSend(budget: AdminBudgetRow) {
    setSendPreview(null);
    setSendTo(normalizeEmail(budget.client.email ?? ""));
    setSendMessage("");
    setSendError("");
    setSendStartsAt(inputDateTime(budget.event?.startsAt));
    setSendEndsAt(inputDateTime(budget.event?.endsAt));
    setSendBudget(budget);
  }

  async function saveSendDates() {
    if (!sendBudget || sendDatesInFlight.current || mailInFlight.current || sendBusy || linkBusy) return;
    if ([sendStartsAt, sendEndsAt].some(value => value && !Number.isFinite(new Date(value).getTime()))) { setSendError("Ingresá fechas válidas."); return; }
    if (sendStartsAt && sendEndsAt && new Date(sendEndsAt) < new Date(sendStartsAt)) { setSendError("El fin no puede ser anterior al inicio."); return; }
    sendDatesInFlight.current = true; setSendDatesBusy(true); setSendError(""); setSendPreview(null);
    try {
      const result = await adminSend<{ event: NonNullable<AdminBudgetRow["event"]> }>(`/api/admin/budgets/${sendBudget.id}/schedule`, {
        startsAt: sendStartsAt ? new Date(sendStartsAt).toISOString() : null,
        endsAt: sendEndsAt ? new Date(sendEndsAt).toISOString() : null,
        originalEventId: sendBudget.event?.id ?? null,
        originalStartsAt: sendBudget.event?.startsAt ?? null,
        originalEndsAt: sendBudget.event?.endsAt ?? null,
      }, "PATCH");
      if (!result.ok) { setSendError(result.error); return; }
      setSendBudget({ ...sendBudget, event: result.data.event });
      setSendStartsAt(inputDateTime(result.data.event.startsAt)); setSendEndsAt(inputDateTime(result.data.event.endsAt));
      setNotice("Fechas del evento guardadas. El correo todavía no se envió.");
      budgetsResource.reload(); events.reload();
    } finally { sendDatesInFlight.current = false; setSendDatesBusy(false); }
  }

  /** Genera el link del portal desde el diálogo de envío (sin link no hay correo). */
  async function generateLinkForSend() {
    if (!sendBudget || linkBusy || sendDatesInFlight.current || mailInFlight.current) return;
    setSendPreview(null);
    setLinkBusy(true);
    setSendError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/token", {
      budgetId: sendBudget.id,
      action: "generate",
    });
    setLinkBusy(false);
    if (!result.ok) {
      setSendError(result.error);
      return;
    }
    const updated = result.data.budget;
    if (updated) setSendBudget({ ...sendBudget, ...updated });
    setNotice(`Link del portal generado para «${sendBudget.title}».`);
    budgetsResource.reload();
  }

  /** First click previews only; a separate click confirms the exact payload. */
  async function sendBudgetMail() {
    if (!sendBudget || linkBusy || sendDatesInFlight.current || mailInFlight.current) return;
    if (sendDatesDirty) { setSendError("Guardá las fechas antes de previsualizar el correo."); return; }
    const to = normalizeEmail(sendTo);
    if (!emailValid(to)) {
      setSendError(FIELD_MESSAGES.email);
      return;
    }
    mailInFlight.current = true;
    setSendBusy(true);
    setSendError("");
    try {
      const result = await adminSend<MailPreview | { status: string; error: string | null; to: string; simulated?: boolean; preview?: SimulatedMail | null }>("/api/admin/budgets/send", {
        budgetId: sendBudget.id,
        to,
        message: sendMessage.trim() || undefined,
        ...(sendPreview ? { confirm: true, confirmationToken: sendPreview.confirmationToken } : { preview: true }),
      });
      if (!result.ok) {
        setSendPreview(null);
        setSendError(result.error);
        return;
      }
      if (result.data.status === "preview" && "confirmationToken" in result.data) {
        setSendPreview(result.data);
        return;
      }
      if ("simulated" in result.data && result.data.simulated) {
        // Demo: no salió ningún correo; se muestra cómo se habría visto.
        setNotice(`${SIMULATED_MAIL_NOTICE}: presupuesto «${sendBudget.title}» para ${result.data.to}.`);
        setSimulatedMail(result.data.preview ?? null);
        setSendBudget(null);
        budgetsResource.reload();
        return;
      }
      if (result.data.status === "sent") {
        setNotice(`Enviamos el presupuesto «${sendBudget.title}» a ${result.data.to}.`);
        setSendBudget(null);
        budgetsResource.reload();
        return;
      }
      setSendError(("error" in result.data ? result.data.error : null) ?? "El proveedor rechazó el envío.");
    } finally {
      mailInFlight.current = false;
      setSendBusy(false);
    }
  }

  /**
   * «Crear evento» de un presupuesto aprobado sin evento. Single-flight: un
   * segundo clic no sale; el servidor además serializa con FOR UPDATE.
   */
  async function createEventFor(budget: AdminBudgetRow) {
    if (eventInFlight.current) return;
    eventInFlight.current = true;
    setEventBusyId(budget.id);
    setBoardError("");
    try {
      const result = await adminSend<{ event?: { id: string; name: string }; reservations?: AdminBudgetReservation | null }>(`/api/admin/budgets/${budget.id}/create-event`, {});
      if (!result.ok) {
        setBoardError(result.error);
        // Otro clic o usuario pudo crearlo antes: se refresca el listado.
        budgetsResource.reload();
        return;
      }
      const reservation = result.data.reservations ?? null;
      setReservationReport(reservation && reservation.outcomes.length > 0 ? { title: budget.title, reservation } : null);
      setNotice(`Evento «${result.data.event?.name ?? budget.title}» creado desde «${budget.title}».`);
      budgetsResource.reload();
    } finally {
      eventInFlight.current = false;
      setEventBusyId(null);
    }
  }

  /** «Confirmar evento»: pasa a CONFIRMED el evento en borrador de un presupuesto aprobado. */
  async function confirmEventFor(budget: AdminBudgetRow) {
    if (eventInFlight.current || !budget.event) return;
    eventInFlight.current = true;
    setEventBusyId(budget.id);
    setBoardError("");
    try {
      const result = await adminSend("/api/admin/events", { id: budget.event.id, status: "CONFIRMED" }, "PATCH");
      if (!result.ok) {
        setBoardError(result.error);
        return;
      }
      setNotice(`Evento «${budget.event.name}» confirmado.`);
      budgetsResource.reload();
    } finally {
      eventInFlight.current = false;
      setEventBusyId(null);
    }
  }

  async function submitApproval() {
    // «Aprobar igual» (OWNER/ADMIN) marca la ref y vuelve a pasar por el mismo camino y la misma guarda de la nota.
    const force = forceApprovalRef.current;
    forceApprovalRef.current = false;
    if (!approval) return;
    const noteError = budgetApprovalNoteError(approval.decision, note);
    if (noteError) {
      setDialogError(noteError);
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/approval", {
      budgetId: approval.budget.id,
      decision: approval.decision,
      note: note.trim() || undefined,
      ...(force ? { force: true } : {}),
    });
    setDialogBusy(false);
    if (!result.ok) {
      if (result.code === "stock_insufficient") {
        setStockWarning(result.error);
        return;
      }
      setStockWarning("");
      setDialogError(result.error);
      return;
    }
    setStockWarning("");
    const reservations = result.data.reservations ?? null;
    if (approval.decision === "approve" && reservations && reservations.outcomes.length > 0) {
      setReservationReport({ title: approval.budget.title, reservation: reservations });
    } else {
      setReservationReport(null);
    }
    setNotice(
      approval.decision === "approve"
        ? `Aprobación manual registrada para «${approval.budget.title}».`
        : `Pedido de cambios registrado para «${approval.budget.title}».`,
    );
    setApproval(null);
    setNote("");
    budgetsResource.reload();
  }

  /** Acepta o rechaza una solicitud del portal (issue #14). */
  async function submitResolution() {
    if (!resolution) return;
    if (resolution.decision === "reject" && note.trim().length < 3) {
      setDialogError("Indicá la nota del rechazo: el cliente la lee en su portal.");
      return;
    }
    const body: Record<string, unknown> = {
      requestId: resolution.request.id,
      decision: resolution.decision,
      responseNote: note.trim() || undefined,
    };
    if (resolution.decision === "accept") {
      if (resolution.request.kind === "items") {
        body.counter = {
          items: Object.entries(counterItems).map(([id, value]) => ({ id, quantity: value.quantity, days: value.days, excluded: Boolean(value.excluded) })),
        };
      }
      if (resolution.request.kind === "discount") {
        const amount = Number(counterDiscount.replace(/\D/g, ""));
        if (!Number.isInteger(amount) || amount <= 0) {
          setDialogError("La contra-oferta debe ser un monto mayor a cero.");
          return;
        }
        body.counter = { discountAmount: amount };
      }
    }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend("/api/admin/budgets/requests", body);
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setNotice(
      resolution.decision === "accept"
        ? `Solicitud de «${clientDisplayName(resolution.request.budget.client)}» aceptada y aplicada al presupuesto.`
        : `Solicitud de «${clientDisplayName(resolution.request.budget.client)}» rechazada con nota.`,
    );
    setResolution(null);
    setNote("");
    budgetsResource.reload();
  }

  /** Guarda el plan de pagos del presupuesto (anticipo, condiciones y cuotas). */
  async function submitPlan() {
    if (!plan) return;
    const advance = plan.advance.trim() ? Number(plan.advance.replace(/\D/g, "")) : 0;
    if (!Number.isInteger(advance) || advance < 0) {
      setDialogError("El anticipo debe ser un monto en guaraníes.");
      return;
    }
    const installments = conditionPayload(plan.installments);
    const checked = resolveBudgetPaymentPlan(installments, plan.budget.total, advance);
    if (!checked.ok) { setDialogError(checked.error); return; }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend(
      "/api/admin/budgets",
      {
        budgetId: plan.budget.id,
        advanceAmount: advance,
        paymentTerms: plan.terms.trim(),
        installmentsJson: installments,
      },
      "PATCH",
    );
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setNotice(`Plan de pagos guardado para «${plan.budget.title}».`);
    setPlan(null);
    budgetsResource.reload();
  }

  const resolutionLabel = resolution
    ? `${resolution.decision === "accept" ? "Aceptar" : "Rechazar"} · ${resolution.request.budget.title}`
    : "";
  const counterSubtotal = resolution
    ? resolution.request.budget.items.reduce((sum, item) => {
        const value = counterItems[item.id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
        return sum + (value.excluded ? 0 : item.unitPrice * value.quantity * value.days);
      }, 0)
    : 0;
  const counterDiscountAmount =
    resolution?.request.kind === "discount" ? Number(counterDiscount.replace(/\D/g, "")) || 0 : 0;
  const counterTotal = Math.max(0, counterSubtotal - counterDiscountAmount);

  return (
    <div className="admin-module-page">
      <PresupuestosTabs active={showRequests ? "solicitudes" : "presupuestos"} requests={requestRows.length} pendingRequests={pendingRequests.length} />
      <AdminModuleContext
        breadcrumb="Ventas / Presupuestos"
        hint={showRequests ? "Pedidos de cambios y rebajas que llegaron desde el portal del cliente." : "Qué enviar, qué aprobar y qué cobrar, según la etapa de cada presupuesto."}
        meta={showRequests ? `${formatNumber(pendingRequests.length)} pendientes` : `${formatNumber(rows.length)} visibles`}
        action={writable && !showRequests ? (
          <AdminButton
            variant="primary"
            icon="plus"
            onClick={() => {
              setFormError("");
              setShowForm((open) => !open);
            }}
            aria-expanded={showForm}
          >
            Nuevo presupuesto
          </AdminButton>
        ) : undefined}
      />
      {showRequests ? null : (
        <>
      <AdminKpis className="admin-kpis--stages" state={kpiState(budgetsResource)} label="Etapas de los presupuestos (tocá una para filtrar la lista)">
        {STAGE_KPIS.map(({ stage, icon, tone }) => {
          const total = stageTotals.get(stage) ?? { count: 0, amount: 0 };
          return (
            <AdminKpi
              key={stage}
              label={PIPELINE_STAGE_LABEL[stage]}
              icon={icon}
              value={formatNumber(total.count)}
              note={total.count > 0 ? formatMoney(total.amount) : "sin presupuestos"}
              tone={total.count > 0 ? tone : undefined}
              active={stageFilter === stage || (stageFilter === "approved_any" && (stage === "approved" || stage === "approved_pending_event"))}
              onSelect={() => setStageFilter((current) => (current === stage ? "all" : stage))}
            />
          );
        })}
      </AdminKpis>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar presupuestos"
          placeholder="Buscar por número, título, cliente o evento…"
        />
        <AdminSelect
          value={archivedView ? "ARCHIVED" : "ACTIVE"}
          onChange={(value) => setArchivedView(value === "ARCHIVED")}
          label="Ver presupuestos"
          options={[
            { value: "ACTIVE", label: "Activos" },
            { value: "ARCHIVED", label: "Archivados" },
          ]}
        />
        {narrow ? null : <AdminViewSwitch view={view} onChange={setView} label="Vista de presupuestos" />}
        {writable ? <BudgetComparisons quotes={budgetRows} /> : null}
        {canManagePayments ? (
          <AdminButton
            icon="finance"
            title="Datos de pago de la empresa"
            aria-label="Datos de pago de la empresa"
            onClick={() => setPaymentsOpen(true)}
          >
            Datos de pago
          </AdminButton>
        ) : null}
      </AdminToolbar>
      {stageFilter !== "all" ? (
        <p className="admin-filter-note" role="status">
          Mostrando: <strong>{FILTER_LABEL[stageFilter]}</strong> ({formatNumber(rows.length)})
          <AdminButton type="button" variant="link" onClick={() => setStageFilter("all")}>Quitar filtro</AdminButton>
        </p>
      ) : null}
        </>
      )}

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {trash.note}
      {writable ? trash.dialog : null}
      {boardError ? <AdminNote tone="error">{boardError}</AdminNote> : null}

      {writable && showForm && !showRequests ? (
        <form className="admin-form-panel" onSubmit={submit} aria-busy={busy}>
          <h2 className="admin-form-title">Nuevo presupuesto</h2>
          {leadLoading ? <AdminNote>Cargando los datos del lead…</AdminNote> : null}
          {leadDraft ? (
            <AdminNote tone={leadDraft.client || leadDraft.canCreateClient ? undefined : "error"}>
              {`Viene del lead de ${leadDraft.lead.company || leadDraft.lead.name}. `}
              {leadDraft.client
                ? `Cliente existente: «${leadDraft.client.company || leadDraft.client.name}».`
                : leadDraft.canCreateClient
                  ? "Todavía no es cliente: se creará al guardar (o se reutilizará uno con el mismo email o teléfono)."
                  : "Todavía no es cliente y tu rol no puede crearlo: pedí que lo conviertan desde Leads."}
            </AdminNote>
          ) : null}
          {leadDraft && leadDraft.existingBudgets.length > 0 ? (
            <AdminNote tone="warn">
              {`Este lead ya tiene ${leadDraft.existingBudgets.length === 1 ? "un presupuesto" : `${leadDraft.existingBudgets.length} presupuestos`}: ${leadDraft.existingBudgets.map((b) => `${budgetReference(b.id)} · ${budgetStatusLabel(b.status)}`).join(", ")}. Podés crear otro igual.`}
            </AdminNote>
          ) : null}
          <div className="admin-form-grid">
          <Combobox
            label="Cliente"
            required={!leadId}
            value={form.clientId}
            onChange={(value) => setForm({ ...form, clientId: value })}
            options={clientChoices}
            onSearch={clients.onSearch}
            placeholder="Buscá por nombre o empresa…"
            emptyLabel={
              clients.loading
                ? "Cargando clientes…"
                : clients.error
                  ? "No pudimos cargar los clientes."
                  : "No hay clientes cargados."
            }
            onCreate={canCreateClient ? (name) => setNewClientName(name) : undefined}
            createLabel={(query) => (query ? `Crear cliente «${query}»` : "Crear cliente")}
          />
          <TextField
            label="Título"
            required
            maxLength={160}
            value={form.title}
            onChange={(value) => setForm({ ...form, title: value })}
            placeholder="Ej.: Alquiler pantalla LED 6×3"
          />
          <AdminDisclosure title="Evento y notas" hint={form.eventId ? "Evento vinculado" : "Opcional · el evento se crea al aprobar"} defaultOpen={Boolean(form.eventId)}>
          <Combobox
            label="Evento (opcional)"
            value={form.eventId}
            onChange={(value) => setForm({ ...form, eventId: value })}
            options={eventChoices}
            placeholder="Buscá por nombre o dejalo vacío…"
            emptyLabel={events.loading ? "Cargando eventos…" : "No hay eventos cargados."}
            onCreate={canCreateEvent ? (name) => setNewEventName(name) : undefined}
            createLabel={(query) => (query ? `Crear evento «${query}»` : "Crear evento")}
          />
          {leadId ? (
            <TextAreaField
              label="Notas del pedido"
              hint="El cliente ve estas notas en el presupuesto."
              wide
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={setNotes}
            />
          ) : null}
          </AdminDisclosure>
          </div>
          <BudgetItemsEditor items={createItems} onChange={setCreateItems} disabled={busy} range={formRange} />
          <BudgetCreationDeposit state={createDeposit} onChange={setCreateDeposit} defaults={budgetsResource.data?.rentalDefaults ?? { depositPercent: null, securityDepositDefault: null }} subtotal={budgetDraftSubtotal(createItems)} disabled={busy} />
          {formError ? <AdminNote tone="error">{formError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <AdminButton type="button" disabled={busy} onClick={() => { setShowForm(false); if (leadId) closeLeadDraft(); }}>Cancelar</AdminButton>
            <AdminButton type="submit" variant="primary" busy={busy} disabled={(!form.clientId && !leadId) || (Boolean(leadDraft) && !form.clientId && !leadDraft?.client && !leadDraft?.canCreateClient) || leadLoading || !form.title.trim() || !createItems.length || createItems.some((item) => !item.unitPrice || !item.quantity || !item.days || budgetItemError({ name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice) })) || !budgetMoneyValid(budgetDraftSubtotal(createItems))}>Guardar borrador</AdminButton>
          </div>
        </form>
      ) : null}

      {showRequests ? (
        <AdminPanel
          title="Solicitudes del portal" icon="globe"
          meta={
            pendingRequests.length > 0
              ? `${formatNumber(pendingRequests.length)} pendiente${pendingRequests.length === 1 ? "" : "s"}`
              : "Sin pendientes"
          }
        >
          {/* Conversación comparativa (issue #143): el pedido del cliente al lado
              de la propuesta original, con la respuesta del equipo. */}
          <ul className="admin-request-list" aria-label="Solicitudes del portal">
            {requestRows.map((request) => {
              const clientLabel = clientDisplayName(request.budget.client);
              const resolved = request.status !== "pending";
              const when = resolved && request.resolvedAt
                ? `Resuelta el ${formatDateTime(request.resolvedAt)}${request.resolvedByName ? ` por ${request.resolvedByName}` : ""} · Pedida el ${formatDateTime(request.createdAt)}`
                : `Pedida el ${formatDateTime(request.createdAt)} por ${request.requestedByName}`;
              return (
                <li className="admin-request" key={request.id}>
                  <div className="admin-request-head">
                    <AdminBadge tone={budgetChangeStatusTone(request.status)}>{budgetChangeStatusLabel(request.status)}</AdminBadge>
                    <strong>{budgetChangeKindLabel(request.kind)}</strong>
                    <span className="admin-request-sub">
                      {request.budget.title} · {clientLabel}
                    </span>
                    <span className="admin-request-when" title={when}>
                      {formatDateTime(request.createdAt)} · {request.requestedByName}
                    </span>
                  </div>
                  <div className="admin-request-talk">
                    <p className="admin-request-message">
                      <span className="admin-request-actor">Cliente</span>
                      {request.note || "Pedido sin comentario"}
                    </p>
                    <p className="admin-request-message">
                      <span className="admin-request-actor">Cambio propuesto</span>
                      {requestDelta(request)}
                    </p>
                    {request.responseNote ? (
                      <p className="admin-request-message admin-request-message--team">
                        <span className="admin-request-actor">
                          Equipo{request.resolvedByName ? ` · ${request.resolvedByName}` : ""}
                        </span>
                        {request.responseNote}
                      </p>
                    ) : null}
                  </div>
                  <div className="admin-request-actions">
                    <AdminButton
                      icon="eye"
                      title={`Ver la conversación de ${clientLabel}`}
                      aria-label={`Ver la conversación de ${clientLabel}`}
                      onClick={() => setTalkRequest(request)}
                    >
                      Ver conversación
                    </AdminButton>
                    {writable && !resolved ? (
                      <>
                        <AdminButton
                          icon="check"
                          title={`Aceptar la solicitud de ${clientLabel}`}
                          aria-label={`Aceptar la solicitud de ${clientLabel}`}
                          onClick={() => openResolution(request, "accept")}
                        >
                          Aceptar
                        </AdminButton>
                        <AdminButton
                          icon="close"
                          title={`Rechazar la solicitud de ${clientLabel}`}
                          aria-label={`Rechazar la solicitud de ${clientLabel}`}
                          onClick={() => openResolution(request, "reject")}
                        >
                          Rechazar
                        </AdminButton>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminPanel>
      ) : null}

      {showRequests ? null : (
      <AdminDataState
        loading={budgetsResource.loading}
        error={budgetsResource.error}
        onRetry={budgetsResource.reload}
        empty={allBudgetRows.length === 0}
        emptyTitle="Todavía no hay presupuestos" emptyIcon="budgets"
        emptyHint="Creá un presupuesto para seguir venta, costos, margen y cobros."
        emptyAction={writable ? <AdminButton type="button" variant="link" onClick={() => { setFormError(""); setShowForm(true); }}>Crear presupuesto →</AdminButton> : undefined}
      >
        {narrow ? (
          rows.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá la pestaña de estado." />
          ) : (
            <AdminCardGrid label="Presupuestos" cards={budgetCards} />
          )
        ) : view === "board" ? (
          board.rows.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda." />
          ) : (
            <AdminBoard
              label="Presupuestos"
              columns={BOARD_COLUMNS}
              cards={boardCards}
              canMove={writable}
              movingIds={board.movingIds}
              onMove={writable ? board.moveTo : undefined}
            />
          )
        ) : rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : (
          <AdminTable
            view="presupuestos"
            label="Presupuestos"
            columns={[
              { label: "N°" },
              { label: "Cliente" },
              { label: "Evento o título" },
              { label: "Monto", end: true },
              { label: "Seña / saldo", end: true },
              { label: "Etapa" },
              { label: "Vence" },
              { label: "Acción", end: true },
            ]}
          >
            {rows.map((budget) => {
              const paid = collectedAmount(budget.payments);
              const balance = budget.total - paid;
              const advance = budgetDepositAmount(budget);
              const advanceDue = Math.max(0, advance - paid);
              const approvalState = budgetApprovalState(budget);
              const stage = budgetPipelineStage(budget);
              return (
                <AdminRow key={budget.id}>
                  <AdminCell title={`Presupuesto PRES-${budgetReference(budget.id)}`}>
                    <span className="admin-nowrap admin-quote-ref">{budgetReference(budget.id)}</span>
                  </AdminCell>
                  <AdminCell title={clientDisplayName(budget.client)}><ClientIdentityView client={budget.client} /></AdminCell>
                  <AdminCell title={`${budget.title}${budget.event ? ` · ${budget.event.name}` : ""}`}>
                    <AdminButton type="button" variant="link" title={`Ver el detalle de ${budget.title}`} onClick={() => openDetail(budget.id)}>
                      <strong className="admin-quote-title">{budget.event?.name ?? budget.title}</strong>
                    </AdminButton>
                    {budget.event ? <small className="admin-cell-sub"> · {budget.title}</small> : null}
                  </AdminCell>
                  <AdminCell end title={formatMoney(budget.total)}>
                    <strong>{formatMoney(budget.total)}</strong>
                  </AdminCell>
                  <AdminCell end title={`Saldo ${formatMoney(balance)} de ${formatMoney(budget.total)} · cobrado ${formatMoney(paid)}${advance > 0 ? ` · seña ${formatMoney(advance)}` : ""}`}>
                    {balance === 0 && budget.total > 0 ? "Cobrado" : (
                      <>
                        <small className="admin-cell-sub">{advanceDue > 0 ? "seña " : "saldo "}</small>
                        {formatMoney(advanceDue > 0 ? advanceDue : balance)}
                      </>
                    )}
                  </AdminCell>
                  <AdminCell title={`${PIPELINE_STAGE_LABEL[stage]} · ${budgetStatusLabel(budget.status)}${approvalState === "CAMBIOS_SOLICITADOS" ? " · el cliente pidió cambios" : ""}`}>
                    <AdminBadge tone={approvalState === "CAMBIOS_SOLICITADOS" ? budgetApprovalTone(approvalState) : statusTone(budget.status)}>{approvalState === "CAMBIOS_SOLICITADOS" ? "Pidió cambios" : PIPELINE_STAGE_LABEL[stage]}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={budget.validUntil ? `Vence el ${formatDateShort(budget.validUntil)}` : "Sin vencimiento"}>
                    {budget.validUntil ? <span className="admin-nowrap">{formatDateShort(budget.validUntil)}</span> : "—"}
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    {rowActions(budget)}
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>
      )}

      {portalBudget ? (
        <AdminDialog
          title={`Portal del cliente · ${portalBudget.title}`}
          icon="globe"
          size="md"
          error={dialogError}
          onClose={() => setPortalBudget(null)}
          footer={
            <>
              {portalToken ? (
                <>
                  <AdminButton
                    icon="download"
                    type="button"
                    title="Copiar el link del portal"
                    aria-label="Copiar el link del portal"
                    onClick={() => void copyPortalLink(portalBudget)}
                  >Copiar enlace del cliente</AdminButton>
                  <AdminButton
                    icon="external"
                    type="button"
                    title="Abrir el portal en una pestaña nueva"
                    aria-label="Abrir el portal en una pestaña nueva"
                    onClick={() => window.open(portalBudgetUrl(portalToken), "_blank", "noopener,noreferrer")}
                  >Ver como cliente</AdminButton>
                  <AdminButton icon="power" type="button" onClick={() => void submitPortalAction("revoke")} disabled={dialogBusy}>
                    Revocar link
                  </AdminButton>
                </>
              ) : null}
              <AdminButton variant="primary" icon="refresh" type="button" busy={dialogBusy} busyLabel="Procesando…" onClick={() => void submitPortalAction("generate")}>
                {portalToken ? "Regenerar link" : "Generar link"}
              </AdminButton>
            </>
          }
        >
          <AdminDialogSection title="Link del cliente" stack>
          {portalToken ? (
            <>
              <div className="admin-dialog-qr">
                {qr ? (
                  <img src={qr} alt={`QR del presupuesto ${portalBudget.title} en el portal del cliente`} width={240} height={240} />
                ) : (
                  <span className="admin-spinner" role="status" aria-label="Generando QR" />
                )}
              </div>
              <p className="admin-dialog-code">{portalToken}</p>
              <TextField
                label="Link del portal"
                wide
                readOnly
                value={portalBudgetUrl(portalToken)}
                onChange={() => {}}
                onFocus={(event) => event.target.select()}
              />
              <p className="admin-dialog-text">
                Escaneá el QR o compartí el link: el cliente ve este presupuesto —y solo este—, puede ajustar cantidades y
                días, pedir una rebaja, aprobarlo o pedir cambios.
              </p>
            </>
          ) : (
            <p className="admin-dialog-text">
              Este presupuesto todavía no tiene link público. Generá uno para imprimir el QR y habilitar la aprobación
              online.
            </p>
          )}
          </AdminDialogSection>
        </AdminDialog>
      ) : null}

      {sendBudget ? (
        <AdminDialog
          title={`Enviar por correo · ${sendBudget.title}`}
          size="lg"
          icon="mail"
          description="El correo lleva el link del portal con el código, el resumen de ítems, total y validez, y la hoja imprimible."
          error={sendError || (!sendBudget.publicToken ? "Este presupuesto todavía no tiene link del portal: generá el link para que el correo lleve el código y el destino de aprobación." : "")}
          warning={!emailValid(sendBudget.client.email ?? "") ? "El cliente no tiene un correo válido cargado en su ficha: cargalo en Clientes o escribí otro destinatario acá." : undefined}
          dirty={sendMessage.trim() !== "" || sendDatesDirty}
          onClose={() => { if (!sendBusy && !linkBusy && !sendDatesBusy) setSendBudget(null); }}
          footer={({ requestClose }) => (
            <>
              {!sendBudget.publicToken ? (
                <AdminButton icon="refresh" type="button" busy={linkBusy} busyLabel="Generando…" disabled={sendBusy} onClick={() => void generateLinkForSend()}>
                  Generar link del portal
                </AdminButton>
              ) : null}
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={sendBusy || linkBusy || sendDatesBusy}>
                Cancelar
              </AdminButton>
              <AdminButton
                variant="primary"
                icon="mail"
                type="button"
                busy={sendBusy}
                busyLabel={sendPreview ? "Enviando…" : "Preparando…"}
                disabled={!sendBudget.publicToken || !emailValid(sendTo) || linkBusy || sendDatesBusy || sendDatesDirty}
                onClick={() => void sendBudgetMail()}
              >
                {sendPreview ? "Confirmar y enviar presupuesto" : "Previsualizar correo"}
              </AdminButton>
            </>
          )}
        >
          <dl className="admin-dialog-facts">
            <div>
              <dt>Cliente</dt>
              <dd><ClientIdentityView client={sendBudget.client} /></dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatMoney(sendBudget.total)}</dd>
            </div>
            <div>
              <dt>Validez</dt>
              <dd>{sendBudget.validUntil ? `hasta el ${formatDate(sendBudget.validUntil)}` : "sin vencimiento informado"}</dd>
            </div>
            <div>
              <dt>Código</dt>
              <dd>{sendBudget.publicToken ?? "sin link del portal"}</dd>
            </div>
            <div>
              <dt>Datos de pago</dt>
              <dd>
                {sendBudget.approvedAt
                  ? "se incluyen (presupuesto aprobado)"
                  : "no se incluyen: el presupuesto todavía no está aprobado"}
              </dd>
            </div>
          </dl>

          {canCreateEvent ? <><AdminDialogSection title="Fechas del evento (opcional)">
            <DateTimeField label="Inicio del evento" size="md" value={sendStartsAt} disabled={sendBusy || linkBusy || sendDatesBusy} onChange={value => { setSendStartsAt(value); setSendPreview(null); setSendError(""); }} />
            <DateTimeField label="Fin del evento" size="md" value={sendEndsAt} min={sendStartsAt || undefined} disabled={sendBusy || linkBusy || sendDatesBusy} onChange={value => { setSendEndsAt(value); setSendPreview(null); setSendError(""); }} />
            <AdminButton icon="check" type="button" busy={sendDatesBusy} busyLabel="Guardando…" disabled={!sendDatesDirty || sendBusy || linkBusy} onClick={() => void saveSendDates()}>Guardar fechas</AdminButton>
          </AdminDialogSection><AdminNote>Guardar fechas no aprueba el presupuesto ni reserva inventario.</AdminNote></> : null}

          <AdminDialogSection title="Destinatario">
          <EmailField
            label="Destinatario"
            required
            value={sendTo}
            onChange={(value) => {
              setSendTo(value);
              setSendPreview(null);
              setSendError("");
            }}
            disabled={sendBusy || linkBusy || sendDatesBusy}
            error={!emailValid(sendTo) ? (sendTo.trim() ? FIELD_MESSAGES.email : FIELD_MESSAGES.required) : undefined}
            hint="Podés cambiarlo: el correo se envía solo a esta dirección."
          />
          </AdminDialogSection>
          <AdminDialogSection title="Más opciones" collapsible defaultOpen={sendMessage.trim() !== ""} hint="mensaje corto para el cliente">
          <TextAreaField
            label="Mensaje corto (opcional)"
            wide
            value={sendMessage}
            onChange={(value) => {
              setSendMessage(value);
              setSendPreview(null);
              setSendError("");
            }}
            maxLength={600}
            disabled={sendBusy || linkBusy || sendDatesBusy}
            rows={3}
            placeholder="Ej.: cualquier duda me escribís; en el portal está el detalle completo."
          />

          </AdminDialogSection>

          {sendPreview ? (
            <AdminDialogSection title="Vista previa" stack>
              <AdminMailPreview preview={sendPreview} />
            </AdminDialogSection>
          ) : null}
        </AdminDialog>
      ) : null}

      {simulatedMail ? <AdminSimulatedMailDialog mail={simulatedMail} onClose={() => setSimulatedMail(null)} /> : null}

      {approval ? (
        <AdminDialog
          title={approval.decision === "approve" ? `Aprobar manualmente · ${approval.budget.title}` : `Pedir cambios · ${approval.budget.title}`}
          icon={approval.decision === "approve" ? "check" : "edit"}
          size="md"
          description={
            approval.decision === "approve"
              ? `Se registra la aprobación a nombre de ${clientDisplayName(approval.budget.client)}, con tu usuario y la fecha actual. Si ya hay una aprobación registrada, no se pisa.`
              : "El cliente no ve el cambio hasta que le compartas la versión actualizada; queda registrado en el presupuesto."
          }
          error={dialogError}
          dirty={note.trim() !== ""}
          onClose={() => setApproval(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={dialogBusy}>
                Cancelar
              </AdminButton>
              {stockWarning && (role === "OWNER" || role === "ADMIN") ? (
                <AdminButton icon="check" type="button" busy={dialogBusy} busyLabel="Registrando…" onClick={() => { forceApprovalRef.current = true; void submitApproval(); }}>
                  Aprobar igual
                </AdminButton>
              ) : null}
              {stockWarning ? null : (
                <AdminButton variant="primary" icon="check" type="button" busy={dialogBusy} busyLabel="Registrando…" disabled={Boolean(budgetApprovalNoteError(approval.decision, note))} onClick={() => void submitApproval()}>
                  {approval.decision === "approve" ? "Registrar aprobación" : "Registrar pedido"}
                </AdminButton>
              )}
            </>
          )}
        >
          <AdminDialogSection title={approval.decision === "approve" ? "Nota" : "Cambios pedidos"}>
          {stockWarning ? <AdminNote tone="warn">{stockWarning}</AdminNote> : null}
          <TextAreaField
            label={approval.decision === "approve" ? "Nota (opcional)" : "¿Qué cambios se piden?"}
            wide
            value={note}
            onChange={setNote}
            maxLength={BUDGET_APPROVAL_NOTE_MAX}
            rows={4}
            required={approval.decision === "request_revision"}
            placeholder={approval.decision === "approve" ? "Ej.: aprobado por teléfono, coordina con Santiago" : "Ej.: sumar un día más y cambiar el lugar"}
          />
          </AdminDialogSection>
        </AdminDialog>
      ) : null}

      {talkRequest ? (
        <AdminDialog
          title={`Conversación · ${talkRequest.budget.title}`}
          size="lg"
          icon="globe"
          onClose={() => setTalkRequest(null)}
          footer={
            <>
              <AdminButton icon="close" type="button" onClick={() => setTalkRequest(null)}>
                Cerrar
              </AdminButton>
              {writable && talkRequest.status === "pending" ? (
                <>
                  <AdminButton
                    icon="close"
                    type="button"
                    onClick={() => {
                      openResolution(talkRequest, "reject");
                      setTalkRequest(null);
                    }}
                  >
                    Rechazar
                  </AdminButton>
                  <AdminButton
                    variant="primary"
                    icon="check"
                    type="button"
                    onClick={() => {
                      openResolution(talkRequest, "accept");
                      setTalkRequest(null);
                    }}
                  >
                    Aceptar y aplicar
                  </AdminButton>
                </>
              ) : null}
            </>
          }
        >
          <AdminDialogSection title="Conversación" stack>
          <p className="admin-dialog-text">
            <strong>{talkRequest.requestedByName}</strong> pidió {budgetChangeKindLabel(talkRequest.kind).toLowerCase()} el{" "}
            {formatDateTime(talkRequest.createdAt)}. Comparación original vs propuesta:
          </p>
          <RequestComparison request={talkRequest} />
          {talkRequest.note ? (
            <p className="admin-dialog-text">
              <strong>Cliente:</strong> {talkRequest.note}
            </p>
          ) : null}
          {talkRequest.responseNote ? (
            <p className="admin-dialog-text">
              <strong>Equipo{talkRequest.resolvedByName ? ` · ${talkRequest.resolvedByName}` : ""}:</strong>{" "}
              {talkRequest.responseNote}
            </p>
          ) : null}
          </AdminDialogSection>
        </AdminDialog>
      ) : null}

      {resolution ? (
        <AdminDialog
          title={resolutionLabel}
          size="lg"
          icon="edit"
          description={
            resolution.request.kind === "items"
              ? "La propuesta del cliente se aplica al presupuesto con los precios unitarios originales. Podés ajustar las cantidades y días como contra-oferta antes de aceptar."
              : resolution.request.kind === "discount"
                ? "Al aceptar, el descuento se aplica al presupuesto y el total se recalcula. Podés contra-ofertar con otro monto."
                : "El pedido de cambios queda resuelto: el cliente lo ve respondido en su portal y el presupuesto deja de mostrarse como «cambios solicitados»."
          }
          error={dialogError}
          dirty={note.trim() !== ""}
          onClose={() => setResolution(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={dialogBusy}>
                Cancelar
              </AdminButton>
              <AdminButton
                variant={resolution.decision === "accept" ? "primary" : undefined}
                icon={resolution.decision === "accept" ? "check" : "close"}
                type="button"
                busy={dialogBusy}
                busyLabel="Guardando…"
                onClick={() => void submitResolution()}
              >
                {resolution.decision === "accept" ? "Aceptar y aplicar" : "Rechazar con nota"}
              </AdminButton>
            </>
          )}
        >
          <dl className="admin-dialog-facts">
            <div>
              <dt>Cliente</dt>
              <dd><ClientIdentityView client={resolution.request.budget.client} /></dd>
            </div>
            <div>
              <dt>Presupuesto</dt>
              <dd>{resolution.request.budget.title}</dd>
            </div>
            <div>
              <dt>Pedido</dt>
              <dd>{requestDelta(resolution.request)}</dd>
            </div>
            <div>
              <dt>Motivo</dt>
              <dd>{resolution.request.note || "—"}</dd>
            </div>
            <div>
              <dt>Total actual</dt>
              <dd>{formatMoney(resolution.request.budget.total)}</dd>
            </div>
          </dl>

          {resolution.decision === "accept" && resolution.request.kind === "items" ? (
            <AdminDialogSection title="Contra-oferta" stack>
            <div className="admin-dialog-table" role="table" aria-label="Contra-oferta de ítems">
              <div className="admin-dialog-table-head" role="row">
                <span role="columnheader">Ítem</span>
                <span role="columnheader">Actual</span>
                <span role="columnheader">Propuesto</span>
                <span role="columnheader" className="admin-dialog-num">
                  Subtotal
                </span>
              </div>
              {resolution.request.budget.items.map((item) => {
                const proposed = counterItems[item.id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
                const subtotal = proposed.excluded ? 0 : item.unitPrice * proposed.quantity * proposed.days;
                return (
                  <div className="admin-dialog-table-row" role="row" key={item.id}>
                    <span role="cell">{item.name}</span>
                    <span role="cell">
                      {formatNumber(item.quantity)} × {formatNumber(item.days)} d
                    </span>
                    <span role="cell" className="admin-dialog-counter">
                      <CheckboxField checked={Boolean(proposed.excluded)} onChange={(checked) => setCounterItems((rows) => ({ ...rows, [item.id]: counterofferExclusion(item, proposed, checked) }))} text="Retirado / no incluido" />
                      <NumberField
                        disabled={Boolean(proposed.excluded)}
                        ariaLabel={`Cantidad propuesta de ${item.name}`}
                        maxLength={4}
                        value={String(proposed.quantity)}
                        onChange={(value) =>
                          setCounterItems((current) => ({
                            ...current,
                            [item.id]: { ...proposed, quantity: Math.max(1, Number(value) || 1) },
                          }))
                        }
                      />
                      <span aria-hidden="true">×</span>
                      <NumberField
                        disabled={Boolean(proposed.excluded)}
                        ariaLabel={`Días propuestos de ${item.name}`}
                        maxLength={4}
                        value={String(proposed.days)}
                        onChange={(value) =>
                          setCounterItems((current) => ({
                            ...current,
                            [item.id]: { ...proposed, days: Math.max(1, Number(value) || 1) },
                          }))
                        }
                      />
                      <span aria-hidden="true">d</span>
                    </span>
                    <span role="cell" className="admin-dialog-num">
                      {formatMoney(subtotal)}
                    </span>
                  </div>
                );
              })}
            </div>
            </AdminDialogSection>
          ) : null}

          {resolution.decision === "accept" && resolution.request.kind === "discount" ? (
            <AdminDialogSection title="Contra-oferta">
              <MoneyField
                label="Descuento final (Gs)"
                hint="Podés aceptar el pedido o contra-ofertar con otro monto"
                value={counterDiscount}
                onChange={setCounterDiscount}
              />
            </AdminDialogSection>
          ) : null}

          {resolution.decision === "accept" ? (
            <p className="admin-dialog-text">
              {resolution.request.kind === "changes" ? (
                <>Queda auditado a tu nombre y el cliente lo ve en su portal.</>
              ) : (
                <>
                  Nuevo subtotal <strong>{formatMoney(counterSubtotal)}</strong> · nuevo total{" "}
                  <strong>{formatMoney(counterTotal)}</strong>
                  {resolution.request.budget.status === "APPROVED" ? (
                    <>
                      {" "}
                      · Ojo: el presupuesto ya está aprobado, así que el total aprobado queda desactualizado (la decisión se
                      audita igual).
                    </>
                  ) : null}
                </>
              )}
            </p>
          ) : null}

          <AdminDialogSection title="Respuesta al cliente">
          <TextAreaField
            label={resolution.decision === "accept" ? "Respuesta para el cliente (opcional)" : "Nota del rechazo (obligatoria)"}
            wide
            value={note}
            onChange={setNote}
            maxLength={600}
            rows={3}
            required={resolution.decision === "reject"}
            placeholder={
              resolution.decision === "accept"
                ? "Ej.: confirmamos el ajuste; el equipo pasa a coordinar los equipos"
                : "Ej.: no podemos bajar más el precio con esa cantidad de días"
            }
          />
          </AdminDialogSection>
        </AdminDialog>
      ) : null}

      {eventEdit?.event ? (
        <AdminDialog
          title="Nombre del evento compartido"
          size="sm"
          icon="events"
          description="Este nombre pertenece al evento y cambia en todos los presupuestos asociados. El título de cada presupuesto se conserva. Las versiones aceptadas o firmadas bloquean el cambio."
          error={dialogError}
          dirty={eventName.trim() !== eventEdit.event.name}
          onClose={() => setEventEdit(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton type="button" onClick={requestClose} disabled={dialogBusy}>Cancelar</AdminButton>
              <AdminButton
                variant="primary"
                type="button"
                busy={dialogBusy}
                busyLabel="Guardando…"
                disabled={!eventName.trim() || eventName.trim() === eventEdit.event!.name}
                onClick={async () => {
                  setDialogBusy(true); setDialogError("");
                  const result = await adminSend(`/api/admin/budgets/${eventEdit.id}/event`, { name: eventName, originalName: eventEdit.event!.name }, "PATCH");
                  setDialogBusy(false);
                  if (!result.ok) { setDialogError(result.error); return; }
                  setNotice(`Evento renombrado a «${eventName.trim()}» en todos sus presupuestos.`); setEventEdit(null); budgetsResource.reload(); events.reload();
                }}
              >Guardar nombre</AdminButton>
            </>
          )}
        >
          <AdminDialogSection title="Evento">
            <TextField label="Nombre del evento" required maxLength={160} value={eventName} onChange={setEventName} disabled={dialogBusy} />
          </AdminDialogSection>
        </AdminDialog>
      ) : null}
      {pricing ? (
        <BudgetPricingDialog
          budget={pricing}
          onClose={() => { setPricing(null); budgetsResource.reload(); }}
          onSaved={(message) => {
            setNotice(message);
            budgetsResource.reload();
          }}
        />
      ) : null}

      {plan ? (
        <AdminDialog
          title={`Plan de pagos · ${plan.budget.title}`}
          size="lg"
          icon="finance"
          description={`El anticipo y las cuotas se muestran en el portal con el presupuesto aprobado: el primero (o la primera cuota) aparece como «a transferir ahora». El plan no puede superar el total (${formatMoney(plan.budget.total)}).`}
          error={dialogError}
          dirty={planBaseRef.current !== "" && JSON.stringify({ advance: plan.advance, terms: plan.terms, installments: plan.installments }) !== planBaseRef.current}
          onClose={() => setPlan(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={dialogBusy}>
                Cancelar
              </AdminButton>
              <AdminButton variant="primary" icon="check" type="button" busy={dialogBusy} busyLabel="Guardando…" disabled={Boolean(plan.budget.approvedAt) || !resolveBudgetPaymentPlan(conditionPayload(plan.installments), plan.budget.total, Number(plan.advance) || 0).ok} onClick={() => void submitPlan()}>
                Guardar plan
              </AdminButton>
            </>
          )}
        >
          <AdminDialogSection title="Anticipo y condiciones">
            <MoneyField
              label="Anticipo (Gs)"
              hint="0 = sin anticipo separado"
              value={plan.advance}
              onChange={(value) => setPlan({ ...plan, advance: value })}
              placeholder="0"
            />
            <TextAreaField
              label="Condiciones"
              wide
              value={plan.terms}
              onChange={(value) => setPlan({ ...plan, terms: value })}
              maxLength={600}
              rows={3}
              placeholder="Ej.: 50 % al confirmar y saldo 7 días antes del evento"
            />
          </AdminDialogSection>
          <AdminDialogSection title="Cuotas" stack>
            <BudgetPaymentPlanEditor total={plan.budget.total} advance={Number(plan.advance) || 0} rows={plan.installments} onChange={(installments) => setPlan({ ...plan, installments })} disabled={dialogBusy || Boolean(plan.budget.approvedAt)} />
          </AdminDialogSection>
        </AdminDialog>
      ) : null}

      {paymentsOpen ? <PaymentDetailsDialog onClose={() => setPaymentsOpen(false)} /> : null}

      {depositBudget ? (
        <SecurityDepositDialog
          budget={depositBudget}
          onClose={() => setDepositBudget(null)}
          onSaved={(message) => { setNotice(message); budgetsResource.reload(); }}
        />
      ) : null}

      {linksBudget ? (
        <ItemLinksDialog
          budget={linksBudget}
          onClose={() => setLinksBudget(null)}
          onSaved={() => budgetsResource.reload()}
        />
      ) : null}

      {reservationReport ? (
        <AdminPanel
          title={`Reserva automática · ${reservationReport.title}`} icon="inventory"
          meta={`${formatNumber(reservationReport.reservation.reserved)} de ${formatNumber(reservationReport.reservation.requested)} unidades reservadas${
            reservationReport.reservation.eventName ? ` · ${reservationReport.reservation.eventName}` : ""
          }`}
          action={
            <AdminButton
              icon="close"
              title="Cerrar el reporte de la reserva"
              aria-label="Cerrar el reporte de la reserva"
              onClick={() => setReservationReport(null)}
            />
          }
        >
          <AdminNote tone={reservationReport.reservation.failed || reservationReport.reservation.conflicts > 0 ? "error" : "ok"}>
            {reservationReport.reservation.failed
              ? "No pudimos completar la reserva automática; revisá el inventario del presupuesto."
              : reservationReport.reservation.conflicts > 0
                ? `La aprobación quedó registrada. ${formatNumber(reservationReport.reservation.conflicts)} ítem${
                    reservationReport.reservation.conflicts === 1 ? "" : "s"
                  } sin reserva completa: el detalle está abajo y los sustitutos se sugieren en Inventario.`
                : "Los ítems vinculados quedaron reservados con el rango del evento."}
            {reservationReport.reservation.range ? ` Rango: ${eventRangeLabel(reservationReport.reservation.range)}.` : ""}
          </AdminNote>
          <AdminTable
            view="presupuestos-reserva"
            label={`Reserva automática de ${reservationReport.title}`}
            columns={[
              { label: "Ítem del presupuesto" },
              { label: "Artículo de inventario" },
              { label: "Pedidas", end: true },
              { label: "Reservadas", end: true },
              { label: "Estado" },
              { label: "Detalle" },
            ]}
          >
            {reservationReport.reservation.outcomes.map((outcome) => {
              const detail = [
                outcome.reason,
                outcome.conflicts.length > 0
                  ? `Ocupado por ${outcome.conflicts.map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`).join(", ")}`
                  : null,
                outcome.substitutes.length > 0
                  ? `Sustitutos: ${outcome.substitutes.map((substitute) => `${substitute.name} (${formatNumber(substitute.available)} libres)`).join(", ")}`
                  : null,
                ...(outcome.comboParts ?? []).map(
                  (part) =>
                    `Falta «${part.name}» (piden ${formatNumber(part.needed)}, hay ${formatNumber(part.available)})${
                      part.alternatives.length > 0
                        ? `: alternativas ${part.alternatives.map((alt) => `${alt.name} (${formatNumber(alt.available)} libres, ${alt.priceDelta === null ? "sin precio" : alt.priceDelta === 0 ? "mismo precio" : `${alt.priceDelta > 0 ? "+" : "−"}${formatMoney(Math.abs(alt.priceDelta))}`})`).join(", ")}`
                        : ": sin alternativas con stock"
                    }`,
                ),
              ]
                .filter((part): part is string => Boolean(part))
                .join(" · ");
              return (
                <AdminRow key={outcome.itemId} tone={reservationStatusTone(outcome.status)}>
                  <AdminCell title={outcome.itemName}>
                    <strong>{outcome.itemName}</strong>
                  </AdminCell>
                  <AdminCell title={`${outcome.inventoryName}${outcome.inventorySku ? ` · ${outcome.inventorySku}` : ""}`}>
                    {outcome.inventoryName}
                  </AdminCell>
                  <AdminCell end title={`${formatNumber(outcome.quantity)} pedidas`}>
                    {formatNumber(outcome.quantity)}
                  </AdminCell>
                  <AdminCell end title={`${formatNumber(outcome.reserved)} reservadas de ${formatNumber(outcome.total)} en total`}>
                    {formatNumber(outcome.reserved)}
                  </AdminCell>
                  <AdminCell title={outcome.reason ?? reservationStatusLabel(outcome.status)}>
                    <AdminBadge tone={reservationStatusTone(outcome.status)}>{reservationStatusLabel(outcome.status)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={detail || "Reserva completa"}>{detail || "—"}</AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        </AdminPanel>
      ) : null}
      {proofDialog ? (
        <BudgetProofDialog
          title={`Comprobantes · ${proofDialog.title}`}
          subtitle={`Enviados desde el portal por el cliente (${clientDisplayName(proofDialog.client)}). El archivo se sirve con tu sesión: no es público.`}
          proofs={proofsByBudget[proofDialog.id] ?? []}
          onClose={() => setProofDialog(null)}
        />
      ) : null}
      {signatureBudget ? (
        <SignatureDialog budget={signatureBudget} onClose={() => setSignatureBudget(null)} />
      ) : null}

      {/* Altas rápidas del propio formulario (issue #88): al crear, la opción
          queda elegida en el alta y el catálogo se refresca. */}
      {newClientName !== null ? (
        <ClientQuickCreateDialog
          initialName={newClientName}
          onClose={() => setNewClientName(null)}
          onCreated={selectCreatedClient}
        />
      ) : null}
      {newEventName !== null ? (
        <EventQuickCreateDialog
          initialName={newEventName}
          clientId={form.clientId}
          clients={clientOptions}
          clientsLoading={clients.loading}
          onClose={() => setNewEventName(null)}
          onCreated={selectCreatedEvent}
        />
      ) : null}

      {detailBudgetId ? (() => {
        const detailBudget = allBudgetRows.find((budget) => budget.id === detailBudgetId);
        return detailBudget ? (
          <BudgetDetailDialog
            budget={detailBudget}
            canAct={canCreateEvent}
            busy={eventBusyId === detailBudget.id}
            primary={primaryOf(detailBudget)}
            proofCount={(proofsByBudget[detailBudget.id] ?? []).length}
            actions={detailActionsOf(detailBudget)}
            onClose={closeDetail}
          />
        ) : null;
      })() : null}

      {timelineBudget ? (
        <AdminTimelineDialog
          title={`Cronología · ${timelineBudget.title}`}
          path={`/api/admin/timeline?budgetId=${encodeURIComponent(timelineBudget.id)}`}
          onClose={() => setTimelineBudget(null)}
        />
      ) : null}

      {templateTarget ? (
        <MessageTemplateSendDialog target={templateTarget} onClose={() => setTemplateTarget(null)} />

      ) : null}
    </div>
  );
}
