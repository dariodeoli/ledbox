"use client";
import { BudgetComparisons } from "./BudgetComparisons";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  budgetApprovalLabel,
  budgetApprovalMethodLabel,
  budgetApprovalTone,
  budgetChangeKindLabel,
  budgetChangeStatusLabel,
  budgetChangeStatusTone,
  budgetStatusLabel,
  daysUntilDue,
  formatBytes,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  inventoryStatusLabel,
  paymentProofMimeLabel,
  statusTone,
  whatsappHref,
  type AdminTone,
} from "@/lib/admin-format";
import { bankMark, bankSuggestions } from "@/lib/bank-mark";
import { internalCostOf } from "@/lib/budget-costs";
import { InventoryLinkPicker } from "./BudgetInventoryPicker";
import { counterofferExclusion } from "@/lib/quote-selection";
import { quoteProductPrice } from "@/lib/quote-sharing";
import { BudgetPricingDialog } from "./BudgetPricingDialog";
import { BudgetItemsEditor } from "./BudgetItemsEditor";
import { BudgetPaymentPlanEditor, conditionDrafts, conditionPayload, type BudgetConditionDraft } from "./BudgetPaymentPlanEditor";
import { budgetDraftSubtotal, budgetItemError, type BudgetItemDraft } from "@/lib/budget-items";
import { budgetMoneyValid, resolveBudgetPaymentPlan } from "@/lib/budget-payment-plan";
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
  type AdminInventoryItemRow,
  type AdminInventoryLink,
  type AdminPaymentDetails,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";
import { qrDataUrl } from "@/lib/qr";
import { useAdminSession } from "../AdminShell";
import { AdminBoard, AdminViewSwitch, useAdminBoardMove, useAdminModuleView, useAdminNarrowViewport, type AdminBoardCardData, type AdminBoardColumn } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import {
  AdminActionsMenu,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminDialog,
  AdminDisclosure,
  AdminEmpty,
  AdminFormPanel,
  AdminKpi,
  AdminModuleContext,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminTimelineDialog,
  AdminToolbar,
  AdminWhatsappTemplateButton,
  type AdminMenuItem,
} from "../AdminUI";
import { MessageTemplateSendDialog, type MessageTemplateTarget } from "../AdminMessageTemplateDialog";
import { SignatureDialog } from "./SignatureDialog";
import {
  Combobox,
  DateField,
  EmailField,
  MoneyField,
  NumberField,
  RucField,
  SearchField,
  TextAreaField,
  TextField,
  type ComboboxOption,
} from "../AdminFields";
import { adminApiGet, adminSend, useAdminResource } from "@/lib/admin-api";
import { emailValid, FIELD_MESSAGES, normalizeEmail } from "@/lib/field-rules";
import { currentMonthKey, monthKeyLabel, monthOf } from "@/lib/fiscal";

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "DRAFT", label: "Borrador" },
  { value: "SENT", label: "Enviado" },
  { value: "NEGOTIATING", label: "En negociación" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "LOST", label: "Perdido" },
  { value: "CANCELLED", label: "Cancelado" },
];

/** Tablero kanban: una columna por estado comercial (set de estados, sin máquina). */
const BOARD_COLUMNS: AdminBoardColumn[] = STATUS_OPTIONS.slice(1).map((option) => ({ value: option.value, label: option.label }));

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

const EMPTY_FORM = {
  clientId: "",
  eventId: "",
  title: "",
};

/** `id` del `<datalist>` con el catálogo de bancos (owncoding-ui) de Datos de pago. */
const BANK_LIST_ID = "datos-pago-banco-opciones";

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

/**
 * Próximo paso comercial (issue #143): la acción que sigue según el estado y la
 * aprobación del portal, en una línea. Prioridad visual de la lista y las
 * tarjetas móviles: monto, vencimiento, cliente y próximo paso.
 */
function budgetNextStep(budget: AdminBudgetRow): { label: string; hint: string } {
  if (budgetApprovalState(budget) === "CAMBIOS_SOLICITADOS") {
    return { label: "Responder cambios", hint: "El cliente pidió ajustes desde el portal" };
  }
  const days = daysUntilDue(budget.validUntil);
  if (budget.status === "DRAFT") return { label: "Enviar al cliente", hint: "Falta compartir la propuesta" };
  if (budget.status === "SENT") {
    if (days !== null && days < 0) return { label: "Reactivar vigencia", hint: "La validez venció sin respuesta" };
    if (days !== null && days <= 7) return { label: "Recordar vencimiento", hint: "La validez termina esta semana" };
    return { label: "Esperar respuesta", hint: "Enviado y pendiente del cliente" };
  }
  if (budget.status === "NEGOTIATING") return { label: "Acordar condiciones", hint: "Hay una negociación abierta" };
  if (budget.status === "APPROVED") return { label: "Cobrar anticipo", hint: "Aprobado: sigue el plan de pagos" };
  if (budget.status === "LOST") return { label: "Reactivar o cerrar", hint: "Perdido: definir si se reintenta" };
  return { label: "Archivado", hint: "Cancelado: sin acción pendiente" };
}

/** Resumen del plan de pagos para la columna del presupuesto. */
function planSummary(budget: AdminBudgetRow): string {
  const installments = Array.isArray(budget.installmentsJson) ? budget.installmentsJson : [];
  const parts: string[] = [];
  if (budget.advanceAmount > 0) parts.push(`anticipo ${formatMoney(budget.advanceAmount)}`);
  if (installments.length > 0) parts.push(`${formatNumber(installments.length)} cuota${installments.length === 1 ? "" : "s"}`);
  if (budget.paymentTerms) parts.push(budget.paymentTerms);
  return parts.length > 0 ? parts.join(" · ") : "Sin plan de pagos";
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
    <AdminDialog title={title} size="wide" icon="budgets" onClose={onClose}>
      {subtitle ? <p className="admin-dialog-text">{subtitle}</p> : null}
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
      <div className="admin-dialog-foot">
        {onCollect ? (
          <AdminButton variant="primary" icon="check" busy={collectBusy} onClick={onCollect}>
            {collectLabel ?? "Marcar cobrado"}
          </AdminButton>
        ) : null}
        <span className="admin-dialog-spacer" />
        <AdminButton icon="close" onClick={onClose}>Cerrar</AdminButton>
      </div>
    </AdminDialog>
  );
}

/**
 * Datos de pago de la empresa (issue #14): solo OWNER/ADMIN. Se cargan al abrir
 * el diálogo y se guardan en `app/api/admin/organization/payment-details`; el
 * portal los muestra recién con el presupuesto aprobado.
 */
function PaymentDetailsDialog({ onClose }: { onClose: () => void }) {
  const [details, setDetails] = useState<AdminPaymentDetails>({ bank: "", holder: "", ruc: "", account: "", alias: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void adminApiGet<{ paymentDetails?: Partial<AdminPaymentDetails> }>("/api/admin/organization/payment-details", {
      fresh: true,
      fallbackError: "No pudimos cargar los datos de pago.",
    })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          if (!result.sessionInvalid) setError(result.error);
          return;
        }
        setDetails({
          bank: result.data.paymentDetails?.bank ?? "",
          holder: result.data.paymentDetails?.holder ?? "",
          ruc: result.data.paymentDetails?.ruc ?? "",
          account: result.data.paymentDetails?.account ?? "",
          alias: result.data.paymentDetails?.alias ?? "",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const mark = bankMark(details.bank);

  async function save() {
    setBusy(true);
    setError("");
    const result = await adminSend<{ paymentDetails?: AdminPaymentDetails }>("/api/admin/organization/payment-details", details);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <AdminDialog title="Datos de pago de la empresa" size="wide" icon="building" onClose={onClose}>
      <p className="admin-dialog-text">
        Se muestran en el portal del cliente cuando el presupuesto está aprobado (junto al monto a transferir) y en la hoja
        imprimible. Sin datos cargados, el portal no inventa una cuenta.
      </p>
      {loading ? (
        <p className="admin-dialog-text">Cargando datos de pago…</p>
      ) : (
        <div className="admin-plan-grid">
          <TextField
            label="Banco"
            hint="Del catálogo o libre; el monograma reemplaza al logo mientras no haya asset"
            list={BANK_LIST_ID}
            value={details.bank ?? ""}
            onChange={(value) => setDetails({ ...details, bank: value })}
            maxLength={80}
            placeholder="Ej.: Banco Continental"
          />
          <datalist id={BANK_LIST_ID}>
            {bankSuggestions(details.bank).map((banco) => (
              <option key={banco} value={banco} />
            ))}
          </datalist>
          <TextField
            label="Titular"
            value={details.holder ?? ""}
            onChange={(value) => setDetails({ ...details, holder: value })}
            maxLength={120}
            placeholder="LedBox S.A."
          />
          <RucField
            label="RUC"
            value={details.ruc ?? ""}
            onChange={(value) => setDetails({ ...details, ruc: value })}
          />
          <TextField
            label="Cuenta"
            value={details.account ?? ""}
            onChange={(value) => setDetails({ ...details, account: value })}
            maxLength={40}
            placeholder="1234567890"
          />
          <TextField
            label="Alias"
            wide
            value={details.alias ?? ""}
            onChange={(value) => setDetails({ ...details, alias: value })}
            maxLength={60}
            placeholder="ledbox.cta"
          />
          {mark ? (
            <div className="admin-bank-preview">
              {mark.asset ? (
                <img className="admin-bank-asset" src={mark.asset} alt={`Logo de ${mark.label}`} />
              ) : (
                <span className="admin-bank-mark" style={{ background: mark.color }} aria-hidden="true">
                  {mark.initials}
                </span>
              )}
              <span>
                <strong>{mark.label}</strong>
                <small className="admin-cell-sub">{mark.asset ? " · logo oficial" : " · monograma hasta que haya logo versionado"}</small>
              </span>
            </div>
          ) : null}
        </div>
      )}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {saved ? <AdminNote tone="ok">Datos de pago guardados.</AdminNote> : null}
      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton icon="close" onClick={onClose} disabled={busy}>
          Cerrar
        </AdminButton>
        <AdminButton variant="primary" icon="check" busy={busy} onClick={() => void save()} disabled={loading}>
          Guardar datos
        </AdminButton>
      </div>
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
  const linkedCount = budget.items.filter((item) => links[item.id]).length;

  async function save(item: AdminBudgetRow["items"][number], inventory: AdminInventoryLink | null) {
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
    <AdminDialog title={`Inventario del presupuesto · ${budget.title}`} size="wide" icon="inventory" onClose={onClose}>
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
        no bloquean la aprobación: quedan auditados y el equipo los ve en los avisos y en Inventario (con sustitutos).
      </p>

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
                    disabled={busy}
                    onClick={() => setOpenId(open ? "" : item.id)}
                  >
                    {link ? "Cambiar" : "Vincular"}
                  </AdminButton>
                  {link ? (
                    <AdminButton
                      icon="close"
                      title={`Quitar el vínculo de «${item.name}»`}
                      aria-label={`Quitar el vínculo de «${item.name}»`}
                      disabled={busy}
                      onClick={() => void save(item, null)}
                    />
                  ) : null}
                </span>
              </div>
              {open ? (
                <InventoryLinkPicker
                  label={`Artículo de inventario para «${item.name}»`}
                  hint={
                    range
                      ? `Disponibilidad calculada entre ${eventRangeLabel(range)}.`
                      : "Sin fechas del evento: se muestra la disponibilidad de hoy."
                  }
                  range={range}
                  selected={link}
                  disabled={busy}
                  onSelect={(next) => void save(item, next)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton variant="primary" icon="check" onClick={onClose} busy={Boolean(busyId)}>
          Listo
        </AdminButton>
      </div>
    </AdminDialog>
  );
}

export function PresupuestosModule() {
  const { role } = useAdminSession();
  const budgetsResource = useAdminResource("/api/admin/budgets", (payload) => ({
    budgets: payload.budgets ?? [],
    requests: payload.budgetRequests ?? [],
  }));

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createItems, setCreateItems] = useState<BudgetItemDraft[]>([]);
  const [eventName, setEventName] = useState("");
  const [eventEdit, setEventEdit] = useState<AdminBudgetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // Catálogos del alta de presupuesto (issue #59): cliente y evento solo se usan
  // en ese formulario, así que se piden al abrirlo y no en el primer render (la
  // lista ya trae cliente y evento de cada presupuesto).
  // El cliente llega con los campos mínimos del selector (issue #62). El evento
  // se pide completo a propósito: el rango de disponibilidad del issue #18
  // (setupAt/strikeAt/endsAt) todavía no viaja en el selector; si OPS lo agrega,
  // el alta puede recortar la respuesta sin tocar nada más.
  const clients = useAdminResource(
    "/api/admin/clients?fields=selector",
    (payload) => (payload as { clients?: AdminClientOption[] }).clients ?? [],
    { enabled: showForm },
  );
  const events = useAdminResource("/api/admin/events", (payload) => payload.events ?? [], { enabled: showForm });
  const [notice, setNotice] = useState("");
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

  // Autogestión (issue #14): solicitudes, plan de pagos y datos de pago.
  const [resolution, setResolution] = useState<{ request: AdminBudgetRequestRow; decision: RequestDecision } | null>(null);
  /** Conversación comparativa de una solicitud del portal (issue #143). */
  const [talkRequest, setTalkRequest] = useState<AdminBudgetRequestRow | null>(null);
  const [counterItems, setCounterItems] = useState<Record<string, { quantity: number; days: number; excluded?: boolean }>>({});
  const [counterDiscount, setCounterDiscount] = useState("");
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [plan, setPlan] = useState<{ budget: AdminBudgetRow; advance: string; terms: string; installments: BudgetConditionDraft[] } | null>(null);

  // Vínculo con inventario y reserva automática (issue #18).
  const [linksBudget, setLinksBudget] = useState<AdminBudgetRow | null>(null);
  // Cronología real del presupuesto (issue #33).
  const [timelineBudget, setTimelineBudget] = useState<AdminBudgetRow | null>(null);
  // Portal de firma del cliente (issue #79): solicitudes y auditoría del presupuesto.
  const [signatureBudget, setSignatureBudget] = useState<AdminBudgetRow | null>(null);
  const [reservationReport, setReservationReport] = useState<{ title: string; reservation: AdminBudgetReservation } | null>(null);
  // Comprobantes de pago (issue #17): metadatos por presupuesto y visor.
  const [proofsByBudget, setProofsByBudget] = useState<Record<string, AdminBudgetPaymentProofRow[]>>({});
  const [proofDialog, setProofDialog] = useState<AdminBudgetRow | null>(null);

  // Envío del presupuesto por correo (issue #30): destinatario editable y mensaje corto.
  const [sendBudget, setSendBudget] = useState<AdminBudgetRow | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  /** Envío por WhatsApp con plantilla (issue #35) para el cliente del presupuesto. */
  const [templateTarget, setTemplateTarget] = useState<MessageTemplateTarget | null>(null);

  const writable = canWriteFinance(role);
  // Altas rápidas del formulario (issue #88): mismas capacidades del API
  // (`clients.write` para el cliente y `events.write` para el evento).
  const canCreateClient = canWriteClients(role);
  const canCreateEvent = canWriteOperations(role);
  const canManagePayments = role === "OWNER" || role === "ADMIN";
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  const eventOptions = useMemo(() => events.data ?? [], [events.data]);
  const portalToken = portalBudget?.publicToken ?? null;

  // Opciones del combobox (issue #88): cliente con empresa/nombre y evento con
  // fechas + cliente, sobre los catálogos que ya carga el alta.
  const clientChoices = useMemo<ComboboxOption[]>(
    () =>
      clientOptions.map((client) => {
        const company = client.company?.trim() || "";
        const label = clientDisplayName(client);
        const details = [
          company && company !== client.name ? client.name : null,
          client.type === "RESELLER" ? "Mayorista / revendedor" : null,
        ].filter(Boolean);
        return { value: client.id, label, description: details.join(" · ") || undefined };
      }),
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

  const budgetRows = useMemo(() => budgetsResource.data?.budgets ?? [], [budgetsResource.data]);
  const requestRows = useMemo(() => budgetsResource.data?.requests ?? [], [budgetsResource.data]);
  const pendingRequests = useMemo(() => requestRows.filter((request) => request.status === "pending"), [requestRows]);

  const rows = useMemo(() => {
    return budgetRows
      .filter((budget) => (status === "ALL" ? true : budget.status === status))
      .filter((budget) => matchesQuery(query, [budget.title, budget.client.company, budget.client.name, budget.event?.name]))
      .sort(compareBudgetUrgency);
  }, [budgetRows, query, status]);

  /** Conteo por estado para las pestañas/filtros de estado (issue #143). */
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const budget of budgetRows) counts.set(budget.status, (counts.get(budget.status) ?? 0) + 1);
    return counts;
  }, [budgetRows]);

  // Tablero (issue #26): el estado vive en las columnas, así que la búsqueda se
  // aplica sin el filtro de estado y el orden por urgencia fija cada columna.
  // Con un estado elegido (filtros encima del Kanban, issue #143) solo esa
  // columna conserva tarjetas.
  const searched = useMemo(
    () =>
      budgetRows
        .filter((budget) => matchesQuery(query, [budget.title, budget.client.company, budget.client.name, budget.event?.name]))
        .sort(compareBudgetUrgency),
    [budgetRows, query],
  );
  const boardRows = useMemo(
    () => (status === "ALL" ? searched : searched.filter((budget) => budget.status === status)),
    [searched, status],
  );

  const moveBudget = useCallback(async (budget: AdminBudgetRow, nextStatus: string) => {
    setBoardError("");
    const result = await adminSend("/api/admin/budgets", { budgetId: budget.id, status: nextStatus }, "PATCH");
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }, []);
  const board = useAdminBoardMove({ rows: boardRows, move: moveBudget, onError: setBoardError });

  const boardCards = useMemo<AdminBoardCardData[]>(
    () =>
      board.rows.map((budget) => {
        const paid = collectedAmount(budget.payments);
        const balance = budget.total - paid;
        const approvalState = budgetApprovalState(budget);
        const next = budgetNextStep(budget);
        return {
          id: budget.id,
          status: budget.status,
          title: budget.title,
          subtitle: [clientDisplayName(budget.client), budget.event?.name ?? null].filter(Boolean).join(" · "),
          amount: budget.total,
          amountNote: balance > 0 ? `saldo ${formatMoney(balance)}` : "cobrado",
          date: budget.validUntil,
          dateTitle: `Validez de la oferta: ${budget.title}`,
          badges: [
            {
              label: budgetApprovalLabel(approvalState),
              tone: budgetApprovalTone(approvalState),
              title: portalSummary(budget),
            },
            { label: next.label, tone: "neutral", title: next.hint },
          ],
          detail: `${next.label} · ${formatNumber(budget.items.length)} ítem${budget.items.length === 1 ? "" : "s"} · cobrado ${formatMoney(paid)}`,
          actions: (
            <>
              {writable ? (
                <AdminButton
                  icon="mail"
                  title={`Enviar por correo: ${budget.title} · ${budget.client.email || "el cliente no tiene correo cargado"}`}
                  aria-label={`Enviar por correo: ${budget.title}`}
                  onClick={() => openSend(budget)}
                />
              ) : null}
              <AdminActionsMenu label={`Acciones del presupuesto ${budget.title}`} items={budgetMenuItems(budget)} />
            </>
          ),
        };
      }),
    [board.rows, writable],
  );

  /**
   * Acciones unificadas del presupuesto (issue #143): impresión, firma y portal
   * viven en un solo menú «⋯» para no llenar la fila/tarjeta de íconos.
   */
  function budgetMenuItems(budget: AdminBudgetRow): AdminMenuItem[] {
    return [
      ...(writable ? [
        ...(budget.event && canCreateEvent ? [{ label: "Editar nombre del evento compartido", icon: "edit" as const, onClick: () => { setEventEdit(budget); setEventName(budget.event!.name); setDialogError(""); } }] : []),
        { label: "Editar ítems, precio y documentos", icon: "edit" as const, onClick: () => setPricing(budget) },
        { label: "Plan de pagos", icon: "clock" as const, onClick: () => openPlan(budget) },
        { label: "Inventario", icon: "inventory" as const, onClick: () => setLinksBudget(budget) },
        ...(!budget.approvedAt && budgetInPlay(budget) ? [{ label: "Aprobar manualmente", icon: "check" as const, onClick: () => openApproval(budget, "approve") }, { label: "Pedir cambios", icon: "alert" as const, onClick: () => openApproval(budget, "request_revision") }] : []),
      ] : []),
      { label: "Cronología", icon: "audit", onClick: () => setTimelineBudget(budget) },
      {
        label: "Imprimir",
        icon: "print",
        href: `/imprimir/presupuesto/${budget.id}`,
        external: true,
        title: `Imprimir presupuesto: ${budget.title}`,
      },
      {
        label: "Firma del cliente",
        icon: "pen",
        onClick: () => setSignatureBudget(budget),
        title: `Firma del cliente: ${budget.title}`,
      },
      {
        label: budget.publicToken ? "Portal del cliente" : "Generar link del portal",
        icon: "globe",
        onClick: () => openPortal(budget),
        title: `${budget.publicToken ? "QR y link del portal" : "Generar link del portal"}: ${budget.title}`,
      },
      ...(budget.publicToken
        ? [
            {
              label: "Ver como cliente",
              icon: "eye" as const,
              href: portalBudgetUrl(budget.publicToken),
              external: true,
            },
            {
              label: "Copiar enlace del cliente",
              icon: "copy" as const,
              onClick: () => void copyPortalLink(budget),
              title: `Copiar el link del portal: ${budget.title}`,
            },
          ]
        : writable ? [{ label: "Copiar enlace del cliente", icon: "copy" as const, onClick: () => void issueClientLink(budget, "copy") }, { label: "Ver como cliente", icon: "eye" as const, onClick: () => void issueClientLink(budget, "view") }] : []),
    ];
  }

  /** Tarjetas del ancho compacto (issue #143): monto, vencimiento, cliente y próximo paso. */
  const budgetCards = useMemo<AdminCardData[]>(
    () =>
      rows.map((budget) => {
        const paid = collectedAmount(budget.payments);
        const balance = budget.total - paid;
        const approvalState = budgetApprovalState(budget);
        const next = budgetNextStep(budget);
        return {
          id: budget.id,
          title: budget.title,
          titleTooltip: `${budget.title}${budget.event ? ` · ${budget.event.name}` : ""}`,
          subtitle: [clientDisplayName(budget.client), budget.event?.name ?? null].filter(Boolean).join(" · "),
          badges: [
            { label: budgetStatusLabel(budget.status), tone: statusTone(budget.status) },
            { label: budgetApprovalLabel(approvalState), tone: budgetApprovalTone(approvalState), title: portalSummary(budget) },
            { label: next.label, tone: "neutral", title: next.hint },
          ],
          fields: [
            { label: "Total", value: <strong>{formatMoney(budget.total)}</strong>, title: formatMoney(budget.total) },
            {
              label: "Vence",
              value: budget.validUntil ? (
                <>
                  <span className="admin-nowrap">{formatDateShort(budget.validUntil)}</span>{" "}
                  <AdminCountdown
                    value={budget.validUntil}
                    className="admin-countdown--inline"
                    title={`Validez de la oferta: ${budget.title}`}
                  />
                </>
              ) : (
                "—"
              ),
              title: budget.validUntil ? `Vence el ${formatDate(budget.validUntil)}` : "Sin vencimiento",
            },
            {
              label: "Saldo",
              value: formatMoney(balance),
              title: `Total ${formatMoney(budget.total)} · cobrado ${formatMoney(paid)}`,
            },
            {
              label: "Ítems",
              value: formatNumber(budget.items.length),
              title: `${formatNumber(budget.items.length)} ítem${budget.items.length === 1 ? "" : "s"}`,
            },
          ],
          footer: (
            <span className="admin-actions">
              {writable ? (
                <AdminButton
                  icon="mail"
                  title={`Enviar por correo: ${budget.title} · ${budget.client.email || "el cliente no tiene correo cargado"}`}
                  aria-label={`Enviar por correo: ${budget.title}`}
                  onClick={() => openSend(budget)}
                />
              ) : null}
              <AdminActionsMenu label={`Acciones del presupuesto ${budget.title}`} items={budgetMenuItems(budget)} />
            </span>
          ),
        };
      }),
    [rows, writable],
  );

  // KPIs del módulo (spec 22-09-2026): vigentes, por vencer en 7 días, los
  // aprobados del mes y el monto que sigue en juego. El detalle por presupuesto
  // (cobrado, saldo, margen) vive en las columnas de la lista y en Finanzas.
  const kpis = useMemo(() => {
    const inPlay = budgetRows.filter(budgetInPlay);
    const expiring = inPlay.filter((budget) => {
      const days = daysUntilDue(budget.validUntil);
      return days !== null && days >= 0 && days <= 7;
    });
    const month = currentMonthKey();
    const approvedThisMonth = budgetRows.filter(
      (budget) => budget.approvedAt && monthOf(new Date(budget.approvedAt)) === month,
    );
    return {
      inPlay: inPlay.length,
      expiring: expiring.length,
      approvedThisMonth: approvedThisMonth.length,
      amount: inPlay.reduce((sum, budget) => sum + budget.total, 0),
      monthLabel: monthKeyLabel(month),
    };
  }, [budgetRows]);

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
    if (!form.clientId) {
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
      clientId: form.clientId,
      eventId: form.eventId || undefined,
      title: form.title,
      items: createItems.map((item) => ({ name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice), inventoryId: item.inventory?.id, notes: item.notes })),
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setForm(EMPTY_FORM);
    setCreateItems([]);
    setNotice(`Presupuesto «${form.title}» creado como borrador. Podés abrir vista previa o enviarlo desde sus acciones.`);
    budgetsResource.reload();
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
    setSendTo(normalizeEmail(budget.client.email ?? ""));
    setSendMessage("");
    setSendError("");
    setSendBudget(budget);
  }

  /** Genera el link del portal desde el diálogo de envío (sin link no hay correo). */
  async function generateLinkForSend() {
    if (!sendBudget) return;
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

  /** Envía el presupuesto y muestra el resultado real del proveedor. */
  async function sendBudgetMail() {
    if (!sendBudget) return;
    const to = normalizeEmail(sendTo);
    if (!emailValid(to)) {
      setSendError(FIELD_MESSAGES.email);
      return;
    }
    setSendBusy(true);
    setSendError("");
    const result = await adminSend<{ status: string; error: string | null; to: string }>("/api/admin/budgets/send", {
      budgetId: sendBudget.id,
      to,
      message: sendMessage.trim() || undefined,
    });
    setSendBusy(false);
    if (!result.ok) {
      setSendError(result.error);
      return;
    }
    if (result.data.status === "sent") {
      setNotice(`Enviamos el presupuesto «${sendBudget.title}» a ${result.data.to}.`);
      setSendBudget(null);
      budgetsResource.reload();
      return;
    }
    setSendError(result.data.error ?? "El proveedor rechazó el envío.");
  }

  async function submitApproval() {
    if (!approval) return;
    if (approval.decision === "request_revision" && !note.trim()) {
      setDialogError("Indicá qué cambios se piden.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/approval", {
      budgetId: approval.budget.id,
      decision: approval.decision,
      note: note.trim() || undefined,
    });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
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
      <AdminModuleContext
        breadcrumb="Ventas / Presupuestos"
        hint="Vigencia, margen, portal del cliente y próximos pasos comerciales."
        meta={`${formatNumber(rows.length)} visibles`}
      />
      <section className="admin-kpis" aria-label="Indicadores de presupuestos">
        <AdminKpi
          label="Vigentes" icon="budgets"
          value={formatNumber(kpis.inPlay)}
          note="ni perdidos ni cancelados"
          tone={kpis.inPlay > 0 ? "accent" : undefined}
        />
        <AdminKpi
          label="Por vencer (7 días)" icon="clock"
          value={formatNumber(kpis.expiring)}
          note="validez que termina esta semana"
          tone={kpis.expiring > 0 ? "warn" : undefined}
        />
        <AdminKpi
          label="Aprobados del mes" icon="check"
          value={formatNumber(kpis.approvedThisMonth)}
          note={kpis.monthLabel}
          tone={kpis.approvedThisMonth > 0 ? "ok" : undefined}
        />
        <AdminKpi label="Monto en juego" icon="finance" value={formatMoney(kpis.amount)} note="Σ de los vigentes" />
      </section>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar presupuestos"
          placeholder="Buscar por título, cliente o evento…"
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
        {writable ? (
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
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {boardError ? <AdminNote tone="error">{boardError}</AdminNote> : null}

      {writable && showForm ? (
        <form className="admin-form-panel" onSubmit={submit} aria-busy={busy}>
          <h2 className="admin-form-title">Nuevo presupuesto</h2>
          <div className="admin-form-grid">
          <Combobox
            label="Cliente"
            required
            value={form.clientId}
            onChange={(value) => setForm({ ...form, clientId: value })}
            options={clientChoices}
            placeholder="Buscá por nombre o empresa…"
            emptyLabel={
              clients.loading
                ? "Cargando clientes…"
                : clients.error
                  ? "No pudimos cargar los clientes."
                  : "No hay clientes cargados."
            }
            hint={canCreateClient ? "Escribí para buscar; si no está, creálo desde el listado." : undefined}
            onCreate={canCreateClient ? (name) => setNewClientName(name) : undefined}
            createLabel={(query) => (query ? `Crear cliente «${query}»` : "Crear cliente")}
          />
          <Combobox
            label="Evento"
            hint={canCreateEvent ? "Opcional · se puede crear desde el listado" : "Opcional"}
            value={form.eventId}
            onChange={(value) => setForm({ ...form, eventId: value })}
            options={eventChoices}
            placeholder="Buscá por nombre o dejalo vacío…"
            emptyLabel={events.loading ? "Cargando eventos…" : "No hay eventos cargados."}
            onCreate={canCreateEvent ? (name) => setNewEventName(name) : undefined}
            createLabel={(query) => (query ? `Crear evento «${query}»` : "Crear evento")}
          />
          <TextField
            label="Título"
            wide
            required
            maxLength={160}
            value={form.title}
            onChange={(value) => setForm({ ...form, title: value })}
            placeholder="Ej.: Alquiler pantalla LED 6×3"
          />
          </div>
          <BudgetItemsEditor items={createItems} onChange={setCreateItems} disabled={busy} range={formRange} />
          {formError ? <AdminNote tone="error">{formError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <AdminButton type="button" disabled={busy} onClick={() => setShowForm(false)}>Cancelar</AdminButton>
            <AdminButton type="submit" variant="primary" busy={busy} disabled={!form.clientId || !form.title.trim() || !createItems.length || createItems.some((item) => !item.unitPrice || !item.quantity || !item.days || budgetItemError({ name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice) })) || !budgetMoneyValid(budgetDraftSubtotal(createItems))}>Guardar borrador</AdminButton>
          </div>
        </form>
      ) : null}

      {requestRows.length > 0 ? (
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

      {/* Filtros/pestañas de estado (issue #143): encima del tablero y de la
          lista; en ancho compacto son las pestañas que reemplazan al Kanban. */}
      <nav className="admin-subtabs" aria-label="Filtrar presupuestos por estado">
        <button
          type="button"
          className="admin-subtab"
          data-active={status === "ALL" ? "true" : undefined}
          aria-pressed={status === "ALL"}
          onClick={() => setStatus("ALL")}
        >
          Todos
          <span className="admin-subtab-count">{formatNumber(budgetRows.length)}</span>
        </button>
        {STATUS_OPTIONS.slice(1).map((option) => (
          <button
            key={option.value}
            type="button"
            className="admin-subtab"
            data-active={status === option.value ? "true" : undefined}
            aria-pressed={status === option.value}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
            <span className="admin-subtab-count">{formatNumber(statusCounts.get(option.value) ?? 0)}</span>
          </button>
        ))}
      </nav>

      <AdminDataState
        loading={budgetsResource.loading}
        error={budgetsResource.error}
        onRetry={budgetsResource.reload}
        empty={budgetRows.length === 0}
        emptyTitle="Todavía no hay presupuestos" emptyIcon="budgets"
        emptyHint="Creá un presupuesto para seguir venta, costos, margen y cobros."
        emptyAction={writable ? <button type="button" className="admin-empty-link" onClick={() => { setFormError(""); setShowForm(true); }}>Crear presupuesto →</button> : undefined}
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
              { label: "Presupuesto" },
              { label: "Cliente" },
              { label: "Total", end: true },
              { label: "Vence" },
              { label: "Estado / próximo paso" },
              { label: "Ítems", end: true },
              { label: "Cobrado", end: true },
              { label: "Saldo", end: true },
              { label: "Margen", end: true },
              { label: "Portal" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((budget) => {
              const paid = collectedAmount(budget.payments);
              const balance = budget.total - paid;
              // Margen sobre el costo interno completo (issue #65): materiales +
              // mano de obra + costo de los ítems, no solo el estimado por ítem.
              const internalCost = internalCostOf({
                materialCost: budget.materialCost ?? 0,
                laborCost: budget.laborCost ?? 0,
                items: budget.items,
              });
              const margin = budget.total - internalCost.total;
              const approvalState = budgetApprovalState(budget);
              const approved = approvalState === "APROBADO_DIGITAL" || approvalState === "APROBADO_MANUAL";
              const open = budget.status !== "LOST" && budget.status !== "CANCELLED";
              const linked = budget.items.filter((item) => item.inventoryId);
              const linkedCount = linked.length;
              const linkedNames = linked
                .map((item) => `${item.name} → ${item.inventory?.name ?? "inventario eliminado"}`)
                .join(", ");
              const budgetProofs = proofsByBudget[budget.id] ?? [];
              const proofLabel = `${formatNumber(budgetProofs.length)} comprobante${budgetProofs.length === 1 ? "" : "s"} del portal`;
              const next = budgetNextStep(budget);
              return (
                <AdminRow key={budget.id}>
                  <AdminCell title={`${budget.title}${budget.event ? ` · ${budget.event.name}` : ""}`}>
                    <strong className="admin-quote-title">{budget.title}</strong>
                    {budget.event ? <small className="admin-cell-sub"> · {budget.event.name}</small> : null}
                  </AdminCell>
                  <AdminCell title={clientDisplayName(budget.client)}>{clientDisplayName(budget.client)}</AdminCell>
                  <AdminCell end title={formatMoney(budget.total)}>
                    {formatMoney(budget.total)}
                  </AdminCell>
                  <AdminCell title={budget.validUntil ? `Vence el ${formatDateShort(budget.validUntil)}` : "Sin vencimiento"}>
                    <span className="admin-nowrap">{budget.validUntil ? formatDateShort(budget.validUntil) : "—"}</span>
                    <AdminCountdown
                      value={budget.validUntil}
                      className="admin-countdown--inline"
                      title={`Validez de la oferta: ${budget.title}`}
                    />
                  </AdminCell>
                  <AdminCell title={`${budgetStatusLabel(budget.status)} · Próximo paso: ${next.label} — ${next.hint}`}>
                    <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge>
                    <small className="admin-cell-sub" title={next.hint}> · {next.label}</small>
                  </AdminCell>
                  <AdminCell
                    end
                    title={`${budget.items.length} ítem${budget.items.length === 1 ? "" : "s"}${
                      linkedCount > 0
                        ? ` · vinculados al inventario: ${linkedNames}`
                        : " · ninguno vinculado al inventario (no reservan stock)"
                    }`}
                  >
                    {formatNumber(budget.items.length)}
                    {linkedCount > 0 ? <small className="admin-cell-sub"> · {formatNumber(linkedCount)} vinc.</small> : null}
                  </AdminCell>
                  <AdminCell end title={formatMoney(paid)}>
                    {formatMoney(paid)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(balance)}>
                    <strong>{formatMoney(balance)}</strong>
                  </AdminCell>
                  <AdminCell end title={`${formatMoney(margin)} de margen sobre un costo interno de ${formatMoney(internalCost.total)} (materiales ${formatMoney(internalCost.materials)} · mano de obra ${formatMoney(internalCost.labor)} · ítems ${formatMoney(internalCost.items)})`}>
                    {formatMoney(margin)}
                  </AdminCell>
                  <AdminCell title={portalSummary(budget)}>
                    <AdminBadge tone={budgetApprovalTone(approvalState)}>{budgetApprovalLabel(approvalState)}</AdminBadge>
                    <small className="admin-cell-sub">
                      {" "}· {budget.publicToken ? "Link activo" : "Sin link"}
                      {budgetProofs.length > 0 ? ` · ${proofLabel}` : ""}
                    </small>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      {writable ? <AdminButton icon="mail" title={`Enviar por correo: ${budget.title}`} aria-label={`Enviar por correo: ${budget.title}`} onClick={() => openSend(budget)} /> : null}
                      {writable ? <AdminButton icon="edit" title={`Editar presupuesto: ${budget.title}`} aria-label={`Editar presupuesto: ${budget.title}`} onClick={() => setPricing(budget)} /> : null}
                      <AdminActionsMenu label={`Acciones del presupuesto ${budget.title}`} items={budgetMenuItems(budget)} />
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {portalBudget ? (
        <AdminDialog title={`Portal del cliente · ${portalBudget.title}`} icon="globe" onClose={() => setPortalBudget(null)}>
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
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            {portalToken ? (
              <>
                <AdminButton
                  icon="download"
                  title="Copiar el link del portal"
                  aria-label="Copiar el link del portal"
                  onClick={() => void copyPortalLink(portalBudget)}
                >Copiar enlace del cliente</AdminButton>
                <AdminButton
                  icon="external"
                  title="Abrir el portal en una pestaña nueva"
                  aria-label="Abrir el portal en una pestaña nueva"
                  onClick={() => window.open(portalBudgetUrl(portalToken), "_blank", "noopener,noreferrer")}
                >Ver como cliente</AdminButton>
              </>
            ) : null}
            <span className="admin-dialog-spacer" />
            {portalToken ? (
              <AdminButton icon="power" onClick={() => void submitPortalAction("revoke")} disabled={dialogBusy}>
                Revocar link
              </AdminButton>
            ) : null}
            <AdminButton variant="primary" icon="refresh" busy={dialogBusy} onClick={() => void submitPortalAction("generate")}>
              {portalToken ? "Regenerar link" : "Generar link"}
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {sendBudget ? (
        <AdminDialog title={`Enviar por correo · ${sendBudget.title}`} icon="mail" onClose={() => setSendBudget(null)}>
          <p className="admin-dialog-text">
            El correo sale con la identidad de LedBox: link del portal con el código, resumen de ítems, total y validez,
            la hoja imprimible y los datos de pago cuando el presupuesto está aprobado.
          </p>
          <dl className="admin-dialog-facts">
            <div>
              <dt>Cliente</dt>
              <dd>{clientDisplayName(sendBudget.client)}</dd>
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

          {!sendBudget.publicToken ? (
            <AdminNote tone="error">
              Este presupuesto todavía no tiene link del portal: generá el link para que el correo lleve el código y el
              destino de aprobación.
            </AdminNote>
          ) : null}
          {!emailValid(sendBudget.client.email ?? "") ? (
            <AdminNote tone="error">
              El cliente no tiene un correo válido cargado en su ficha: cargalo en Clientes o escribí otro destinatario acá.
            </AdminNote>
          ) : null}

          <EmailField
            label="Destinatario"
            required
            value={sendTo}
            onChange={(value) => {
              setSendTo(value);
              setSendError("");
            }}
            disabled={sendBusy}
            error={!emailValid(sendTo) ? (sendTo.trim() ? FIELD_MESSAGES.email : FIELD_MESSAGES.required) : undefined}
            hint="Podés cambiarlo: el correo se envía solo a esta dirección."
          />
          <TextAreaField
            label="Mensaje corto (opcional)"
            wide
            value={sendMessage}
            onChange={(value) => {
              setSendMessage(value);
              setSendError("");
            }}
            maxLength={600}
            rows={3}
            placeholder="Ej.: cualquier duda me escribís; en el portal está el detalle completo."
          />

          {sendError ? <AdminNote tone="error">{sendError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            {!sendBudget.publicToken ? (
              <AdminButton icon="refresh" busy={linkBusy} disabled={sendBusy} onClick={() => void generateLinkForSend()}>
                Generar link del portal
              </AdminButton>
            ) : null}
            <span className="admin-dialog-spacer" />
            <AdminButton icon="close" onClick={() => setSendBudget(null)} disabled={sendBusy}>
              Cancelar
            </AdminButton>
            <AdminButton
              variant="primary"
              icon="mail"
              busy={sendBusy}
              disabled={!sendBudget.publicToken || !emailValid(sendTo) || linkBusy}
              onClick={() => void sendBudgetMail()}
            >
              Enviar presupuesto
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {approval ? (
        <AdminDialog
          title={approval.decision === "approve" ? `Aprobar manualmente · ${approval.budget.title}` : `Pedir cambios · ${approval.budget.title}`}
          icon={approval.decision === "approve" ? "check" : "edit"}
          onClose={() => setApproval(null)}
        >
          <p className="admin-dialog-text">
            {approval.decision === "approve"
              ? `Se registra la aprobación a nombre de ${clientDisplayName(approval.budget.client)}, con tu usuario y la fecha actual. Si ya hay una aprobación registrada, no se pisa.`
              : "El cliente no ve el cambio hasta que le compartas la versión actualizada; queda registrado en el presupuesto."}
          </p>
          <TextAreaField
            label={approval.decision === "approve" ? "Nota (opcional)" : "¿Qué cambios se piden?"}
            wide
            value={note}
            onChange={setNote}
            maxLength={1000}
            rows={4}
            required={approval.decision === "request_revision"}
            placeholder={approval.decision === "approve" ? "Ej.: aprobado por teléfono, coordina con Santiago" : "Ej.: sumar un día más y cambiar el lugar"}
          />
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <AdminButton icon="close" onClick={() => setApproval(null)} disabled={dialogBusy}>
              Cancelar
            </AdminButton>
            <AdminButton variant="primary" icon="check" busy={dialogBusy} onClick={() => void submitApproval()}>
              {approval.decision === "approve" ? "Registrar aprobación" : "Registrar pedido"}
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {talkRequest ? (
        <AdminDialog
          title={`Conversación · ${talkRequest.budget.title}`}
          size="wide"
          icon="globe"
          onClose={() => setTalkRequest(null)}
        >
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
          <div className="admin-dialog-foot">
            <AdminButton icon="close" onClick={() => setTalkRequest(null)}>
              Cerrar
            </AdminButton>
            {writable && talkRequest.status === "pending" ? (
              <>
                <AdminButton
                  icon="close"
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
                  onClick={() => {
                    openResolution(talkRequest, "accept");
                    setTalkRequest(null);
                  }}
                >
                  Aceptar y aplicar
                </AdminButton>
              </>
            ) : null}
          </div>
        </AdminDialog>
      ) : null}

      {resolution ? (
        <AdminDialog title={resolutionLabel} size="wide" icon="edit" onClose={() => setResolution(null)}>
          <p className="admin-dialog-text">
            {resolution.request.kind === "items"
              ? "La propuesta del cliente se aplica al presupuesto con los precios unitarios originales. Podés ajustar las cantidades y días como contra-oferta antes de aceptar."
              : resolution.request.kind === "discount"
                ? "Al aceptar, el descuento se aplica al presupuesto y el total se recalcula. Podés contra-ofertar con otro monto."
                : "El pedido de cambios queda resuelto: el cliente lo ve respondido en su portal y el presupuesto deja de mostrarse como «cambios solicitados»."}
          </p>
          <dl className="admin-dialog-facts">
            <div>
              <dt>Cliente</dt>
              <dd>{clientDisplayName(resolution.request.budget.client)}</dd>
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
                      <label><input type="checkbox" checked={Boolean(proposed.excluded)} onChange={(event) => setCounterItems((rows) => ({ ...rows, [item.id]: counterofferExclusion(item, proposed, event.target.checked) }))} /> Retirado / no incluido</label>
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
          ) : null}

          {resolution.decision === "accept" && resolution.request.kind === "discount" ? (
            <div className="admin-plan-grid">
              <MoneyField
                label="Descuento final (Gs)"
                hint="Podés aceptar el pedido o contra-ofertar con otro monto"
                value={counterDiscount}
                onChange={setCounterDiscount}
              />
            </div>
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
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <AdminButton icon="close" onClick={() => setResolution(null)} disabled={dialogBusy}>
              Cancelar
            </AdminButton>
            <AdminButton
              variant={resolution.decision === "accept" ? "primary" : undefined}
              icon={resolution.decision === "accept" ? "check" : "close"}
              busy={dialogBusy}
              onClick={() => void submitResolution()}
            >
              {resolution.decision === "accept" ? "Aceptar y aplicar" : "Rechazar con nota"}
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {eventEdit?.event ? <AdminDialog title="Nombre del evento compartido" onClose={() => setEventEdit(null)}>
        <AdminNote>Este nombre pertenece al evento y cambia en todos los presupuestos asociados. El título de cada presupuesto se conserva. Las versiones aceptadas o firmadas bloquean el cambio.</AdminNote>
        <TextField label="Nombre del evento" required maxLength={160} value={eventName} onChange={setEventName} disabled={dialogBusy} />
        {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
        <div className="admin-dialog-foot"><AdminButton onClick={() => setEventEdit(null)} disabled={dialogBusy}>Cancelar</AdminButton><AdminButton variant="primary" busy={dialogBusy} disabled={!eventName.trim() || eventName.trim() === eventEdit.event.name} onClick={async () => {
          setDialogBusy(true); setDialogError("");
          const result = await adminSend(`/api/admin/budgets/${eventEdit.id}/event`, { name: eventName, originalName: eventEdit.event!.name }, "PATCH");
          setDialogBusy(false);
          if (!result.ok) { setDialogError(result.error); return; }
          setNotice(`Evento renombrado a «${eventName.trim()}» en todos sus presupuestos.`); setEventEdit(null); budgetsResource.reload(); events.reload();
        }}>Guardar nombre</AdminButton></div>
      </AdminDialog> : null}
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
        <AdminDialog title={`Plan de pagos · ${plan.budget.title}`} size="wide" icon="finance" onClose={() => setPlan(null)}>
          <p className="admin-dialog-text">
            El anticipo y las cuotas se muestran en el portal cuando el presupuesto está aprobado: el primero (o la primera
            cuota) aparece como «a transferir ahora». El plan no puede superar el total ({formatMoney(plan.budget.total)}).
          </p>
          <div className="admin-plan-grid">
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
          </div>
          <BudgetPaymentPlanEditor total={plan.budget.total} advance={Number(plan.advance) || 0} rows={plan.installments} onChange={(installments) => setPlan({ ...plan, installments })} disabled={dialogBusy || Boolean(plan.budget.approvedAt)} />
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <span className="admin-dialog-spacer" />
            <AdminButton icon="close" onClick={() => setPlan(null)} disabled={dialogBusy}>
              Cancelar
            </AdminButton>
            <AdminButton variant="primary" icon="check" busy={dialogBusy} disabled={Boolean(plan.budget.approvedAt) || !resolveBudgetPaymentPlan(conditionPayload(plan.installments), plan.budget.total, Number(plan.advance) || 0).ok} onClick={() => void submitPlan()}>
              Guardar plan
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {paymentsOpen ? <PaymentDetailsDialog onClose={() => setPaymentsOpen(false)} /> : null}

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
