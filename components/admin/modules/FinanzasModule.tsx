"use client";

import { FIELD_LIMITS } from "@/lib/field-rules";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  countdownTone,
  DATE_PERIODS,
  datePeriodLabel,
  datePeriodQuery,
  expenseCategoryLabel,
  expectedPaymentConcept,
  expectedPaymentStatusLabel,
  expectedPaymentStatusTone,
  formatCountdown,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  isTodayAsuncion,
  jobStatusLabel,
  paymentStatusLabel,
  paymentStatusTone,
  reminderChannelLabel,
  reminderStatusLabel,
  reminderStatusTone,
  statusTone,
  todayDayKey,
  treasuryAccountTypeLabel,
  treasuryAccountTypeTone,
  treasuryDirectionLabel,
  treasuryDirectionTone,
  treasuryOriginLabel,
  whatsappReachable,
} from "@/lib/admin-format";
import { csvDay, csvFilename, csvStamp, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import { bankMark, bankSuggestions } from "@/lib/bank-mark";
import { BankLogo } from "../BankLogo";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import { AGING_LABELS, parseAgingParam } from "@/lib/resumen-board";
import { validateFinanceSplitAmounts } from "@/lib/finance-split-validation";
import {
  accountsForPaymentMethod,
  COLLECTED_PAYMENT_METHODS,
  receivedAmount,
  EXPENSE_CATEGORIES,
  expectedPaymentNeedsAction,
  groupProofsByBudget,
  PAYMENT_METHODS,
  PENDING_PAYMENT_METHOD,
  supplierJobBalance,
  TERM_PAYMENT_METHODS,
  TREASURY_ACCOUNT_TYPES,
  type AdminBudgetPaymentProofRow,
  type AdminExpectedPaymentRow,
  type AdminExpectedPaymentSummary,
  type AdminExpenseRow,
  type AdminFinancePaymentPage,
  type AdminIconName,
  type AdminPaymentReminder,
  type AdminPaymentRow,
  type AdminReminderRun,
  type AdminSignatureReminderRun,
  type AdminSupplierJobRow,
  type AdminTreasuryAccountRow,
  type AdminTreasuryAccountRef,
  type AdminTreasuryMovementRow,
  type AdminTreasurySummary,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";
import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import { useAdminSession } from "../AdminShell";
import { AdminIcon } from "../AdminIcons";
import { AdminButtonLink,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminEmpty,
  AdminDialog,
  AdminDialogSection,
  AdminDisclosure,
  AdminKpi,
  AdminKpis,
  AdminModuleContext,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTabs,
  AdminTable,
  AdminToolbar,
  AdminWhatsappTemplateButton,
} from "../AdminUI";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import { useAdminNarrowViewport } from "../AdminBoard";
import { MessageTemplateSendDialog, type MessageTemplateTarget } from "../AdminMessageTemplateDialog";
import { AdminSimulatedMailDialog } from "../AdminSimulatedMail";
import { SIMULATED_MAIL_NOTICE, type SimulatedMail } from "@/lib/mail-preview";
import { Combobox, DateField, MoneyField, NumberField, SearchField, SelectField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { kpiState } from "@/components/admin/kpi-state";
import { adminApiGet, adminSend, newIdempotencyKey, useAdminResource } from "@/lib/admin-api";
import { BudgetProofDialog } from "./PresupuestosModule";
import { ConciliacionBancaria } from "./ConciliacionBancaria";

/** Cobro ya cobrado: métodos reales (sin «Pendiente»), issue #135. */
const METHOD_OPTIONS = [...COLLECTED_PAYMENT_METHODS];
/** A plazo (crédito): «Pendiente» primero y sin tarjeta. */
const TERM_METHOD_OPTIONS = [...TERM_PAYMENT_METHODS];
/** Plazos ofrecidos en días desde la emisión de la factura (issue #16). */
const TERM_DAY_OPTIONS = ["0", "15", "30", "60"];

const TERM_DAY_LABEL: Record<string, string> = {
  "0": "0 días (contra entrega)",
  "15": "15 días",
  "30": "30 días",
  "60": "60 días",
};

// ── Secciones de Finanzas (auditoría UX, issue #140) ────────────────────────

/**
 * Secciones de Finanzas: cada una es una ruta real (`/finanzas/...`) para poder
 * enlazarla y compartirla, con la misma barra de subtabs que Ajustes (#56). La
 * lista es la única fuente: la dibujan la barra, el resumen y las páginas.
 */
export type AdminFinanzasSection =
  | "resumen"
  | "por-confirmar"
  | "por-cobrar"
  | "proveedores"
  | "tesoreria"
  | "conciliacion"
  | "gastos";

export const FINANZAS_SECTIONS: ReadonlyArray<{
  key: AdminFinanzasSection;
  href: string;
  label: string;
  icon: AdminIconName;
  hint: string;
}> = [
  { key: "resumen", href: "/finanzas", label: "Resumen", icon: "overview", hint: "Indicadores y atajos" },
  { key: "por-confirmar", href: "/finanzas/por-confirmar", label: "Por confirmar", icon: "clock", hint: "Comprobantes en revisión y vencidos" },
  { key: "por-cobrar", href: "/finanzas/por-cobrar", label: "Por cobrar", icon: "finance", hint: "Cobros a plazo e historial" },
  { key: "proveedores", href: "/finanzas/proveedores", label: "Proveedores", icon: "suppliers", hint: "Cuentas por pagar y pagos" },
  { key: "tesoreria", href: "/finanzas/tesoreria", label: "Tesorería", icon: "wallet", hint: "Cuentas y movimientos" },
  { key: "conciliacion", href: "/finanzas/conciliacion", label: "Conciliación", icon: "bank", hint: "Conciliación bancaria" },
  { key: "gastos", href: "/finanzas/gastos", label: "Gastos", icon: "receipt", hint: "Gastos de la operación" },
];

// ── Tesorería y gastos (issue #27) ──────────────────────────────────────────

/** Períodos del filtro compartido de movimientos y gastos. */
const PERIOD_OPTIONS = DATE_PERIODS.map((period) => ({ value: period, label: datePeriodLabel(period) }));
const ACCOUNT_TYPE_OPTIONS = TREASURY_ACCOUNT_TYPES.map((type) => ({ value: type, label: treasuryAccountTypeLabel(type) }));
const CATEGORY_OPTIONS = [
  { value: "", label: "Categoría…" },
  ...EXPENSE_CATEGORIES.map((category) => ({ value: category, label: expenseCategoryLabel(category) })),
];
/** Métodos reales para el pago a proveedores y los gastos (issues #135). */
const METHOD_SELECT_OPTIONS = COLLECTED_PAYMENT_METHODS.map((method) => ({ value: method, label: method }));
const DIRECTION_OPTIONS = [
  { value: "IN", label: "Entrada" },
  { value: "OUT", label: "Salida" },
  { value: "TRANSFER", label: "Transferencia" },
];

const EMPTY_TREASURY_SUMMARY: AdminTreasurySummary = {
  cash: 0,
  bank: 0,
  cheque: 0,
  other: 0,
  total: 0,
  accounts: 0,
  activeAccounts: 0,
};

/** Totales de pagos esperados (issue #28): vacío honesto mientras carga. */
const EMPTY_EXPECTED_SUMMARY: AdminExpectedPaymentSummary = {
  awaiting: { count: 0, total: 0 },
  proof: { count: 0, total: 0 },
  partial: { count: 0, total: 0 },
  overdue: { count: 0, total: 0 },
  confirmed: { count: 0, total: 0 },
  pending: { count: 0, total: 0 },
};

/** Id del campo de monto de la carga rápida: vuelve el foco al guardar y seguir. */
const EXPENSE_AMOUNT_ID = "gasto-monto";

/** `id` del `<datalist>` con el catálogo de bancos (owncoding-ui) del campo Banco. */
const BANK_LIST_ID = "tesoreria-banco-opciones";

type AccountForm = {
  id: string;
  name: string;
  type: string;
  bank: string;
  /** Datos para transferir (issue #129): número y alias de la cuenta. */
  number: string;
  alias: string;
  openingBalance: string;
  sortOrder: string;
  active: boolean;
};

const EMPTY_ACCOUNT_FORM: AccountForm = { id: "", name: "", type: "CASH", bank: "", number: "", alias: "", openingBalance: "", sortOrder: "", active: true };

type MovementForm = {
  direction: string;
  accountId: string;
  counterAccountId: string;
  amount: string;
  date: string;
  notes: string;
};

type ExpenseForm = {
  amount: string;
  description: string;
  category: string;
  accountId: string;
  eventId: string;
  date: string;
  supplierId: string;
  method: string;
  receipt: string;
  notes: string;
};

type PayJobForm = {
  jobId: string;
  accountId: string;
  amount: string;
  date: string;
  method: string;
  receipt: string;
};

/** Banco de una cuenta: logo del catálogo de owncoding-ui (si existe) y el nombre en texto. */
function BankCell({ bank }: { bank: string | null }) {
  const mark = bankMark(bank);
  if (!mark) return <span className="admin-muted">—</span>;
  return (
    <span className="admin-treasury-bank" title={`Banco: ${mark.label}`}>
      <BankLogo bank={bank} size="h-6" />
      <span>{mark.label}</span>
    </span>
  );
}

/** Monto de un movimiento con su signo: entra (+), sale (−) o se mueve sin signo. */
function movementAmount(movement: AdminTreasuryMovementRow): string {
  const sign = movement.direction === "IN" ? "+ " : movement.direction === "OUT" ? "− " : "";
  return `${sign}${formatMoney(movement.amount)}`;
}

function movementTone(movement: AdminTreasuryMovementRow): string {
  return movement.direction === "IN" ? "in" : movement.direction === "OUT" ? "out" : "move";
}

/** Ruta real del movimiento: cuenta, o cuenta → contracuenta en una transferencia. */
function movementRoute(movement: AdminTreasuryMovementRow): string {
  return movement.counterAccount ? `${movement.account.name} → ${movement.counterAccount.name}` : movement.account.name;
}

/** Detalle del movimiento para el `title` de la fila. */
function movementTitle(movement: AdminTreasuryMovementRow): string {
  const parts = [
    `${treasuryDirectionLabel(movement.direction)} de ${formatMoney(movement.amount)}`,
    movementRoute(movement),
    `Fecha: ${formatDate(movement.occurredAt)}`,
    `Origen: ${treasuryOriginLabel(movement.origin)}`,
    `Registrado por: ${movement.createdByName}`,
  ];
  if (movement.sourceLabel) parts.splice(3, 0, `Detalle: ${movement.sourceLabel}`);
  if (movement.notes) parts.push(`Notas: ${movement.notes}`);
  return parts.join(" · ");
}

/** Título del saldo de una cuenta: la fórmula siempre visible, sin inventar saldo bancario. */
function accountBalanceTitle(account: AdminTreasuryAccountRow): string {
  return [
    `Saldo según movimientos: saldo inicial ${formatMoney(account.openingBalance)} + entradas − salidas y transferencias`,
    `Cuenta ${account.active ? "activa" : "inactiva"} · ${treasuryAccountTypeLabel(account.type)} · ${account.currency}`,
    "No es el saldo bancario real",
  ].join(" · ");
}

/**
 * Etiqueta de una cuenta para los selectores de cobro/pago (issue #129): nombre,
 * tipo y datos para transferir (banco, número o alias). Misma lectura para el
 * panel y el contrato de métodos/cuentas que usa la carga con IA.
 */
function treasuryAccountLabel(
  account: Pick<AdminTreasuryAccountRow, "name" | "type" | "bank" | "number" | "alias">,
): string {
  const details = [treasuryAccountTypeLabel(account.type), account.bank, account.number ?? account.alias].filter(Boolean);
  return `${account.name}${details.length > 0 ? ` · ${details.join(" · ")}` : ""}`;
}

type PaymentForm = {
  clientId: string;
  budgetId: string;
  amount: string;
  /** Cobrado al momento o a plazo (por cobrar). */
  mode: "now" | "term";
  method: string;
  reference: string;
  invoiceIssuedAt: string;
  invoiceNumber: string;
  dueDays: string;
  dueAt: string;
  chequeDate: string;
  /** Seña de un cobro libre (issue #129): total acordado y vencimiento del saldo. */
  totalAmount: string;
  balanceDueAt: string;
  /** Cuenta de tesorería donde entra el cobro (issue #27). */
  treasuryAccountId: string;
};

const EMPTY_PAYMENT_FORM: PaymentForm = {
  clientId: "",
  budgetId: "",
  amount: "",
  mode: "now",
  method: "Transferencia",
  reference: "",
  invoiceIssuedAt: "",
  invoiceNumber: "",
  dueDays: "30",
  dueAt: "",
  chequeDate: "",
  totalAmount: "",
  balanceDueAt: "",
  treasuryAccountId: "",
};

type Notice = { tone: "ok" | "error"; text: string };

// ── Recordatorios de cobro (issue #19) ──────────────────────────────────────
// Un cobro recibe como máximo un recordatorio por canal y día (lo garantiza el
// índice único del API). La fila muestra el estado de hoy y el detalle del cobro
// guarda el historial completo.

/** Recordatorio de hoy de un canal (día de Asunción, igual que el API). */
function reminderToday(payment: AdminPaymentRow, channel: "email" | "whatsapp"): AdminPaymentReminder | undefined {
  return (payment.reminders ?? []).find(
    (reminder) => reminder.channel === channel && isTodayAsuncion(reminder.sentAt),
  );
}

/** Fecha y hora corta del panel para el historial (`21 sept · 14:32`). */
function reminderStamp(value: string): string {
  return `${formatDateShort(value)} · ${formatTime(value)}`;
}

/** Título del estado de hoy en la columna Recordatorio. */
function reminderCellTitle(payment: AdminPaymentRow): string {
  const email = reminderToday(payment, "email");
  const whatsapp = reminderToday(payment, "whatsapp");
  const parts: string[] = [];
  if (email) {
    const when = reminderStamp(email.sentAt);
    parts.push(
      email.status === "sent"
        ? `Recordatorio por email enviado hoy (${when}) a ${email.to}`
        : email.status === "failed"
          ? `El recordatorio por email de hoy falló (${when}): ${email.error ?? "error del proveedor"}`
          : `Recordatorio por email en curso (${when})`,
    );
  }
  if (whatsapp) parts.push(`WhatsApp abierto hoy (${reminderStamp(whatsapp.sentAt)})`);
  return parts.length > 0 ? parts.join(" · ") : "Sin recordatorio hoy";
}

/**
 * Diálogo del cobro: resumen real, acciones de recordatorio y el historial de
 * envíos (canal, destino, estado, actor y fecha en 24 h). Mismo contrato de
 * diálogo del panel que Presupuestos: foco al abrir, cierre con Escape y clic
 * afuera.
 */
function PaymentRemindersDialog({
  payment,
  writable,
  busyId,
  onEmail,
  onTemplate,
  onClose,
}: {
  payment: AdminPaymentRow;
  writable: boolean;
  busyId: string;
  onEmail: (payment: AdminPaymentRow) => void;
  /** Abre el envío por WhatsApp con plantilla (issue #35). */
  onTemplate: (payment: AdminPaymentRow) => void;
  onClose: () => void;
}) {
  const label = payment.client.company || payment.client.name;
  const emailToday = reminderToday(payment, "email");
  const whatsappToday = reminderToday(payment, "whatsapp");
  const reminders = payment.reminders ?? [];
  const emailDoneToday = emailToday?.status === "sent";

  return (
    <AdminDialog
      title={`Recordatorios · ${label}`}
      icon="bell"
      size="md"
      description="Historial del cobro y envío de recordatorios."
      onClose={onClose}
      footer={
        <>
          <AdminButton icon="close" onClick={onClose}>Cerrar</AdminButton>
        </>
      }
    >

        <dl className="admin-dialog-facts">
          <div>
            <dt>Monto</dt>
            <dd>{formatMoney(payment.amount)}</dd>
          </div>
          <div>
            <dt>Vencimiento</dt>
            <dd>
              {payment.dueAt ? (
                <>
                  {formatDate(payment.dueAt)}
                  <AdminCountdown
                    value={payment.dueAt}
                    className="admin-countdown--inline"
                    title="Cobro a plazo: cuánto falta para el vencimiento"
                  />
                </>
              ) : (
                "Sin vencimiento"
              )}
            </dd>
          </div>
          <div>
            <dt>Factura</dt>
            <dd>{payment.invoiceNumber || "Sin factura emitida"}</dd>
          </div>
          <div>
            <dt>Presupuesto</dt>
            <dd>{payment.budget?.title || "Sin presupuesto asociado"}</dd>
          </div>
          <div>
            <dt>Contacto</dt>
            <dd>
              {[payment.client.email || "sin correo", payment.client.phone || "sin teléfono"].join(" · ")}
            </dd>
          </div>
          <div>
            <dt>Portal</dt>
            <dd>{payment.budget?.publicToken ? portalBudgetUrl(payment.budget.publicToken) : "El presupuesto no tiene link del portal"}</dd>
          </div>
        </dl>

        {writable ? (
          <div className="admin-dialog-actions">
            <AdminButton
              icon="mail"
              busy={busyId === `email:${payment.id}`}
              disabled={Boolean(busyId) || emailDoneToday || !payment.client.email}
              title={
                !payment.client.email
                  ? "El cliente no tiene correo cargado"
                  : emailDoneToday
                    ? `Ya se envió hoy a ${emailToday?.to}`
                    : `Recordar por email: ${label}`
              }
              onClick={() => onEmail(payment)}
            >
              {emailDoneToday ? "Enviado hoy" : "Recordar por email"}
            </AdminButton>
            {whatsappReachable(payment.client.phone) ? (
              <AdminButton
                type="button"
                data-done={whatsappToday ? "true" : undefined}
                title={
                  whatsappToday
                    ? `WhatsApp abierto hoy ${reminderStamp(whatsappToday.sentAt)}: ${label}`
                    : `Enviar por WhatsApp con plantilla: ${label}`
                }
                aria-label={`Enviar por WhatsApp con plantilla: ${label}`}
                onClick={() => onTemplate(payment)}
                iconNode={<WhatsappIcon size={15} />}
              >
                Enviar por WhatsApp
              </AdminButton>
            ) : (
              <span className="admin-muted">El cliente no tiene teléfono cargado</span>
            )}
          </div>
        ) : null}

        <p className="admin-dialog-text">
          Historial de recordatorios del cobro (máximo uno por canal y día; los repetidos no se envían de nuevo).
        </p>
        {reminders.length === 0 ? (
          <AdminEmpty icon="bell" title="Sin recordatorios" hint="Todavía no se envió ni abrió ningún recordatorio para este cobro." />
        ) : (
          <ul className="admin-reminder-list">
            {reminders.map((reminder) => (
              <li className="admin-reminder-item" key={reminder.id}>
                <AdminBadge tone={reminderStatusTone(reminder.status)}>{reminderStatusLabel(reminder.status)}</AdminBadge>
                <span className="admin-reminder-main">
                  <strong title={`${reminderChannelLabel(reminder.channel)} · ${reminder.to}`}>
                    {reminderChannelLabel(reminder.channel)} · {reminder.to}
                  </strong>
                  <small>
                    {reminder.actorName || "Sistema"} · {formatDateTime(reminder.sentAt)}
                  </small>
                  {reminder.error ? <small className="admin-reminder-error">{reminder.error}</small> : null}
                </span>
                <span className="admin-reminder-when" title={formatDateTime(reminder.sentAt)}>
                  {reminderStamp(reminder.sentAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
    </AdminDialog>
  );
}

// ── Pagos esperados (issue #28) ─────────────────────────────────────────────
// La cola «Por confirmar» y su trazabilidad. Confirmar registra el cobro y la
// entrada en la cuenta elegida en una sola operación; observar deja el motivo
// visible para el cliente en el portal.

type ExpectedReviewSubmit =
  | { kind: "confirm"; accountId: string; date: string; reference: string; amount: string; method: string }
  | { kind: "reject"; note: string };

/**
 * Diálogo de confirmación u observación de un pago esperado. Confirmar exige la
 * cuenta de tesorería donde entró la plata (y permite la fecha real y la
 * referencia); observar exige el motivo. Mismo contrato de diálogo del panel.
 */
function ExpectedReviewDialog({
  row,
  mode,
  accounts,
  busy,
  error,
  onViewProof,
  onSubmit,
  onClose,
}: {
  row: AdminExpectedPaymentRow;
  mode: "confirm" | "reject";
  accounts: AdminTreasuryAccountRow[];
  busy: boolean;
  error: string;
  onViewProof: (() => void) | null;
  onSubmit: (payload: ExpectedReviewSubmit) => void;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(
    row.expectedAccount && accounts.some((account) => account.id === row.expectedAccount?.id)
      ? row.expectedAccount.id
      : accounts[0]?.id ?? "",
  );
  /** Saldo pendiente del concepto (issue #129): se puede confirmar todo o una seña. */
  const remaining = Math.max(0, row.amount - row.paidAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState(row.payment?.method ?? "Transferencia");
  const [date, setDate] = useState(todayDayKey());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const label = row.budget.client.company || row.budget.client.name;
  const concept = expectedPaymentConcept(row);
  const confirming = mode === "confirm";
  const amountValue = Number(amount) || 0;
  const amountOk = Number.isSafeInteger(amountValue) && amountValue > 0 && amountValue <= remaining;
  const partial = amountOk && amountValue < remaining;
  const canSubmit = confirming ? Boolean(accountId) && amountOk && !busy : note.trim().length > 0 && !busy;

  const formId = useId();
  const initialRef = useRef({ accountId, amount, method, date, reference: "", note: "" });
  const reviewDirty = JSON.stringify({ accountId, amount, method, date, reference, note }) !== JSON.stringify(initialRef.current);
  function submitReview() {
    if (!canSubmit) return;
    if (confirming) onSubmit({ kind: "confirm", accountId, date, reference: reference.trim(), amount, method });
    else onSubmit({ kind: "reject", note: note.trim() });
  }

  return (
    <AdminDialog
      title={`${confirming ? "Confirmar en cuenta" : "Observar / rechazar"} · ${concept}`}
      icon="check"
      size="lg"
      description={confirming ? "Registra el cobro y la entrada en la cuenta elegida." : "El cliente ve el motivo en el portal."}
      error={error}
      dirty={reviewDirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="arrow-left" type="button" disabled={busy} onClick={requestClose}>
            Volver
          </AdminButton>
          <AdminButton
            variant="primary"
            icon={confirming ? "check" : "alert"}
            busy={busy}
            disabled={!canSubmit || busy}
            type="submit"
            form={formId}
            busyLabel={confirming ? "Confirmando…" : "Enviando…"}
          >
            {confirming ? "Confirmar en cuenta" : "Enviar observación"}
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => { event.preventDefault(); submitReview(); }}>

        <dl className="admin-dialog-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{label}</dd>
          </div>
          <div>
            <dt>Presupuesto</dt>
            <dd>{row.budget.title}</dd>
          </div>
          <div>
            <dt>Monto</dt>
            <dd>
              {formatMoney(row.amount)}
              {row.paidAmount > 0 ? (
                <>
                  {" "}
                  · pagado {formatMoney(row.paidAmount)} · saldo {formatMoney(remaining)}
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Vencimiento</dt>
            <dd>
              {row.dueAt ? (
                <>
                  {formatDate(row.dueAt)}
                  <AdminCountdown value={row.dueAt} className="admin-countdown--inline" title="Vencimiento del pago esperado" />
                </>
              ) : (
                "Sin fecha"
              )}
            </dd>
          </div>
          <div>
            <dt>Cuenta destino esperada</dt>
            <dd>{row.expectedAccount?.name ?? "Sin cuenta asignada"}</dd>
          </div>
          <div>
            <dt>Comprobante</dt>
            <dd>
              {row.proof ? (
                onViewProof ? (
                  <AdminButton type="button" variant="link" onClick={onViewProof}>
                    Ver el comprobante ({formatDateTime(row.proof.createdAt)})
                  </AdminButton>
                ) : (
                  `Recibido el ${formatDateTime(row.proof.createdAt)}`
                )
              ) : (
                "Sin comprobante: confirmá solo si la plata está en la cuenta."
              )}
            </dd>
          </div>
          {row.payment?.id ? (
            <div>
              <dt>Cobro vinculado</dt>
              <dd>
                {paymentStatusLabel(row.payment.status)}
                {row.payment.reference ? ` · ${row.payment.reference}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>

        {row.reviewNote ? (
          <AdminNote>Observación anterior enviada al cliente: {row.reviewNote}</AdminNote>
        ) : null}

        {confirming ? (
          <AdminDialogSection title="Confirmación">
            <Combobox
              label="Cuenta de tesorería"
              hint="Donde entró la plata: mueve el disponible"
              value={accountId}
              onChange={setAccountId}
              placeholder="Buscá la cuenta…"
              options={
                accounts.length > 0
                  ? accounts.map((account) => ({
                      value: account.id,
                      label: treasuryAccountLabel(account),
                    }))
                  : [{ value: "", label: "Sin cuentas de tesorería" }]
              }
            />
            <MoneyField
              limit={FIELD_LIMITS.amountStorage}
              label="Monto a confirmar"
              hint={
                row.paidAmount > 0 || partial
                  ? `Saldo pendiente: ${formatMoney(remaining)} · menos que eso registra una seña`
                  : `Todo el monto o menos para registrar una seña con saldo`
              }
              value={amount}
              onChange={setAmount}
              error={amount !== "" && !amountOk ? `El monto va de 1 a ${formatMoney(remaining)}.` : undefined}
            />
            <SelectField
              label="Método"
              value={method}
              onChange={setMethod}
              options={COLLECTED_PAYMENT_METHODS.map((option) => ({ value: option, label: option }))}
            />
            <DateField label="Fecha del cobro" value={date} onChange={setDate} />
            <TextField
              label="Referencia"
              hint="Opcional: Nº de transferencia o recibo"
              maxLength={120}
              value={reference}
              onChange={setReference}
              placeholder="TRF-…"
            />
          </AdminDialogSection>
        ) : (
          <AdminDialogSection title="Observación">
            <TextAreaField
              label="Motivo de la observación"
              hint="El cliente lo ve en el portal y puede volver a subir el comprobante"
              required
              wide
              maxLength={1000}
              rows={3}
              value={note}
              onChange={setNote}
              placeholder="Ej.: el comprobante muestra un monto menor al de la cuota"
            />
          </AdminDialogSection>
        )}

        {confirming ? (
          <p className="admin-dialog-text">
            Confirmar crea el cobro <strong>{formatMoney(amountOk ? amountValue : remaining)}</strong> como cobrado y la
            entrada en la cuenta elegida en la misma operación, y vincula el comprobante.{" "}
            {partial
              ? "Es una seña: el saldo pendiente queda para completarlo o dividirlo después."
              : "Si el cobro ya existía, se cobra ese registro: no se duplica."}
          </p>
        ) : null}
      </form>
    </AdminDialog>
  );
}

type SplitPartDraft = { key: string; amount: string; dueAt: string };

/**
 * Dividir el saldo pendiente en partes con vencimiento (issue #129): la seña
 * cobrada queda en el concepto original (primera parte) y las demás nacen como
 * saldos nuevos. Las partes tienen que sumar exactamente el saldo pendiente.
 */
function ExpectedSplitDialog({
  row,
  busy,
  error,
  onSplit,
  onClose,
}: {
  row: AdminExpectedPaymentRow;
  busy: boolean;
  error: string;
  onSplit: (parts: Array<{ amount: number; dueAt: string }>) => void;
  onClose: () => void;
}) {
  const nextKey = useRef(3);
  const remaining = Math.max(0, row.amount - row.paidAmount);
  const [parts, setParts] = useState<SplitPartDraft[]>(() => {
    const half = Math.ceil(remaining / 2);
    return [
      { key: "part-1", amount: String(half), dueAt: "" },
      { key: "part-2", amount: String(remaining - half), dueAt: "" },
    ];
  });

  const label = row.budget.client.company || row.budget.client.name;
  const concept = expectedPaymentConcept(row);
  const { total, valid } = validateFinanceSplitAmounts(parts.map((part) => part.amount), remaining);

  const formId = useId();
  const initialParts = useRef(JSON.stringify(parts));
  const splitDirty = JSON.stringify(parts) !== initialParts.current;
  function submitSplit() {
    if (!valid || busy) return;
    onSplit(parts.map((part) => ({ amount: Number(part.amount), dueAt: part.dueAt })));
  }

  return (
    <AdminDialog
      title={`Dividir saldo · ${concept}`}
      icon="calendar"
      size="md"
      description="Las partes tienen que sumar el saldo pendiente."
      error={error}
      dirty={splitDirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" disabled={busy} onClick={requestClose}>
            Cancelar
          </AdminButton>
          <AdminButton
            variant="primary"
            icon="calendar"
            busy={busy}
            disabled={!valid || busy}
            type="submit"
            form={formId}
            busyLabel="Dividiendo…"
          >
            Dividir en {parts.length} partes
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => { event.preventDefault(); submitSplit(); }}>

        <dl className="admin-dialog-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{label}</dd>
          </div>
          <div>
            <dt>Concepto</dt>
            <dd>
              {concept} · total {formatMoney(row.amount)}
              {row.paidAmount > 0 ? ` · pagado ${formatMoney(row.paidAmount)}` : ""}
            </dd>
          </div>
          <div>
            <dt>Saldo pendiente</dt>
            <dd>
              <strong>{formatMoney(remaining)}</strong>
            </dd>
          </div>
        </dl>

        <AdminDialogSection title="Partes" stack>
        <div className="admin-plan-list">
          {parts.map((part, index) => (
            <div className="admin-plan-row" key={part.key}>
              <MoneyField
              limit={FIELD_LIMITS.amountStorage}
                label={`Parte ${index + 1} (Gs)`}
                value={part.amount}
                onChange={(value) =>
                  setParts((current) => current.map((rowPart) => (rowPart.key === part.key ? { ...rowPart, amount: value } : rowPart)))
                }
              />
              <DateField
                label={`Vence la parte ${index + 1}`}
                hint="Opcional: sin fecha queda a convenir"
                value={part.dueAt}
                onChange={(value) =>
                  setParts((current) => current.map((rowPart) => (rowPart.key === part.key ? { ...rowPart, dueAt: value } : rowPart)))
                }
              />
              <AdminButton
                icon="close"
                disabled={parts.length <= 2}
                title={`Quitar la parte ${index + 1}`}
                aria-label={`Quitar la parte ${index + 1}`}
                onClick={() => setParts((current) => current.filter((rowPart) => rowPart.key !== part.key))}
              />
            </div>
          ))}
          {parts.length < 12 ? (
            <AdminButton
              icon="plus"
              type="button"
              onClick={() =>
                setParts((current) => [
                  ...current,
                  { key: `part-${nextKey.current++}`, amount: "", dueAt: "" },
                ])
              }
            >
              Agregar parte
            </AdminButton>
          ) : null}
        </div>
        </AdminDialogSection>

        <p className="admin-dialog-text">
          La seña ya cobrada queda en el concepto original como primera parte; las demás se agregan como saldos con su
          vencimiento. Las partes suman <strong>{formatMoney(total)}</strong> de {formatMoney(remaining)} pendientes.
        </p>
      </form>
    </AdminDialog>
  );
}

/**
 * Cobro real de un cobro a crédito que quedó «Pendiente» (issue #135): al
 * cobrarse se elige el método real y la cuenta coherente (Efectivo entra a la
 * caja, transferencia a una cuenta que no es la caja). Un cobro a plazo con
 * método real se sigue cobrando de un clic.
 */
function CollectPaymentDialog({
  payment,
  accounts,
  busy,
  error,
  onCollect,
  onClose,
}: {
  payment: AdminPaymentRow;
  accounts: AdminTreasuryAccountRow[];
  busy: boolean;
  error: string;
  onCollect: (payload: { method: string; treasuryAccountId: string }) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<string>("Transferencia");
  const [accountId, setAccountId] = useState("");

  const label = payment.client.company || payment.client.name;
  const methodAccounts = accountsForPaymentMethod(method, accounts);
  const effectiveAccountId = methodAccounts.some((account) => account.id === accountId)
    ? accountId
    : methodAccounts[0]?.id ?? "";

  const formId = useId();
  return (
    <AdminDialog
      title={`Marcar cobrado · ${label}`}
      icon="check"
      description="Registra el cobro y suma el saldo a la cuenta elegida."
      size="md"
      error={error}
      dirty={method !== "Transferencia" || accountId !== ""}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" disabled={busy} onClick={requestClose}>
            Cancelar
          </AdminButton>
          <AdminButton
            variant="primary"
            icon="check"
            busy={busy}
            disabled={busy || !effectiveAccountId}
            type="submit"
            form={formId}
            busyLabel="Guardando…"
          >
            Marcar cobrado
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => { event.preventDefault(); if (!busy && effectiveAccountId) onCollect({ method, treasuryAccountId: effectiveAccountId }); }}>

        <dl className="admin-dialog-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{label}</dd>
          </div>
          <div>
            <dt>Monto</dt>
            <dd>{formatMoney(payment.amount)}</dd>
          </div>
          <div>
            <dt>Vencimiento</dt>
            <dd>{payment.dueAt ? formatDate(payment.dueAt) : "Sin fecha"}</dd>
          </div>
        </dl>

        <p className="admin-dialog-text">
          El cobro quedó a crédito («Pendiente»): al marcarlo cobrado elegí con qué método entró la plata y a qué cuenta.
          El saldo sube al disponible de esa cuenta.
        </p>

        <AdminDialogSection title="Cobro">
          <SelectField
            label="Método real"
            hint="Con qué entró la plata"
            value={method}
            onChange={(value) => {
              setMethod(value);
              setAccountId("");
            }}
            options={METHOD_OPTIONS.map((option) => ({ value: option, label: option }))}
          />
          {method === "Efectivo" ? (
            <p className="admin-field-hint">
              {effectiveAccountId
                ? `El efectivo entra a «${methodAccounts[0]?.name ?? "la caja"}».`
                : "No hay una cuenta de efectivo: creala en Tesorería."}
            </p>
          ) : (
            <Combobox
              label="Cuenta de tesorería"
              hint="Donde entró la plata"
              value={effectiveAccountId}
              onChange={setAccountId}
              placeholder="Buscá la cuenta…"
              options={
                methodAccounts.length > 0
                  ? methodAccounts.map((account) => ({ value: account.id, label: treasuryAccountLabel(account) }))
                  : [{ value: "", label: "Sin cuentas para este método" }]
              }
            />
          )}
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}

type TimelineStep = { key: string; when: string | null; title: string; detail: string | null; tone: string };

/** Pasos reales de un pago esperado: plan → comprobante → observación → confirmación. */
function expectedTimelineSteps(row: AdminExpectedPaymentRow): TimelineStep[] {
  const steps: TimelineStep[] = [
    {
      key: `${row.id}:plan`,
      when: row.createdAt,
      title: "Pago esperado del plan",
      detail: `${expectedPaymentConcept(row)} · ${formatMoney(row.amount)}${row.dueAt ? ` · vence el ${formatDate(row.dueAt)}` : ""}`,
      tone: "neutral",
    },
  ];
  if (row.proof) {
    steps.push({
      key: `${row.id}:proof`,
      when: row.proof.createdAt,
      title: "Comprobante recibido",
      detail: `${row.proof.uploadedByName} subió el comprobante desde el portal`,
      tone: "info",
    });
  }
  if (row.reviewNote && row.reviewedAt) {
    steps.push({
      key: `${row.id}:review`,
      when: row.reviewedAt,
      title: "Observado por LedBox",
      detail: `${row.reviewedByName ?? "El equipo"}: ${row.reviewNote}`,
      tone: "warn",
    });
  }
  if (row.status === "CONFIRMED" && row.confirmedAt) {
    steps.push({
      key: `${row.id}:confirmed`,
      when: row.confirmedAt,
      title: `Confirmado en «${row.expectedAccount?.name ?? "la cuenta"}»`,
      detail: [
        row.confirmedByName ? `por ${row.confirmedByName}` : null,
        row.payment ? `cobro ${paymentStatusLabel(row.payment.status)}` : null,
        row.payment?.reference ? `referencia ${row.payment.reference}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      tone: "ok",
    });
  }
  if (row.status === "CANCELLED" && row.cancelledAt) {
    steps.push({
      key: `${row.id}:cancelled`,
      when: row.cancelledAt,
      title: "Cancelado",
      detail: "El concepto salió del plan de pagos",
      tone: "danger",
    });
  }
  return steps;
}

/**
 * Trazabilidad completa de un presupuesto (issue #28): aprobación → pagos
 * esperados → comprobantes → confirmaciones en cuenta, con actor y fecha
 * reales. Se pide el presupuesto entero (incluye lo ya confirmado y cancelado).
 */
function ExpectedTimelineDialog({ row, onClose }: { row: AdminExpectedPaymentRow; onClose: () => void }) {
  const [rows, setRows] = useState<AdminExpectedPaymentRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void adminApiGet<{ expectedPayments?: AdminExpectedPaymentRow[] }>(
      `/api/admin/finance/expected?budgetId=${encodeURIComponent(row.budget.id)}`,
      { fallbackError: "No pudimos cargar la trazabilidad." },
    ).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error);
        setRows([]);
        return;
      }
      setRows(result.data.expectedPayments ?? []);
    });
    return () => {
      active = false;
    };
  }, [row.budget.id]);

  const budget = rows?.[0]?.budget ?? row.budget;
  const label = budget.client.company || budget.client.name;

  return (
    <AdminDialog
      title={`Trazabilidad · ${budget.title}`}
      icon="clock"
      size="md"
      description="Aprobación, pagos esperados, comprobantes y confirmaciones."
      onClose={onClose}
      footer={
        <>
          <AdminButton icon="close" onClick={onClose}>Cerrar</AdminButton>
        </>
      }
    >

        <p className="admin-dialog-text">
          {label} · total {formatMoney(budget.total)} · {rows?.length ?? 0}{" "}
          {(rows?.length ?? 0) === 1 ? "concepto" : "conceptos"} del plan
        </p>

        <ol className="admin-timeline">
          <li className="admin-timeline-step" data-tone={budget.approvedAt ? "ok" : "neutral"}>
            <span className="admin-timeline-when">{budget.approvedAt ? formatDateTime(budget.approvedAt) : "Sin aprobar"}</span>
            <span className="admin-timeline-body">
              <strong>Presupuesto aprobado</strong>
              <small>
                {[
                  budget.approvedByName ? `por ${budget.approvedByName}` : null,
                  budget.approvalMethod === "digital" ? "desde el portal del cliente" : budget.approvalMethod === "manual" ? "desde el panel" : null,
                ]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ") || "—"}
              </small>
            </span>
          </li>
          {(rows ?? []).map((expected) => (
            <li className="admin-timeline-group" key={expected.id}>
              <header className="admin-timeline-group-head">
                <strong>{expectedPaymentConcept(expected)}</strong>
                <span className="admin-num">{formatMoney(expected.amount)}</span>
                <AdminBadge tone={expectedPaymentStatusTone(expected.status)}>{expectedPaymentStatusLabel(expected.status)}</AdminBadge>
              </header>
              <ol className="admin-timeline">
                {expectedTimelineSteps(expected).map((step) => (
                  <li className="admin-timeline-step" key={step.key} data-tone={step.tone}>
                    <span className="admin-timeline-when">{step.when ? formatDateTime(step.when) : "—"}</span>
                    <span className="admin-timeline-body">
                      <strong>{step.title}</strong>
                      {step.detail ? <small>{step.detail}</small> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>

        {error ? <AdminNote tone="error">{error}</AdminNote> : null}
        {rows === null ? <p className="admin-dialog-text">Cargando la trazabilidad…</p> : null}
    </AdminDialog>
  );
}

function FinancePaymentPagination({ page, visible, busy, received = false, onChange }: { page?: AdminFinancePaymentPage; visible: number; busy: boolean; received?: boolean; onChange: (page: number) => void }) {
  if (!page) return null;
  return <AdminToolbar>
    <span className="admin-muted" role="status">{formatNumber(visible)} de {formatNumber(page.total)} · {received ? "cobrado" : "por cobrar"} de todos los resultados: {formatMoney(page.amount)} · página {page.page} de {page.pages}</span>
    <AdminButton disabled={busy || page.page <= 1} onClick={() => onChange(page.page - 1)} aria-label={`Página anterior de ${received ? "historial" : "pendientes"}`}>Anterior</AdminButton>
    <AdminButton disabled={busy || page.page >= page.pages} onClick={() => onChange(page.page + 1)} aria-label={`Página siguiente de ${received ? "historial" : "pendientes"}`}>Siguiente</AdminButton>
  </AdminToolbar>;
}

export function FinanzasModule({ section = "resumen" }: { section?: AdminFinanzasSection } = {}) {
  const { role } = useAdminSession();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [paymentPages, setPaymentPages] = useState({ filter: "", pending: 1, settled: 1 });
  const searchParams = useSearchParams();
  const venceFilter = parseAgingParam(searchParams.get("vence"));
  const clienteParam = searchParams.get("cliente");
  const presupuestoParam = searchParams.get("presupuesto");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const paymentFilter = JSON.stringify([debouncedQuery, clienteParam, searchParams.get("vence")]);
  useEffect(() => { setPaymentPages({ filter: paymentFilter, pending: 1, settled: 1 }); }, [paymentFilter]);
  // Reiniciar ambas páginas en el mismo render en que cambia el filtro.
  const pendingPage = paymentPages.filter === paymentFilter ? paymentPages.pending : 1;
  const settledPage = paymentPages.filter === paymentFilter ? paymentPages.settled : 1;
  const collectionParams = new URLSearchParams({ view: "collections", q: debouncedQuery, pendingPage: String(pendingPage), settledPage: String(settledPage) });
  if (clienteParam) collectionParams.set("clientId", clienteParam);
  if (venceFilter) collectionParams.set("vence", searchParams.get("vence")!);
  const finance = useAdminResource(section === "por-cobrar" ? `/api/admin/finance?${collectionParams}` : "/api/admin/finance", (payload) => ({
    payments: payload.clientPayments ?? [],
    jobs: payload.supplierJobs ?? [],
    summary: payload.financeSummary,
    pagination: payload.paymentsPagination,
    filterClient: payload.filterClient ?? null,
  }));
  const clienteFilter = finance.data?.filterClient ?? null;
  const changePaymentPage = (kind: "pending" | "settled", page: number) => setPaymentPages({
    filter: paymentFilter, pending: pendingPage, settled: settledPage, [kind]: page,
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PaymentForm>(EMPTY_PAYMENT_FORM);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [formError, setFormError] = useState("");
  // Catálogos del formulario de cobro (issue #59): solo alimentan sus selects, así
  // que se piden recién al abrirlo (el pago y el presupuesto de la fila ya vienen
  // con el cobro). Misma data y mismas acciones, sin payload en el primer render.
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? [], { enabled: showForm });
  const budgets = useAdminResource("/api/admin/budgets", (payload) => payload.budgets ?? [], { enabled: showForm });
  const [notice, setNotice] = useState<Notice | null>(null);
  // Recordatorios de cobro (issue #19): envío por email, apertura de WhatsApp y
  // detalle del cobro con su historial.
  const [reminderBusyId, setReminderBusyId] = useState("");
  /** Demo: recordatorio por correo que no salió, con su vista previa. */
  const [simulatedMail, setSimulatedMail] = useState<SimulatedMail | null>(null);
  const [remindersFor, setRemindersFor] = useState("");
  const [runningReminders, setRunningReminders] = useState(false);
  /** Envío por WhatsApp con plantilla (issue #35) para el cobro elegido. */
  const [templateTarget, setTemplateTarget] = useState<MessageTemplateTarget | null>(null);

  // Comprobantes del portal (issue #17): metadatos por presupuesto y visor del
  // cobro pendiente, con "Marcar cobrado" a un clic.
  const [proofsByBudget, setProofsByBudget] = useState<Record<string, AdminBudgetPaymentProofRow[]>>({});
  const [proofDialog, setProofDialog] = useState<AdminPaymentRow | null>(null);
  /** Visor de comprobante abierto desde la cola de pagos esperados. */
  const [expectedProof, setExpectedProof] = useState<{ row: AdminExpectedPaymentRow; proof: AdminBudgetPaymentProofRow } | null>(null);

  // Pagos esperados (issue #28): cola "Por confirmar", confirmación en cuenta y
  // trazabilidad del presupuesto.
  const expected = useAdminResource(`/api/admin/finance/expected${presupuestoParam ? `?budgetId=${encodeURIComponent(presupuestoParam)}` : ""}`, (payload) => ({
    rows: payload.expectedPayments ?? [],
    summary: payload.expectedSummary ?? EMPTY_EXPECTED_SUMMARY,
  }));
  const [expectedReview, setExpectedReview] = useState<{ row: AdminExpectedPaymentRow; mode: "confirm" | "reject" } | null>(null);
  /** División del saldo pendiente (issue #129): partes con vencimiento. */
  const [expectedSplit, setExpectedSplit] = useState<AdminExpectedPaymentRow | null>(null);
  /** Cobro real de un cobro a crédito («Pendiente», issue #135). */
  const [collectPayment, setCollectPayment] = useState<AdminPaymentRow | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectError, setCollectError] = useState("");
  const [expectedTimeline, setExpectedTimeline] = useState<AdminExpectedPaymentRow | null>(null);
  const [expectedBusy, setExpectedBusy] = useState(false);
  const expectedAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [expectedError, setExpectedError] = useState("");

  // ── Tesorería y gastos (issue #27) ────────────────────────────────────────
  // El período es uno solo para los movimientos y los gastos; las cuentas se
  // piden sin filtro porque su saldo es el de hoy.
  const [period, setPeriod] = useState<string>("this-month");
  const periodQuery = datePeriodQuery(period);
  const treasury = useAdminResource(`/api/admin/treasury${periodQuery}`, (payload) => ({
    accounts: payload.accounts ?? [],
    movements: payload.movements ?? [],
    summary: payload.summary ?? EMPTY_TREASURY_SUMMARY,
  }));
  const expenses = useAdminResource(`/api/admin/expenses${periodQuery}`, (payload) => ({
    rows: payload.expenses ?? [],
    projects: payload.projects ?? [],
    suppliers: payload.suppliers ?? [],
  }));
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_ACCOUNT_FORM);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [movementForm, setMovementForm] = useState<MovementForm>({
    direction: "IN",
    accountId: "",
    counterAccountId: "",
    amount: "",
    date: todayDayKey(),
    notes: "",
  });
  const [movementBusy, setMovementBusy] = useState(false);
  const [movementError, setMovementError] = useState("");
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({
    amount: "",
    description: "",
    category: "",
    accountId: "",
    eventId: "",
    date: todayDayKey(),
    supplierId: "",
    // Un gasto es plata que sale: método real (issue #135).
    method: METHOD_OPTIONS[0],
    receipt: "",
    notes: "",
  });
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [expenseProjectFilter, setExpenseProjectFilter] = useState("");
  const [expenseAccountFilter, setExpenseAccountFilter] = useState("");
  const [payJob, setPayJob] = useState<PayJobForm | null>(null);
  const [payJobBase, setPayJobBase] = useState<PayJobForm | null>(null);
  const payJobFormId = useId();
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState("");

  const writable = canWriteFinance(role);
  const canRunReminders = role === "OWNER" || role === "ADMIN";
  /**
   * Lista en tarjetas en pantalla chica (auditoría móvil, issue #140): cada
   * sección cambia su tabla densa por tarjetas con entidad, estado, fecha/monto
   * y acción principal. En escritorio se mantiene la tabla.
   */
  const compact = useAdminNarrowViewport();
  const payments = useMemo(() => finance.data?.payments ?? [], [finance.data]);
  const jobs = useMemo(() => finance.data?.jobs ?? [], [finance.data]);
  const term = form.mode === "term";

  const accounts = useMemo(() => treasury.data?.accounts ?? [], [treasury.data]);
  const activeAccounts = useMemo(() => accounts.filter((account) => account.active), [accounts]);
  /** Cuenta por defecto de todo lo que sale o entra: la primera activa. */
  const defaultAccountId = activeAccounts[0]?.id ?? "";
  const paymentFormId = useId();
  const accountFormId = useId();
  const movementFormId = useId();
  const expenseFormId = useId();
  const accountBaseline = (() => {
    const row = accountForm.id ? accounts.find((account) => account.id === accountForm.id) : null;
    return row
      ? {
          id: row.id,
          name: row.name,
          type: row.type,
          bank: row.bank ?? "",
          number: row.number ?? "",
          alias: row.alias ?? "",
          openingBalance: row.openingBalance ? String(row.openingBalance) : "",
          sortOrder: row.sortOrder ? String(row.sortOrder) : "",
          active: row.active,
        }
      : EMPTY_ACCOUNT_FORM;
  })();
  const accountDirty = JSON.stringify(accountForm) !== JSON.stringify(accountBaseline);
  const movementDirty = movementForm.direction !== "IN" || Boolean(movementForm.amount || movementForm.notes || movementForm.counterAccountId);
  // Cuenta, categoría, proyecto y fecha se conservan a propósito entre cargas.
  const expenseDirty = Boolean(expenseForm.amount || expenseForm.description || expenseForm.receipt || expenseForm.notes);
  const summary = treasury.data?.summary ?? EMPTY_TREASURY_SUMMARY;
  const movements = useMemo(() => treasury.data?.movements ?? [], [treasury.data]);
  const expenseRows = useMemo(() => expenses.data?.rows ?? [], [expenses.data]);
  const projects = useMemo(() => expenses.data?.projects ?? [], [expenses.data]);
  const expenseSuppliers = useMemo(() => expenses.data?.suppliers ?? [], [expenses.data]);

  const accountOptions = useMemo(
    () => activeAccounts.map((account) => ({ value: account.id, label: treasuryAccountLabel(account) })),
    [activeAccounts],
  );
  /** Cuentas coherentes con el método elegido (issue #135): efectivo → caja,
   *  transferencia/tarjeta → cuentas que no son caja, cheque → cheques/banco. */
  const methodAccounts = useMemo(
    () => accountsForPaymentMethod(form.method, activeAccounts),
    [activeAccounts, form.method],
  );
  /** A crédito («Pendiente») no se elige cuenta: entra recién al cobrarlo. */
  const accountIsPending = term && form.method === PENDING_PAYMENT_METHOD;
  /** Cuenta efectiva del cobro: la elegida si sirve para el método; si no, la primera que sí. */
  const effectiveAccountId = methodAccounts.some((account) => account.id === form.treasuryAccountId)
    ? form.treasuryAccountId
    : methodAccounts[0]?.id ?? "";
  const projectOptions = useMemo<Array<{ value: string; label: string }>>(
    () => [
      { value: "", label: "A definir" },
      ...projects.map((project) => ({
        value: project.id,
        label: `${project.name}${project.client.company || project.client.name ? ` · ${project.client.company || project.client.name}` : ""}`,
      })),
    ],
    [projects],
  );
  const supplierOptions = useMemo<Array<{ value: string; label: string }>>(
    () => [
      { value: "", label: "Sin proveedor" },
      ...expenseSuppliers.map((supplier) => ({
        value: supplier.id,
        label: supplier.company ? `${supplier.name} · ${supplier.company}` : supplier.name,
      })),
    ],
    [expenseSuppliers],
  );

  /** Gastos con los filtros de la lista (categoría, proyecto —o sin proyecto— y cuenta). */
  const filteredExpenses = useMemo(
    () =>
      expenseRows.filter((expense) => {
        if (expenseCategoryFilter && expense.category !== expenseCategoryFilter) return false;
        if (expenseAccountFilter && expense.account.id !== expenseAccountFilter) return false;
        if (expenseProjectFilter === "none") return !expense.event;
        if (expenseProjectFilter && expense.event?.id !== expenseProjectFilter) return false;
        return true;
      }),
    [expenseRows, expenseAccountFilter, expenseCategoryFilter, expenseProjectFilter],
  );

  const periodLabel = datePeriodLabel(period).toLowerCase();
  /** Cuentas por tipo: el detalle de cada KPI de disponible. */
  const accountCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const account of accounts) counts[account.type] = (counts[account.type] ?? 0) + 1;
    return counts;
  }, [accounts]);
  /** El proyecto abierto en "Pagar" siempre con los datos frescos del trabajo. */
  const payJobRow = useMemo(() => (payJob ? jobs.find((job) => job.id === payJob.jobId) ?? null : null), [jobs, payJob]);

  /** Cobro abierto en el detalle de recordatorios (siempre con los datos frescos). */
  const reminderDetail = useMemo(
    () => payments.find((payment) => payment.id === remindersFor) ?? null,
    [payments, remindersFor],
  );

  /** Presupuestos del cliente elegido (el presupuesto es opcional). */
  const clientBudgets = useMemo(
    () => (budgets.data ?? []).filter((budget) => budget.client.id === form.clientId),
    [budgets.data, form.clientId],
  );

  // El API filtra y ordena antes de paginar; aquí sólo se separan las dos listas.
  const pendingPayments = useMemo(() => payments.filter(payment => payment.status === "PENDING"), [payments]);
  const settledPayments = useMemo(() => payments.filter(payment => payment.status !== "PENDING"), [payments]);

  const filteredJobs = useMemo(
    () => jobs.filter((job) => matchesQuery(query, [job.supplier.name, job.event?.name, job.description, job.status])),
    [jobs, query],
  );

  // ── Pagos esperados (issue #28) ───────────────────────────────────────────
  const expectedRows = useMemo(() => expected.data?.rows ?? [], [expected.data]);
  const expectedSummary = expected.data?.summary ?? EMPTY_EXPECTED_SUMMARY;
  /** Cola "Por confirmar": comprobantes en revisión + vencidos sin comprobante. */
  const expectedQueue = useMemo(
    () =>
      expectedRows
        .filter((row) => presupuestoParam
          ? ["AWAITING", "PROOF", "PARTIAL"].includes(row.status)
          : expectedPaymentNeedsAction(row))
        .filter((row) =>
          matchesQuery(query, [
            row.budget.client.company,
            row.budget.client.name,
            row.budget.title,
            row.label,
            row.expectedAccount?.name,
          ]),
        )
        .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999")),
    [expectedRows, query, presupuestoParam],
  );

  const totals = finance.data?.summary ?? { collected: 0, collectedCount: 0, pendingTotal: 0, pendingCount: 0, overdue: 0, advances: 0, payable: 0, jobsCount: 0 };

  /**
   * Resumen (auditoría UX, issue #140): una tarjeta por sección con el dato que
   * decide la acción y el enlace directo. Es el índice de Finanzas, sin tablas:
   * el trabajo pesado vive en su sección.
   */
  const resumenCards = useMemo<AdminCardData[]>(() => {
    const gastosTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
    return [
      {
        id: "por-confirmar",
        title: "Por confirmar",
        subtitle: "Comprobantes del portal en revisión y pagos esperados vencidos.",
        badges:
          expectedSummary.pending.count > 0
            ? [
                {
                  label: `${formatNumber(expectedSummary.pending.count)} en cola`,
                  tone: expectedSummary.overdue.count > 0 ? "danger" : "warn",
                },
              ]
            : [{ label: "Al día", tone: "ok" }],
        fields: [
          { label: "Pagos esperados", value: formatMoney(expectedSummary.pending.total) },
          { label: "Vencidos", value: formatNumber(expectedSummary.overdue.count) },
        ],
        footer: (
          <AdminButtonLink href="/finanzas/por-confirmar" iconEnd="arrow-right">Ver por confirmar</AdminButtonLink>
        ),
      },
      {
        id: "por-cobrar",
        title: "Por cobrar",
        subtitle: "Cobros a plazo: vencimientos, recordatorios, cobro y anulación.",
        badges:
          totals.pendingCount > 0
            ? [
                {
                  label: `${formatNumber(totals.pendingCount)} a plazo`,
                  tone: totals.overdue > 0 ? "danger" : "warn",
                },
              ]
            : [{ label: "Sin pendientes", tone: "ok" }],
        fields: [
          { label: "Por cobrar", value: formatMoney(totals.pendingTotal) },
          { label: "Vencidos", value: formatNumber(totals.overdue) },
        ],
        footer: (
          <AdminButtonLink href="/finanzas/por-cobrar" iconEnd="arrow-right">Ver por cobrar</AdminButtonLink>
        ),
      },
      {
        id: "proveedores",
        title: "Proveedores",
        subtitle: "Cuentas por pagar: saldo, anticipos y pagos desde tesorería.",
        badges:
          totals.jobsCount > 0
            ? [{ label: `${formatNumber(totals.jobsCount)} trabajos`, tone: totals.payable > 0 ? "warn" : "ok" }]
            : [{ label: "Sin trabajos", tone: "ok" }],
        fields: [
          { label: "Saldo por pagar", value: formatMoney(totals.payable) },
          { label: "Anticipos pagados", value: formatMoney(totals.advances) },
        ],
        footer: (
          <AdminButtonLink href="/finanzas/proveedores" iconEnd="arrow-right">Ver proveedores</AdminButtonLink>
        ),
      },
      {
        id: "tesoreria",
        title: "Tesorería",
        subtitle: "Cuentas con su saldo y todos los movimientos del período.",
        badges: [{ label: `${formatNumber(accounts.length)} cuentas`, tone: undefined }],
        fields: [
          { label: "Disponible", value: formatMoney(summary.total) },
          { label: "Movimientos", value: formatNumber(movements.length) },
        ],
        footer: (
          <AdminButtonLink href="/finanzas/tesoreria" iconEnd="arrow-right">Ver tesorería</AdminButtonLink>
        ),
      },
      {
        id: "conciliacion",
        title: "Conciliación",
        subtitle: "Cruzá la cartola del banco contra los movimientos del período.",
        fields: [
          { label: "Movimientos del período", value: formatNumber(movements.length) },
          { label: "Cuentas activas", value: formatNumber(summary.activeAccounts) },
        ],
        footer: (
          <AdminButtonLink href="/finanzas/conciliacion" iconEnd="arrow-right">Ver conciliación</AdminButtonLink>
        ),
      },
      {
        id: "gastos",
        title: "Gastos",
        subtitle: "Gastos de la operación del período, con categoría y proyecto.",
        badges: [{ label: `${formatNumber(expenseRows.length)} del período`, tone: undefined }],
        fields: [{ label: "Total del período", value: formatMoney(gastosTotal) }],
        footer: (
          <AdminButtonLink href="/finanzas/gastos" iconEnd="arrow-right">Ver gastos</AdminButtonLink>
        ),
      },
    ];
  }, [expectedSummary, totals, jobs, accounts.length, movements.length, expenseRows, summary.total, summary.activeAccounts]);

  // Comprobantes del portal (issue #17): una sola consulta de metadatos por
  // carga de finanzas; el visor filtra por el presupuesto del cobro o del pago
  // esperado. La firma suma los presupuestos de la cola "Por confirmar" (issue
  // #28) para que el comprobante esté a la vista sin otra consulta.
  const proofSignature = useMemo(
    () =>
      [
        ...new Set([
          ...payments
            .map((payment) => payment.budget?.id)
            .filter((id): id is string => Boolean(id)),
          ...(expected.data?.rows ?? []).map((row) => row.budget.id),
        ]),
      ].join(","),
    [payments, expected.data],
  );
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

  const pendingMeta = totals.pendingCount
    ? `${formatNumber(totals.pendingCount)} a plazo${totals.overdue > 0 ? ` · ${formatNumber(totals.overdue)} vencidos` : ""}`
    : "cobros a plazo";

  /** CSV de cobros cobrados/anulados con los mismos filtros de la lista. */
  function exportCollections() {
    const total = receivedAmount(settledPayments);
    const blocks: CsvBlock[] = [
      {
        title: "Cobros de clientes · página visible",
        header: ["Fecha", "Cliente", "Presupuesto", "Factura", "Método", "Referencia", "Estado", "Monto (PYG)"],
        rows: [
          ...settledPayments.map((payment) => [
            csvStamp(payment.collectedAt ?? payment.paidAt),
            payment.client.company || payment.client.name,
            payment.budget?.title ?? "",
            payment.invoiceNumber ?? "",
            payment.method ?? "",
            payment.reference ?? "",
            paymentStatusLabel(payment.status),
            payment.amount,
          ]),
          ["", "", "", "", "", "", "Total cobrado de esta página", total],
        ],
      },
    ];
    downloadCsv(csvFilename("cobros-clientes"), blocks);
  }

  /** CSV de cobros a plazo: vencimiento, factura, cheque y estado. */
  function exportPendingCollections() {
    const total = pendingPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const blocks: CsvBlock[] = [
      {
        title: "Cobros a plazo por cobrar · página visible",
        header: ["Vence", "Cliente", "Presupuesto", "Factura", "Emisión", "Método", "Cheque", "Cuándo", "Monto (PYG)"],
        rows: [
          ...pendingPayments.map((payment) => [
            csvDay(payment.dueAt),
            payment.client.company || payment.client.name,
            payment.budget?.title ?? "",
            payment.invoiceNumber ?? "",
            csvDay(payment.invoiceIssuedAt),
            payment.method ?? "",
            csvDay(payment.chequeDate),
            formatCountdown(payment.dueAt),
            payment.amount,
          ]),
          ["", "", "", "", "", "", "", "Total", total],
        ],
      },
    ];
    downloadCsv(csvFilename("cobros-a-plazo"), blocks);
  }

  /** CSV de cuentas por pagar: total, anticipo y saldo real de cada trabajo. */
  function exportPayables() {
    const total = filteredJobs.reduce((sum, job) => sum + job.total, 0);
    const advances = filteredJobs.reduce((sum, job) => sum + job.advance, 0);
    const balance = filteredJobs.reduce((sum, job) => sum + supplierJobBalance(job), 0);
    const blocks: CsvBlock[] = [
      {
        title: "Cuentas por pagar a proveedores",
        header: ["Proveedor", "Trabajo", "Evento", "Vence", "Total (PYG)", "Anticipo (PYG)", "Saldo (PYG)", "Estado"],
        rows: [
          ...filteredJobs.map((job) => [
            job.supplier.name,
            job.description,
            job.event?.name ?? "",
            csvDay(job.dueAt),
            job.total,
            job.advance,
            supplierJobBalance(job),
            jobStatusLabel(job.status),
          ]),
          ["Total", "", "", "", total, advances, balance, ""],
        ],
      },
    ];
    downloadCsv(csvFilename("cuentas-por-pagar"), blocks);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    setNotice(null);
    const payload: Record<string, unknown> = {
      kind: "client",
      clientId: form.clientId,
      budgetId: form.budgetId || undefined,
      amount: Number(form.amount),
      method: form.method || undefined,
      // Cuenta de tesorería del cobro (issues #27 y #135): la coherente con el
      // método; a crédito («Pendiente») no va cuenta hasta cobrarlo.
      treasuryAccountId: accountIsPending ? undefined : effectiveAccountId || undefined,
    };
    if (term) {
      payload.status = "PENDING";
      if (form.invoiceIssuedAt) payload.invoiceIssuedAt = form.invoiceIssuedAt;
      if (form.invoiceNumber.trim()) payload.invoiceNumber = form.invoiceNumber.trim();
      if (form.dueAt) payload.dueAt = form.dueAt;
      else payload.dueDays = Number(form.dueDays);
      if (form.method === "Cheque") payload.chequeDate = form.chequeDate;
    } else {
      payload.reference = form.reference || undefined;
      // Seña de un cobro libre (issue #129): el saldo queda a plazo.
      if (form.totalAmount.trim()) {
        payload.totalAmount = Number(form.totalAmount);
        if (form.balanceDueAt) payload.balanceDueAt = form.balanceDueAt;
      }
    }
    const result = await adminSend("/api/admin/finance", payload, "POST", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice({
      tone: "ok",
      text: term
        ? "Cobro a plazo registrado."
        : form.totalAmount.trim()
          ? "Seña registrada: el saldo quedó como cobro a plazo."
          : "Cobro registrado.",
    });
    setForm({ ...EMPTY_PAYMENT_FORM });
    finance.reload();
  }

  /** Cierra un cobro a plazo: lo cobra (fecha real) o lo anula; el API decide y audita. */
  async function closeCollection(
    payment: AdminPaymentRow,
    action: "collect" | "cancel",
    extra?: { method?: string; treasuryAccountId?: string },
  ) {
    const label = payment.client.company || payment.client.name;
    setBusyId(`${action}:${payment.id}`);
    setNotice(null);
    setFormError("");
    const result = await adminSend(
      "/api/admin/finance",
      { kind: "client", paymentId: payment.id, action, ...extra },
      "PATCH",
      { idempotencyKey: true },
    );
    setBusyId("");
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return false;
    }
    setNotice({
      tone: "ok",
      text: action === "collect" ? `Cobro de ${label} marcado como cobrado.` : `Cobro a plazo de ${label} anulado.`,
    });
    finance.reload();
    return true;
  }

  /**
   * Cobra un cobro a plazo (issue #135): si quedó «Pendiente» (a crédito) pide
   * el método y la cuenta reales —nunca se elige dónde entró la plata antes de
   * que entre—; con método real, sigue siendo de un clic.
   */
  function openCollect(payment: AdminPaymentRow) {
    if (payment.method && payment.method !== PENDING_PAYMENT_METHOD) {
      void closeCollection(payment, "collect");
      return;
    }
    setCollectError("");
    setCollectPayment(payment);
  }

  /** Cierra el diálogo del comprobante y cobra con el método real elegido. */
  async function submitCollect(payload: { method: string; treasuryAccountId: string }) {
    if (!collectPayment) return;
    setCollectBusy(true);
    setCollectError("");
    const ok = await closeCollection(collectPayment, "collect", {
      method: payload.method,
      treasuryAccountId: payload.treasuryAccountId || undefined,
    });
    setCollectBusy(false);
    if (ok) setCollectPayment(null);
  }

  /**
   * Recordatorio por email del cobro (issue #19). El API decide: si ya hay uno
   * de hoy responde `alreadySentToday` (sin duplicar) y si el envío falla queda
   * el motivo real. El panel refresca para ver el estado y el historial.
   */
  async function remindByEmail(payment: AdminPaymentRow) {
    const label = payment.client.company || payment.client.name;
    setReminderBusyId(`email:${payment.id}`);
    setNotice(null);
    setFormError("");
    const result = await adminSend<{ reminder?: AdminPaymentReminder; alreadySentToday?: boolean; simulated?: boolean; preview?: SimulatedMail | null }>(
      "/api/admin/reminders",
      { paymentId: payment.id, channel: "email" },
    );
    setReminderBusyId("");
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    const reminder = result.data.reminder;
    if (reminder?.status === "failed") {
      setNotice({
        tone: "error",
        text: `No se pudo enviar el recordatorio a ${reminder.to}: ${reminder.error ?? "error del proveedor"}.`,
      });
    } else if (result.data.alreadySentToday) {
      setNotice({ tone: "ok", text: `Ya se envió un recordatorio hoy a ${reminder?.to ?? label}: no se duplica.` });
    } else if (result.data.simulated) {
      // Demo: no salió ningún correo; se muestra cómo se habría visto.
      setNotice({ tone: "ok", text: `${SIMULATED_MAIL_NOTICE}: recordatorio a ${reminder?.to ?? label}.` });
      setSimulatedMail(result.data.preview ?? null);
    } else {
      setNotice({ tone: "ok", text: `Recordatorio enviado a ${reminder?.to ?? label} con el link del portal.` });
    }
    finance.reload();
  }

  /**
   * Abre el diálogo de plantilla para el cobro (issue #35): el mensaje se arma
   * con los datos reales y el envío queda en la auditoría y en el historial del
   * cobro (mismo `PaymentReminderLog` del canal WhatsApp).
   */
  function sendWhatsappTemplate(payment: AdminPaymentRow) {
    setRemindersFor("");
    setTemplateTarget({
      kind: "payment",
      id: payment.id,
      label: payment.client.company || payment.client.name,
      phone: payment.client.phone,
    });
  }

  /** Fuerza la corrida diaria (OWNER/ADMIN): mismo despacho idempotente del primer uso. */
  async function runReminders() {
    setRunningReminders(true);
    setNotice(null);
    const result = await adminSend<{ result?: AdminReminderRun; signatureReminders?: AdminSignatureReminderRun }>(
      "/api/admin/reminders/run",
      {},
    );
    setRunningReminders(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    const summary = result.data.result;
    if (!summary) {
      setNotice({ tone: "error", text: "No pudimos leer el resultado de la corrida." });
      return;
    }
    if (summary.reason === "missing_resend_api_key") {
      setNotice({ tone: "error", text: "Falta configurar RESEND_API_KEY: los recordatorios por email están deshabilitados." });
    } else if (summary.reason === "demo_organization") {
      setNotice({ tone: "ok", text: "La demo es de solo lectura: no envía recordatorios." });
    } else {
      const parts = [
        `${formatNumber(summary.sent)} enviados`,
        `${formatNumber(summary.alreadySentToday)} ya enviados hoy`,
        `${formatNumber(summary.skipped)} sin correo`,
      ];
      if (summary.failed > 0) parts.push(`${formatNumber(summary.failed)} fallidos`);
      // Recordatorios de firma (issue #81): misma corrida diaria.
      const signatures = result.data.signatureReminders;
      const signaturePart = signatures
        ? ` · firmas: ${formatNumber(signatures.sent)} enviados${
            signatures.alreadySentToday > 0 ? ` · ${formatNumber(signatures.alreadySentToday)} ya enviados hoy` : ""
          } de ${formatNumber(signatures.candidates)} por vencer`
        : "";
      setNotice({
        tone: summary.failed > 0 || (signatures?.failed ?? 0) > 0 ? "error" : "ok",
        text: `Recordatorios de hoy: ${parts.join(" · ")} (${formatNumber(summary.candidates)} cobros en la ventana de 7 días)${signaturePart}.`,
      });
    }
    finance.reload();
  }

  /** "Marcar cobrado" desde el visor del comprobante: cobra y cierra el diálogo. */
  function collectFromProofDialog(payment: AdminPaymentRow) {
    setProofDialog(null);
    openCollect(payment);
  }

  // ── Confirmación y observación de pagos esperados (issue #28) ─────────────

  /** Comprobante vinculado al pago esperado, con los metadatos ya cargados. */
  function expectedProofOf(row: AdminExpectedPaymentRow): AdminBudgetPaymentProofRow | null {
    if (!row.proof) return null;
    return (proofsByBudget[row.budget.id] ?? []).find((proof) => proof.id === row.proof?.id) ?? null;
  }

  /**
   * Confirma el pago esperado en la cuenta elegida (el API crea el cobro
   * RECEIVED y el movimiento en una sola transacción) u observa con un motivo
   * que el cliente ve en el portal. Idempotente: reintentar no duplica.
   */
  async function submitExpectedReview(payload: ExpectedReviewSubmit) {
    if (!expectedReview || expectedBusy) return;
    const row = expectedReview.row;
    const label = row.budget.client.company || row.budget.client.name;
    const concept = expectedPaymentConcept(row);
    setExpectedBusy(true);
    setExpectedError("");
    setNotice(null);

    let failure = "";
    let alreadyConfirmed = false;
    let movementSkipped = false;
    let appliedAmount = 0;
    let remainingAfter = 0;
    if (payload.kind === "confirm") {
      const fingerprint = JSON.stringify({ rowId: row.id, ...payload });
      if (expectedAttempt.current?.fingerprint !== fingerprint) {
        expectedAttempt.current = { fingerprint, key: newIdempotencyKey() };
      }
      const result = await adminSend<{
        alreadyConfirmed?: boolean;
        movementCreated?: boolean;
        appliedAmount?: number;
        remaining?: number;
      }>("/api/admin/finance/expected", {
        kind: "confirm",
        expectedPaymentId: row.id,
        accountId: payload.accountId || undefined,
        amount: Number(payload.amount) || undefined,
        method: payload.method || undefined,
        date: payload.date || undefined,
        reference: payload.reference || undefined,
      }, "POST", { idempotencyKey: expectedAttempt.current.key });
      if (!result.ok) failure = result.error;
      else {
        alreadyConfirmed = Boolean(result.data.alreadyConfirmed);
        movementSkipped = result.data.movementCreated === false;
        appliedAmount = result.data.appliedAmount ?? 0;
        remainingAfter = result.data.remaining ?? 0;
      }
    } else {
      const result = await adminSend<{ expectedPayment?: AdminExpectedPaymentRow }>("/api/admin/finance/expected", {
        kind: "reject",
        expectedPaymentId: row.id,
        note: payload.note,
      });
      if (!result.ok) failure = result.error;
    }

    setExpectedBusy(false);
    if (failure) {
      setExpectedError(failure);
      return;
    }
    setExpectedReview(null);
    expectedAttempt.current = null;
    if (payload.kind === "confirm") {
      const accountName = accounts.find((account) => account.id === payload.accountId)?.name ?? "la cuenta";
      if (!alreadyConfirmed && remainingAfter > 0) {
        setNotice({
          tone: "ok",
          text: `Seña de ${formatMoney(appliedAmount)} registrada para «${concept}» de ${label} en «${accountName}»: quedan ${formatMoney(remainingAfter)} por cobrar y el saldo se puede completar o dividir desde la fila.`,
        });
      } else {
        setNotice({
          tone: "ok",
          text: alreadyConfirmed
            ? `«${concept}» de ${label} ya estaba confirmado: no se duplicó nada.`
            : `«${concept}» de ${label} confirmado en «${accountName}»${
                movementSkipped
                  ? ": el cobro ya estaba registrado y no se duplicó el movimiento."
                  : ": el cobro quedó cobrado y el disponible subió."
              }`,
        });
      }
    } else {
      setNotice({ tone: "ok", text: `Observación enviada a ${label}: el motivo se ve en el portal.` });
    }
    expected.reload();
    finance.reload();
    treasury.reload();
  }

  /**
   * Divide el saldo pendiente del concepto en partes con vencimiento (issue
   * #129): el API deja la seña en la primera parte y crea el resto.
   */
  async function submitExpectedSplit(parts: Array<{ amount: number; dueAt: string }>) {
    if (!expectedSplit) return;
    const row = expectedSplit;
    const label = row.budget.client.company || row.budget.client.name;
    const concept = expectedPaymentConcept(row);
    setExpectedBusy(true);
    setExpectedError("");
    setNotice(null);
    const result = await adminSend<{ parts?: AdminExpectedPaymentRow[] }>("/api/admin/finance/expected", {
      kind: "split",
      expectedPaymentId: row.id,
      parts,
    });
    setExpectedBusy(false);
    if (!result.ok) {
      setExpectedError(result.error);
      return;
    }
    setExpectedSplit(null);
    setNotice({
      tone: "ok",
      text: `Saldo de «${concept}» de ${label} dividido en ${parts.length} partes con su vencimiento.`,
    });
    expected.reload();
    finance.reload();
  }

  // ── Tesorería (issue #27) ─────────────────────────────────────────────────

  /** Guarda una cuenta de tesorería: alta o edición, con auditoría del API. */
  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountBusy) return;
    const name = accountForm.name.trim();
    setAccountBusy(true);
    setAccountError("");
    setNotice(null);
    const payload: Record<string, unknown> = {
      kind: "account",
      name,
      type: accountForm.type,
      bank: accountForm.type === "BANK" ? accountForm.bank.trim() : undefined,
      // Datos para transferir (issue #129): se guardan con la cuenta.
      number: accountForm.number.trim(),
      alias: accountForm.alias.trim(),
      openingBalance: Number(accountForm.openingBalance || 0),
      sortOrder: Number(accountForm.sortOrder || 0),
      active: accountForm.active,
    };
    const result = accountForm.id
      ? await adminSend("/api/admin/treasury", { ...payload, accountId: accountForm.id }, "PATCH", { idempotencyKey: true })
      : await adminSend("/api/admin/treasury", payload, "POST", { idempotencyKey: true });
    setAccountBusy(false);
    if (!result.ok) {
      setAccountError(result.error);
      return;
    }
    setNotice({
      tone: "ok",
      text: accountForm.id ? `Cuenta «${name}» actualizada.` : `Cuenta «${name}» creada con saldo inicial declarado.`,
    });
    setAccountForm(EMPTY_ACCOUNT_FORM);
    setShowAccountForm(false);
    treasury.reload();
  }

  /** Abre el formulario de cuenta con los datos reales de la fila. */
  function editAccount(account: AdminTreasuryAccountRow) {
    setAccountError("");
    setAccountForm({
      id: account.id,
      name: account.name,
      type: account.type,
      bank: account.bank ?? "",
      number: account.number ?? "",
      alias: account.alias ?? "",
      openingBalance: account.openingBalance ? String(account.openingBalance) : "",
      sortOrder: account.sortOrder ? String(account.sortOrder) : "",
      active: account.active,
    });
    setShowAccountForm(true);
  }

  /** Baja lógica de una cuenta: se conserva todo su historial de movimientos. */
  async function toggleAccount(account: AdminTreasuryAccountRow) {
    setBusyId(`account:${account.id}`);
    setNotice(null);
    const result = await adminSend(
      "/api/admin/treasury",
      { kind: "account", accountId: account.id, active: !account.active },
      "PATCH",
      { idempotencyKey: true },
    );
    setBusyId("");
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setNotice({
      tone: "ok",
      text: account.active
        ? `Cuenta «${account.name}» desactivada: no se ofrece más para movimientos.`
        : `Cuenta «${account.name}» activada.`,
    });
    treasury.reload();
  }

  /** Movimiento manual: entrada, salida o transferencia entre cuentas. */
  async function saveMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (movementBusy) return;
    setMovementBusy(true);
    setMovementError("");
    setNotice(null);
    const payload: Record<string, unknown> = {
      kind: "movement",
      direction: movementForm.direction,
      accountId: movementForm.accountId || defaultAccountId,
      amount: Number(movementForm.amount),
      date: movementForm.date || undefined,
      notes: movementForm.notes.trim() || undefined,
    };
    if (movementForm.direction === "TRANSFER") payload.counterAccountId = movementForm.counterAccountId;
    const result = await adminSend("/api/admin/treasury", payload, "POST", { idempotencyKey: true });
    setMovementBusy(false);
    if (!result.ok) {
      setMovementError(result.error);
      return;
    }
    setNotice({
      tone: "ok",
      text:
        movementForm.direction === "TRANSFER"
          ? "Transferencia registrada: el saldo se movió entre las dos cuentas."
          : movementForm.direction === "IN"
            ? "Entrada de tesorería registrada."
            : "Salida de tesorería registrada.",
    });
    setMovementForm({ ...movementForm, counterAccountId: "", amount: "", notes: "" });
    setShowMovementForm(false);
    treasury.reload();
  }

  // ── Gastos (issue #27) ────────────────────────────────────────────────────

  /** Carga rápida del gasto: guarda y cierra, o guarda y deja lista la próxima. */
  async function saveExpense(intent: "close" | "another") {
    if (expenseBusy) return;
    setExpenseBusy(true);
    setExpenseError("");
    setNotice(null);
    const description = expenseForm.description.trim();
    const amount = Number(expenseForm.amount);
    const accountId = expenseForm.accountId || defaultAccountId;
    const result = await adminSend("/api/admin/expenses", {
      amount,
      description,
      category: expenseForm.category,
      accountId: accountId || undefined,
      eventId: expenseForm.eventId || undefined,
      date: expenseForm.date || undefined,
      supplierId: expenseForm.supplierId || undefined,
      method: expenseForm.method || undefined,
      receipt: expenseForm.receipt.trim() || undefined,
      notes: expenseForm.notes.trim() || undefined,
    }, "POST", { idempotencyKey: true });
    setExpenseBusy(false);
    if (!result.ok) {
      setExpenseError(result.error);
      return;
    }
    const accountName = accounts.find((account) => account.id === accountId)?.name ?? "la cuenta";
    const project = projects.find((candidate) => candidate.id === expenseForm.eventId);
    setNotice({
      tone: "ok",
      text: `Gasto «${description}» de ${formatMoney(amount)} cargado en «${accountName}»${project ? ` · ${project.name}` : " · a definir"}.`,
    });
    // La cuenta, la categoría, el proyecto y la fecha se conservan para cargar
    // varios seguidos: solo se limpian el monto y la descripción.
    setExpenseForm({ ...expenseForm, amount: "", description: "", receipt: "", notes: "" });
    if (intent === "close") setShowExpenseForm(false);
    else window.setTimeout(() => document.getElementById(EXPENSE_AMOUNT_ID)?.focus(), 0);
    expenses.reload();
    // El gasto genera su egreso: el saldo de las cuentas cambia.
    treasury.reload();
  }

  /** Asigna el proyecto desde la fila (el null del modelo es "A definir"). */
  async function assignExpenseProject(expense: AdminExpenseRow, eventId: string) {
    setBusyId(`expense:${expense.id}`);
    setNotice(null);
    const result = await adminSend("/api/admin/expenses", { expenseId: expense.id, eventId: eventId || null }, "PATCH", { idempotencyKey: true });
    setBusyId("");
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    const project = projects.find((candidate) => candidate.id === eventId);
    setNotice({
      tone: "ok",
      text: project
        ? `Gasto «${expense.description}» asignado a «${project.name}».`
        : `Gasto «${expense.description}» quedó a definir.`,
    });
    expenses.reload();
  }

  /** CSV de los gastos filtrados: mismos filtros que la lista, total incluido. */
  function exportExpenses() {
    const total = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const blocks: CsvBlock[] = [
      {
        title: `Gastos · ${datePeriodLabel(period)}`,
        header: [
          "Fecha",
          "Descripción",
          "Categoría",
          "Proyecto",
          "Cuenta",
          "Proveedor",
          "Método",
          "Comprobante",
          "Notas",
          "Registrado por",
          "Monto (PYG)",
        ],
        rows: [
          ...filteredExpenses.map((expense) => [
            csvDay(expense.date),
            expense.description,
            expenseCategoryLabel(expense.category),
            expense.event?.name ?? "A definir",
            expense.account.name,
            expense.supplier?.name ?? "",
            expense.method ?? "",
            expense.receipt ?? "",
            expense.notes ?? "",
            expense.createdByName,
            expense.amount,
          ]),
          ["", "", "", "", "", "", "", "", "", "Total", total],
        ],
      },
    ];
    downloadCsv(csvFilename("gastos"), blocks);
  }

  /** Abre el pago de un trabajo de proveedor con el saldo real como monto. */
  function openPayJob(job: AdminSupplierJobRow) {
    setPayError("");
    const initial: PayJobForm = {
      jobId: job.id,
      accountId: defaultAccountId,
      amount: String(supplierJobBalance(job) || ""),
      date: todayDayKey(),
      // Un pago a proveedor es plata que sale: método real (issue #135).
      method: METHOD_OPTIONS[0],
      receipt: "",
    };
    setPayJobBase(initial);
    setPayJob(initial);
  }

  /**
   * Pago o anticipo al proveedor desde una cuenta: registra el egreso y sube el
   * anticipo del trabajo con las reglas de estado del API.
   */
  async function savePayJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payJob) return;
    const before = payJobRow?.status ?? "";
    const amount = Number(payJob.amount);
    const accountId = payJob.accountId || defaultAccountId;
    setPayBusy(true);
    setPayError("");
    setNotice(null);
    const result = await adminSend<{ job?: { status: string } }>("/api/admin/treasury", {
      kind: "supplier-payment",
      jobId: payJob.jobId,
      accountId: accountId || undefined,
      amount,
      date: payJob.date || undefined,
      method: payJob.method || undefined,
      receipt: payJob.receipt.trim() || undefined,
    }, "POST", { idempotencyKey: true });
    setPayBusy(false);
    if (!result.ok) {
      setPayError(result.error);
      return;
    }
    const after = result.data.job?.status ?? before;
    const accountName = accounts.find((account) => account.id === accountId)?.name ?? "la cuenta";
    setNotice({
      tone: "ok",
      text:
        `Pago de ${formatMoney(amount)} registrado en «${accountName}». ` +
        (after !== before
          ? `El trabajo quedó «${jobStatusLabel(after)}».`
          : `El trabajo sigue «${jobStatusLabel(before)}»: su estado se gestiona en Proveedores.`),
    });
    setPayJob(null);
    finance.reload();
    treasury.reload();
  }

  return (
    <div className="admin-module-page">
      <AdminModuleContext
        breadcrumb="Plata / Finanzas"
        hint="Cobros, tesorería, gastos y pagos a proveedores con trazabilidad."
        meta={periodLabel}
      />

      <div className="admin-subtabs-bar">
        <AdminTabs
          label="Secciones de Finanzas"
          items={FINANZAS_SECTIONS.map((item) => ({
            href: item.href,
            label: item.label,
            icon: item.icon,
            active: item.key === section,
          }))}
        />
      </div>

      {notice ? <AdminNote tone={notice.tone}>{notice.text}</AdminNote> : null}

      {section === "resumen" ? (
        <>
          <AdminToolbar>
            <span className="admin-export">
              <AdminButtonLink
               
                href="/imprimir/reporte"
                target="_blank"
                rel="noreferrer"
                title="Abrir el reporte mensual imprimible"
                aria-label="Abrir el reporte mensual imprimible"
               icon="print">Reporte mensual</AdminButtonLink>
            </span>
          </AdminToolbar>
          <AdminKpis label="Indicadores de finanzas">
            <AdminKpi
              state={kpiState(finance)}
              label="Ingresos de clientes" icon="finance"
              value={formatMoney(totals.collected)}
              note={`${formatNumber(totals.collectedCount)} cobros · incluye garantías retenidas y cargos extra`}
              tone="ok"
            />
            <AdminKpi
              state={kpiState(finance)}
              label="Por cobrar" icon="finance"
              value={formatMoney(totals.pendingTotal)}
              note={pendingMeta}
              tone={totals.overdue > 0 ? "danger" : totals.pendingCount > 0 ? "warn" : undefined}
            />
            <AdminKpi
              state={kpiState(expected)}
              label="Por confirmar" icon="clock"
              value={formatMoney(expectedSummary.pending.total)}
              note={
                expectedSummary.pending.count > 0
                  ? `${formatNumber(expectedSummary.proof.count)} con comprobante${expectedSummary.overdue.count > 0 ? ` · ${formatNumber(expectedSummary.overdue.count)} vencidos` : ""}`
                  : "pagos esperados con comprobante o vencidos"
              }
              tone={expectedSummary.overdue.count > 0 ? "danger" : expectedSummary.proof.count > 0 ? "warn" : undefined}
            />
            <AdminKpi state={kpiState(expected)} label="Anticipos pagados" icon="suppliers" value={formatMoney(totals.advances)} note="a proveedores" />
            <AdminKpi
              state={kpiState(finance)}
              label="Saldo por pagar" icon="suppliers"
              value={formatMoney(totals.payable)}
              note={`${formatNumber(totals.jobsCount)} trabajos de proveedor`}
              tone="warn"
            />
          </AdminKpis>
          <AdminPanel title="Secciones" icon="overview" meta="Elegí dónde trabajar">
            <AdminCardGrid label="Secciones de Finanzas" cards={resumenCards} />
          </AdminPanel>
        </>
      ) : null}

      {section === "por-confirmar" ? (
        <AdminToolbar>
          <SearchField
            value={query}
            onChange={setQuery}
            label="Buscar pagos esperados"
            placeholder="Buscar por cliente, presupuesto o concepto…"
          />
        </AdminToolbar>
      ) : null}

      {section === "por-cobrar" ? (
        <AdminToolbar>
          <SearchField
            value={query}
            onChange={setQuery}
            label="Buscar cobros"
            placeholder="Buscar por cliente, presupuesto, método o referencia…"
          />
          {canRunReminders ? (
            <AdminButton
              icon="mail"
              busy={runningReminders}
              disabled={Boolean(busyId) || runningReminders}
              onClick={() => void runReminders()}
              title="Enviar ahora los recordatorios de cobros vencidos o por vencer en 7 días (un máximo por cobro y día)"
              aria-label="Enviar los recordatorios de hoy"
            >
              Recordatorios de hoy
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
              Registrar cobro
            </AdminButton>
          ) : null}
        </AdminToolbar>
      ) : null}

      {section === "proveedores" ? (
        <AdminToolbar>
          <SearchField
            value={query}
            onChange={setQuery}
            label="Buscar cuentas por pagar"
            placeholder="Buscar por proveedor, evento o descripción…"
          />
        </AdminToolbar>
      ) : null}

      {section === "tesoreria" || section === "conciliacion" || section === "gastos" ? (
        <AdminToolbar>
          <AdminSelect
            value={period}
            onChange={setPeriod}
            label="Período de movimientos y gastos"
            title="Período de la lista de movimientos de tesorería y de los gastos"
            options={PERIOD_OPTIONS}
          />
        </AdminToolbar>
      ) : null}

      {section === "por-cobrar" && writable && showForm ? (
        <AdminDialog
          title="Nuevo cobro de cliente"
          icon="finance"
          size="lg"
          description="Registra lo cobrado, o lo que queda por cobrar a plazo, y lo asocia al cliente y al presupuesto."
          error={formError}
          dirty={JSON.stringify(form) !== JSON.stringify(EMPTY_PAYMENT_FORM)}
          onClose={() => setShowForm(false)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={paymentFormId} busy={busy} busyLabel="Guardando…">
                {term ? "Registrar cobro a plazo" : "Registrar cobro"}
              </AdminButton>
            </>
          )}
        >
          <form id={paymentFormId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
            <AdminDialogSection title="Cobro">
          <Combobox
            label="Cliente"
            required
            value={form.clientId}
            onChange={(value) => setForm({ ...form, clientId: value, budgetId: "" })}
            placeholder="Buscá por nombre o empresa…"
            emptyLabel={clients.loading ? "Cargando clientes…" : clients.error ? "No pudimos cargar los clientes." : "No hay clientes cargados."}
            options={(clients.data ?? []).map((client) => {
              const company = client.company?.trim() || "";
              return {
                value: client.id,
                label: company || client.name,
                description: company && company !== client.name ? client.name : undefined,
              };
            })}
          />
          <Combobox
            label="Presupuesto"
            hint="Opcional"
            value={form.budgetId}
            onChange={(value) => setForm({ ...form, budgetId: value })}
            placeholder="Buscá el presupuesto…"
            options={[
              { value: "", label: "Sin presupuesto" },
              ...clientBudgets.map((budget) => ({ value: budget.id, label: `${budget.title} · ${formatMoney(budget.total)}` })),
            ]}
          />
          <MoneyField
              limit={FIELD_LIMITS.amountStorage}
            label="Monto"
            hint="En guaraníes"
            required
            value={form.amount}
            onChange={(value) => setForm({ ...form, amount: value })}
          />
          <SelectField
            label="Tipo de cobro"
            value={form.mode}
            onChange={(value) => {
              const mode = value === "term" ? "term" : "now";
              // A crédito se propone «Pendiente» (issue #135); al volver a
              // cobrado ahora, se retoma un método real.
              const method = mode === "term" ? PENDING_PAYMENT_METHOD : form.method === PENDING_PAYMENT_METHOD ? "Transferencia" : form.method;
              setForm({ ...form, mode, method, treasuryAccountId: "" });
            }}
            options={[
              { value: "now", label: "Cobrado ahora" },
              { value: "term", label: "A plazo (por cobrar)" },
            ]}
          />
          <SelectField
            label="Método"
            value={form.method}
            onChange={(value) => setForm({ ...form, method: value, chequeDate: "", treasuryAccountId: "" })}
            options={(term ? TERM_METHOD_OPTIONS : METHOD_OPTIONS).map((method) => ({ value: method, label: method }))}
          />
          {accountIsPending || form.method === "Efectivo" ? (
            <div className="admin-field">
              <span className="admin-field-label">Cuenta de tesorería</span>
              <span className="admin-field-hint">
                {accountIsPending
                  ? "A crédito: la plata todavía no entró, la cuenta se elige al cobrarlo."
                  : methodAccounts.length > 0
                    ? `El efectivo entra a «${methodAccounts[0].name}».`
                    : "No hay una cuenta de efectivo: creala en Tesorería."}
              </span>
            </div>
          ) : (
            <Combobox
              label="Cuenta de tesorería"
              hint={term ? "Donde va a entrar el cobro" : "Donde entra la plata"}
              value={effectiveAccountId}
              onChange={(value) => setForm({ ...form, treasuryAccountId: value })}
              placeholder="Buscá la cuenta…"
              options={
                methodAccounts.length > 0
                  ? methodAccounts.map((account) => ({ value: account.id, label: treasuryAccountLabel(account) }))
                  : [{ value: "", label: "Sin cuentas para este método" }]
              }
            />
          )}
            </AdminDialogSection>
            <AdminDialogSection
              title="Más opciones"
              collapsible
              defaultOpen={term}
              hint={term ? "factura, plazo y vencimiento" : "referencia y seña con saldo"}
            >
          {term ? (
            <>
              <DateField
                label="Emisión de factura"
                hint="Si no hay factura, dejalo vacío"
                value={form.invoiceIssuedAt}
                onChange={(value) =>
                  setForm({
                    ...form,
                    invoiceIssuedAt: value,
                    invoiceNumber: value ? form.invoiceNumber : "",
                  })
                }
              />
              <TextField
                label="Nº de factura"
                maxLength={60}
                required={Boolean(form.invoiceIssuedAt)}
                value={form.invoiceNumber}
                onChange={(value) => setForm({ ...form, invoiceNumber: value })}
                placeholder={form.invoiceIssuedAt ? "Número de la factura" : "Primero cargá la emisión"}
              />
              <SelectField
                label="Días de plazo"
                hint="Desde la emisión (o desde hoy si no hay factura)"
                value={form.dueDays}
                onChange={(value) => setForm({ ...form, dueDays: value })}
                options={TERM_DAY_OPTIONS.map((days) => ({ value: days, label: TERM_DAY_LABEL[days] }))}
              />
              <DateField
                label="Vence el"
                hint="Fecha exacta (opcional; manda sobre los días)"
                value={form.dueAt}
                onChange={(value) => setForm({ ...form, dueAt: value })}
              />
              {form.method === "Cheque" ? (
                <DateField
                  label="Fecha del cheque"
                  hint="Obligatoria para cobrar con cheque"
                  required
                  value={form.chequeDate}
                  onChange={(value) => setForm({ ...form, chequeDate: value })}
                />
              ) : null}
            </>
          ) : (
            <>
              <TextField
                label="Referencia"
                hint="Nº de transferencia o recibo"
                maxLength={120}
                value={form.reference}
                onChange={(value) => setForm({ ...form, reference: value })}
                placeholder="Opcional"
              />
              <MoneyField
              limit={FIELD_LIMITS.amountStorage}
                label="Total acordado (seña)"
                hint="Opcional: con un total mayor al monto, registra una seña y el saldo queda como cobro a plazo"
                value={form.totalAmount}
                onChange={(value) => setForm({ ...form, totalAmount: value, balanceDueAt: value ? form.balanceDueAt : "" })}
                error={
                  form.totalAmount.trim() && Number(form.totalAmount) <= (Number(form.amount) || 0)
                    ? "El total tiene que ser mayor al monto de la seña."
                    : undefined
                }
              />
              {form.totalAmount.trim() ? (
                <DateField
                  label="Vence el saldo"
                  hint="Opcional: sin fecha queda a convenir"
                  value={form.balanceDueAt}
                  onChange={(value) => setForm({ ...form, balanceDueAt: value })}
                />
              ) : null}
            </>
          )}
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      {section === "por-confirmar" ? (
        <AdminPanel
          title="Por confirmar" icon="clock"
          meta={
            expectedSummary.pending.count > 0
              ? `${formatNumber(expectedSummary.pending.count)} ${expectedSummary.pending.count === 1 ? "pago esperado" : "pagos esperados"} · ${formatMoney(expectedSummary.pending.total)}`
              : undefined
          }
        >
          {presupuestoParam ? (
            <AdminNote>
              Cobros de {expectedRows[0]?.budget.title ?? "este presupuesto"}: incluye los pendientes futuros y sin fecha. {" "}
              <Link href="/finanzas/por-confirmar">Ver todos los presupuestos</Link>
            </AdminNote>
          ) : null}
          <p className="admin-note admin-expected-note">
            <AdminIcon name="info" size={14} />
            <span>
              Los pagos esperados <strong>no</strong> cuentan como cobrados: el cliente transfiere y sube el comprobante
              (queda <em>en revisión</em>) o el pago se atrasa (<em>vencido</em>). Al confirmar en una cuenta de tesorería se
              registra el cobro y la entrada, y recién ahí sube el disponible.{" "}
              {expectedSummary.awaiting.count > 0 ? (
                <>
                  Además hay {formatNumber(expectedSummary.awaiting.count)} concepto(s) del plan esperando su fecha por{" "}
                  {formatMoney(expectedSummary.awaiting.total)}.
                </>
              ) : null}
            </span>
          </p>
          <AdminDataState
            loading={expected.loading}
            error={expected.error}
            onRetry={expected.reload}
            empty={expectedQueue.length === 0}
            emptyTitle={expectedRows.length === 0 ? "Sin pagos esperados" : "Nada por confirmar"}
            emptyIcon="clock"
            emptyHint={
              expectedRows.length === 0
                ? "Al aprobar un presupuesto con plan de pagos se generan acá el anticipo, las cuotas y el saldo."
                : "El plan de pagos del portal está al día."
            }
            rows={3}
          >
            {compact ? (
              <AdminCardGrid
                label="Pagos esperados por confirmar"
                cards={expectedQueue.map((row): AdminCardData => {
                  const label = row.budget.client.company || row.budget.client.name;
                  const concept = expectedPaymentConcept(row);
                  const overdue = row.status !== "PROOF" && expectedPaymentNeedsAction(row);
                  const proof = expectedProofOf(row);
                  const status =
                    row.status === "PARTIAL"
                      ? { label: "Parcial (seña)", tone: "warn" as const, title: "Seña cobrada: queda saldo pendiente" }
                      : overdue
                        ? { label: "Vencido", tone: "danger" as const, title: "Vencido sin comprobante: reclamá la transferencia" }
                        : {
                            label: expectedPaymentStatusLabel(row.status),
                            tone: expectedPaymentStatusTone(row.status),
                            title: expectedPaymentStatusLabel(row.status),
                          };
                  const amount = row.status === "PARTIAL" ? Math.max(0, row.amount - row.paidAmount) : row.amount;
                  return {
                    id: row.id,
                    title: label,
                    titleTooltip: `${label} · ${row.budget.title} · presupuesto ${row.budget.id.slice(0, 8)}`,
                    subtitle: `${concept} · ${row.budget.title}`,
                    badges: [
                      status,
                      proof
                        ? { label: "Con comprobante", tone: "info" as const, title: "El cliente subió el comprobante: se puede confirmar" }
                        : { label: "Sin comprobante", tone: "neutral" as const },
                    ],
                    fields: [
                      {
                        label: "Vence",
                        value: row.dueAt ? (
                          <>
                            <span className="admin-nowrap">{formatDateShort(row.dueAt)}</span>{" "}
                            <AdminCountdown
                              value={row.dueAt}
                              className="admin-countdown--inline"
                              title={`Cuánto falta: ${concept} de ${label}`}
                            />
                          </>
                        ) : (
                          "—"
                        ),
                        title: row.dueAt ? `Vence el ${formatDate(row.dueAt)} · ${formatCountdown(row.dueAt)}` : "Sin fecha de vencimiento",
                      },
                      {
                        label: "Cuenta",
                        value: row.expectedAccount?.name ?? "—",
                        title: row.expectedAccount
                          ? `Cuenta esperada: ${row.expectedAccount.name} (se puede cambiar al confirmar)`
                          : "Sin cuenta destino: elegí la cuenta al confirmar",
                      },
                      {
                        label: "Monto",
                        value: <strong>{formatMoney(amount)}</strong>,
                        title:
                          row.paidAmount > 0
                            ? `Monto ${formatMoney(row.amount)} · pagado ${formatMoney(row.paidAmount)} · saldo ${formatMoney(Math.max(0, row.amount - row.paidAmount))}`
                            : `Monto ${formatMoney(row.amount)}`,
                      },
                    ],
                    footer: (
                      <span className="admin-actions">
                        {proof ? (
                          <AdminButton
                            icon="eye"
                            title={`Ver el comprobante de ${label} (${concept})`}
                            aria-label={`Ver el comprobante de ${label} (${concept})`}
                            onClick={() => setExpectedProof({ row, proof })}
                          />
                        ) : null}
                        <AdminButton
                          icon="clock"
                          title={`Ver la trazabilidad del presupuesto «${row.budget.title}»`}
                          aria-label={`Ver la trazabilidad del presupuesto «${row.budget.title}»`}
                          onClick={() => setExpectedTimeline(row)}
                        />
                        {writable && row.status !== "CONFIRMED" && row.status !== "CANCELLED" ? (
                          <AdminButton
                            icon="calendar"
                            disabled={Boolean(expectedBusy)}
                            title={`Dividir el saldo de ${concept} de ${label} en partes con vencimiento`}
                            aria-label={`Dividir el saldo de ${concept} de ${label}`}
                            onClick={() => {
                              setExpectedError("");
                              setExpectedSplit(row);
                            }}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="alert"
                            disabled={Boolean(expectedBusy)}
                            title={`Observar / rechazar: ${concept} de ${label}`}
                            aria-label={`Observar / rechazar: ${concept} de ${label}`}
                            onClick={() => {
                              setExpectedError("");
                              setExpectedReview({ row, mode: "reject" });
                            }}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="check"
                            disabled={Boolean(expectedBusy)}
                            title={`Confirmar en cuenta: ${concept} de ${label} (${formatMoney(row.amount)})`}
                            aria-label={`Confirmar en cuenta: ${concept} de ${label}`}
                            onClick={() => {
                              setExpectedError("");
                              setExpectedReview({ row, mode: "confirm" });
                            }}
                          >
                            Confirmar
                          </AdminButton>
                        ) : null}
                      </span>
                    ),
                  };
                })}
              />
            ) : (
            <AdminTable
              view="por-confirmar"
              label="Pagos esperados por confirmar"
              columns={[
                { label: "Cliente" },
                { label: "Concepto" },
                { label: "Vence" },
                { label: "Cuenta" },
                { label: "Comprobante" },
                { label: "Estado" },
                { label: "Monto", end: true },
                { label: "Acciones", end: true },
              ]}
            >
              {expectedQueue.map((row) => {
                const label = row.budget.client.company || row.budget.client.name;
                const concept = expectedPaymentConcept(row);
                const overdue = row.status !== "PROOF" && expectedPaymentNeedsAction(row);
                const proof = expectedProofOf(row);
                return (
                  <AdminRow key={row.id}>
                    <AdminCell title={`${label} · ${row.budget.title} · presupuesto ${row.budget.id.slice(0, 8)}`}>
                      <strong>{label}</strong>
                      <small className="admin-cell-sub"> · {row.budget.title}</small>
                    </AdminCell>
                    <AdminCell title={`${concept}${row.label.includes("· parte ") ? ` ${row.label.split("· parte ")[1]}` : ""}${row.dueAt ? ` · vence el ${formatDate(row.dueAt)}` : ""}`}>
                      {concept}
                      {row.label.includes("· parte ") ? (
                        <small className="admin-cell-sub"> · parte {row.label.split("· parte ")[1]}</small>
                      ) : null}
                    </AdminCell>
                    <AdminCell
                      title={row.dueAt ? `Vence el ${formatDate(row.dueAt)} · ${formatCountdown(row.dueAt)}` : "Sin fecha de vencimiento"}
                    >
                      <span className="admin-nowrap">{row.dueAt ? formatDateShort(row.dueAt) : "—"}</span>
                      {row.dueAt ? (
                        <AdminCountdown value={row.dueAt} className="admin-countdown--inline" title={`Cuánto falta: ${concept} de ${label}`} />
                      ) : null}
                    </AdminCell>
                    <AdminCell
                      title={
                        row.expectedAccount
                          ? `Cuenta esperada: ${row.expectedAccount.name} (se puede cambiar al confirmar)`
                          : "Sin cuenta destino: elegí la cuenta al confirmar"
                      }
                    >
                      {row.expectedAccount?.name ?? <span className="admin-muted">—</span>}
                    </AdminCell>
                    <AdminCell end>
                      {row.proof ? (
                        <AdminButton
                          icon="eye"
                          title={`Ver el comprobante de ${label} (${concept})`}
                          aria-label={`Ver el comprobante de ${label} (${concept})`}
                          onClick={() => proof && setExpectedProof({ row, proof })}
                        />
                      ) : (
                        <span className="admin-muted">Sin comprobante</span>
                      )}
                    </AdminCell>
                    <AdminCell>
                      {row.status === "PARTIAL" ? (
                        <AdminBadge tone={expectedPaymentStatusTone("PARTIAL")} title="Seña cobrada: queda saldo pendiente">
                          Parcial (seña)
                        </AdminBadge>
                      ) : overdue ? (
                        <AdminBadge tone="danger" title="Vencido sin comprobante: reclamá la transferencia">
                          Vencido
                        </AdminBadge>
                      ) : (
                        <AdminBadge tone={expectedPaymentStatusTone(row.status)} title={expectedPaymentStatusLabel(row.status)}>
                          {expectedPaymentStatusLabel(row.status)}
                        </AdminBadge>
                      )}
                    </AdminCell>
                    <AdminCell
                      end
                      title={
                        row.paidAmount > 0
                          ? `Monto ${formatMoney(row.amount)} · pagado ${formatMoney(row.paidAmount)} · saldo ${formatMoney(Math.max(0, row.amount - row.paidAmount))}`
                          : `Monto ${formatMoney(row.amount)}`
                      }
                    >
                      <strong>{formatMoney(row.status === "PARTIAL" ? Math.max(0, row.amount - row.paidAmount) : row.amount)}</strong>
                      {row.paidAmount > 0 ? (
                        <small className="admin-cell-sub"> · pagado {formatMoney(row.paidAmount)}</small>
                      ) : null}
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      <span className="admin-actions">
                        <AdminButton
                          icon="clock"
                          title={`Ver la trazabilidad del presupuesto «${row.budget.title}»`}
                          aria-label={`Ver la trazabilidad del presupuesto «${row.budget.title}»`}
                          onClick={() => setExpectedTimeline(row)}
                        />
                        {writable && row.status !== "CONFIRMED" && row.status !== "CANCELLED" ? (
                          <AdminButton
                            icon="calendar"
                            disabled={Boolean(expectedBusy)}
                            title={`Dividir el saldo de ${concept} de ${label} en partes con vencimiento`}
                            aria-label={`Dividir el saldo de ${concept} de ${label}`}
                            onClick={() => {
                              setExpectedError("");
                              setExpectedSplit(row);
                            }}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="alert"
                            disabled={Boolean(expectedBusy)}
                            title={`Observar / rechazar: ${concept} de ${label}`}
                            aria-label={`Observar / rechazar: ${concept} de ${label}`}
                            onClick={() => {
                              setExpectedError("");
                              setExpectedReview({ row, mode: "reject" });
                            }}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="check"
                            disabled={Boolean(expectedBusy)}
                            title={`Confirmar en cuenta: ${concept} de ${label} (${formatMoney(row.amount)})`}
                            aria-label={`Confirmar en cuenta: ${concept} de ${label}`}
                            onClick={() => {
                              setExpectedError("");
                              setExpectedReview({ row, mode: "confirm" });
                            }}
                          >
                            Confirmar
                          </AdminButton>
                        ) : null}
                      </span>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
            )}
          </AdminDataState>
        </AdminPanel>
      ) : null}

      {section === "por-cobrar" ? (
        <>
        <AdminPanel
          title="Por cobrar" icon="finance"
          meta={`${formatNumber(finance.data?.pagination?.pending.total ?? 0)} cobros a plazo · todos los resultados`}
          action={
            <AdminButton
              icon="download"
              onClick={exportPendingCollections}
              title="Exportar la página visible de cobros a plazo a CSV"
              aria-label="Exportar la página visible de cobros a plazo a CSV"
            >
              Exportar página CSV
            </AdminButton>
          }
        >
          {clienteFilter ? (
            <AdminNote>
              Filtrado por {clienteFilter.company || clienteFilter.name} ·{" "}
              <Link className="admin-panel-link" href="/finanzas/por-cobrar">
                Quitar filtro
              </Link>
            </AdminNote>
          ) : null}
          {clienteParam && !clienteFilter && !finance.loading ? <AdminNote>
            No se encontró ese cliente en esta empresa. <Link className="admin-panel-link" href="/finanzas/por-cobrar">Quitar filtro</Link>
          </AdminNote> : null}
          {venceFilter ? (
            <AdminNote>
              Filtrado por antigüedad: {AGING_LABELS[venceFilter].toLowerCase()}.{" "}
              <Link className="admin-panel-link" href="/finanzas/por-cobrar">
                Quitar filtro
              </Link>
            </AdminNote>
          ) : null}
          <AdminDataState
            loading={finance.loading}
            error={finance.error}
            onRetry={finance.reload}
            empty={pendingPayments.length === 0}
            emptyTitle="No hay cobros a plazo" emptyIcon="finance"
            emptyHint="Registrá un cobro con factura y vencimiento para seguir acá cuándo se cobra."
            rows={4}
          >
            {compact ? (
              <AdminCardGrid
                label="Cobros a plazo por cobrar"
                cards={pendingPayments.map((payment): AdminCardData => {
                  const label = payment.client.company || payment.client.name;
                  const emailToday = reminderToday(payment, "email");
                  const whatsappToday = reminderToday(payment, "whatsapp");
                  const emailDoneToday = emailToday?.status === "sent";
                  const budgetProofs = payment.budget ? proofsByBudget[payment.budget.id] ?? [] : [];
                  const dueTone = countdownTone(payment.dueAt);
                  const badges: NonNullable<AdminCardData["badges"]> = [];
                  if (payment.dueAt && dueTone === "danger") {
                    badges.push({ label: "Vencido", tone: "danger", title: `Venció: ${formatCountdown(payment.dueAt)}` });
                  } else if (payment.dueAt && dueTone === "warn") {
                    badges.push({ label: "Por vencer", tone: "warn", title: formatCountdown(payment.dueAt) });
                  }
                  if (emailToday) {
                    badges.push({
                      label: emailToday.status === "sending" ? "Recordatorio en curso" : `${reminderStatusLabel(emailToday.status)} hoy`,
                      tone: reminderStatusTone(emailToday.status),
                      title: reminderCellTitle(payment),
                    });
                  }
                  return {
                    id: payment.id,
                    title: label,
                    titleTooltip: `${label}${payment.budget ? ` · ${payment.budget.title}` : ""}`,
                    subtitle: payment.budget?.title ?? null,
                    badges,
                    fields: [
                      {
                        label: "Vence",
                        value: payment.dueAt ? (
                          <>
                            <span className="admin-nowrap">{formatDateShort(payment.dueAt)}</span>{" "}
                            <AdminCountdown
                              value={payment.dueAt}
                              className="admin-countdown--inline"
                              title={`Cuánto falta para el vencimiento: ${label}`}
                            />
                          </>
                        ) : (
                          "—"
                        ),
                        title: payment.dueAt ? `Vence el ${formatDate(payment.dueAt)} · ${formatCountdown(payment.dueAt)}` : "Sin vencimiento de cobro",
                      },
                      {
                        label: "Factura",
                        value: payment.invoiceNumber ? (
                          <>
                            <span className="admin-code">{payment.invoiceNumber}</span>
                            {payment.invoiceIssuedAt ? (
                              <small className="admin-cell-sub"> · {formatDateShort(payment.invoiceIssuedAt)}</small>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        ),
                        title: payment.invoiceNumber
                          ? `Factura ${payment.invoiceNumber}${payment.invoiceIssuedAt ? ` · emitida el ${formatDate(payment.invoiceIssuedAt)}` : ""}`
                          : "Sin factura emitida",
                      },
                      {
                        label: "Método",
                        value: (
                          <>
                            {payment.method || "—"}
                            {payment.chequeDate ? (
                              <small className="admin-cell-sub"> · cheque {formatDateShort(payment.chequeDate)}</small>
                            ) : null}
                            {payment.treasuryAccount ? (
                              <small className="admin-cell-sub"> · {payment.treasuryAccount.name}</small>
                            ) : null}
                          </>
                        ),
                        title: [
                          payment.chequeDate ? `Cheque del ${formatDate(payment.chequeDate)}` : payment.method || "Sin método",
                          payment.treasuryAccount ? `Entra en ${payment.treasuryAccount.name}` : "Sin cuenta de tesorería asignada",
                        ].join(" · "),
                      },
                      {
                        label: "Monto",
                        value: <strong>{formatMoney(payment.amount)}</strong>,
                        title: `Monto por cobrar ${formatMoney(payment.amount)}`,
                      },
                    ],
                    footer: (
                      <span className="admin-actions">
                        {budgetProofs.length > 0 ? (
                          <AdminButton
                            icon="eye"
                            title={
                              budgetProofs.length === 1
                                ? `Ver el comprobante recibido de ${label}`
                                : `Ver los ${formatNumber(budgetProofs.length)} comprobantes recibidos de ${label}`
                            }
                            aria-label={`Ver los comprobantes recibidos de ${label}`}
                            onClick={() => setProofDialog(payment)}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="mail"
                            busy={reminderBusyId === `email:${payment.id}`}
                            disabled={Boolean(busyId) || Boolean(reminderBusyId) || emailDoneToday || !payment.client.email}
                            title={
                              !payment.client.email
                                ? `Sin correo cargado: ${label}`
                                : emailDoneToday
                                  ? `Ya se envió hoy a ${emailToday?.to}`
                                  : `Recordar por email: ${label}`
                            }
                            aria-label={`Recordar por email: ${label}`}
                            onClick={() => void remindByEmail(payment)}
                          />
                        ) : null}
                        {writable && whatsappReachable(payment.client.phone) ? (
                          <AdminWhatsappTemplateButton
                            title={
                              whatsappToday
                                ? `WhatsApp abierto hoy ${reminderStamp(whatsappToday.sentAt)}: ${label}`
                                : `Enviar por WhatsApp con plantilla: ${label}`
                            }
                            onClick={() => sendWhatsappTemplate(payment)}
                          />
                        ) : null}
                        <AdminButton
                          icon="clock"
                          title={`Historial de recordatorios: ${label}`}
                          aria-label={`Historial de recordatorios: ${label}`}
                          onClick={() => setRemindersFor(payment.id)}
                        />
                        {writable ? (
                          <AdminButton
                            icon="check"
                            busy={busyId === `collect:${payment.id}`}
                            disabled={Boolean(busyId)}
                            title={`Marcar cobrado: ${label}`}
                            aria-label={`Marcar cobrado: ${label}`}
                            onClick={() => openCollect(payment)}
                          >
                            Marcar cobrado
                          </AdminButton>
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="close"
                            disabled={Boolean(busyId)}
                            title={`Anular cobro a plazo: ${label}`}
                            aria-label={`Anular cobro a plazo: ${label}`}
                            onClick={() => closeCollection(payment, "cancel")}
                          />
                        ) : null}
                      </span>
                    ),
                  };
                })}
              />
            ) : (
            <AdminTable
              view="cobros-plazo"
              label="Cobros a plazo por cobrar"
              columns={[
                { label: "Cliente" },
                { label: "Factura" },
                { label: "Vencimiento" },
                { label: "Método" },
                { label: "Recordatorio" },
                { label: "Monto", end: true },
                { label: "Comprobante", end: true },
                { label: "Acciones", end: true },
              ]}
            >
              {pendingPayments.map((payment) => {
                const label = payment.client.company || payment.client.name;
                const emailToday = reminderToday(payment, "email");
                const whatsappToday = reminderToday(payment, "whatsapp");
                const emailDoneToday = emailToday?.status === "sent";
                const budgetProofs = payment.budget ? proofsByBudget[payment.budget.id] ?? [] : [];
                const proofTitle = budgetProofs.length === 1
                  ? `Ver el comprobante recibido de ${label}`
                  : `Ver los ${formatNumber(budgetProofs.length)} comprobantes recibidos de ${label}`;
                return (
                  <AdminRow key={payment.id}>
                    <AdminCell title={`${label}${payment.budget ? ` · ${payment.budget.title}` : ""}`}>
                      <strong>{label}</strong>
                      {payment.budget ? <small className="admin-cell-sub"> · {payment.budget.title}</small> : null}
                    </AdminCell>
                    <AdminCell
                      title={
                        payment.invoiceNumber
                          ? `Factura ${payment.invoiceNumber}${payment.invoiceIssuedAt ? ` · emitida el ${formatDate(payment.invoiceIssuedAt)}` : ""}`
                          : "Sin factura emitida"
                      }
                    >
                      {payment.invoiceNumber ? (
                        <>
                          <span className="admin-code">{payment.invoiceNumber}</span>
                          {payment.invoiceIssuedAt ? (
                            <small className="admin-cell-sub"> · {formatDateShort(payment.invoiceIssuedAt)}</small>
                          ) : null}
                        </>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </AdminCell>
                    <AdminCell
                      title={payment.dueAt ? `Vence el ${formatDate(payment.dueAt)} · ${formatCountdown(payment.dueAt)}` : "Sin vencimiento de cobro"}
                    >
                      <span className="admin-nowrap">{payment.dueAt ? formatDateShort(payment.dueAt) : "—"}</span>
                      <AdminCountdown
                        value={payment.dueAt}
                        className="admin-countdown--inline"
                        title={`Cuánto falta para el vencimiento: ${label}`}
                      />
                    </AdminCell>
                    <AdminCell
                      title={[
                        payment.chequeDate ? `Cheque del ${formatDate(payment.chequeDate)}` : payment.method || "Sin método",
                        payment.treasuryAccount ? `Entra en ${payment.treasuryAccount.name}` : "Sin cuenta de tesorería asignada",
                      ].join(" · ")}
                    >
                      {payment.method || "—"}
                      {payment.chequeDate ? <small className="admin-cell-sub"> · cheque {formatDateShort(payment.chequeDate)}</small> : null}
                      {payment.treasuryAccount ? <small className="admin-cell-sub"> · {payment.treasuryAccount.name}</small> : null}
                    </AdminCell>
                    <AdminCell title={reminderCellTitle(payment)}>
                      {emailToday ? (
                        <AdminBadge tone={reminderStatusTone(emailToday.status)}>
                          {emailToday.status === "sending" ? "En curso" : `${reminderStatusLabel(emailToday.status)} hoy`}
                        </AdminBadge>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </AdminCell>
                    <AdminCell end title={`Monto por cobrar ${formatMoney(payment.amount)}`}>
                      <strong>{formatMoney(payment.amount)}</strong>
                    </AdminCell>
                    <AdminCell end>
                      {budgetProofs.length > 0 ? (
                        <AdminButton
                          icon="eye"
                          title={proofTitle}
                          aria-label={proofTitle}
                          onClick={() => setProofDialog(payment)}
                        />
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      <span className="admin-actions">
                        {writable ? (
                          <AdminButton
                            icon="mail"
                            busy={reminderBusyId === `email:${payment.id}`}
                            disabled={Boolean(busyId) || Boolean(reminderBusyId) || emailDoneToday || !payment.client.email}
                            title={
                              !payment.client.email
                                ? `Sin correo cargado: ${label}`
                                : emailDoneToday
                                  ? `Ya se envió hoy a ${emailToday?.to}`
                                  : `Recordar por email: ${label}`
                            }
                            aria-label={`Recordar por email: ${label}`}
                            onClick={() => void remindByEmail(payment)}
                          />
                        ) : null}
                        {writable && whatsappReachable(payment.client.phone) ? (
                          <AdminWhatsappTemplateButton
                            title={
                              whatsappToday
                                ? `WhatsApp abierto hoy ${reminderStamp(whatsappToday.sentAt)}: ${label}`
                                : `Enviar por WhatsApp con plantilla: ${label}`
                            }
                            onClick={() => sendWhatsappTemplate(payment)}
                          />
                        ) : null}
                        <AdminButton
                          icon="clock"
                          title={`Historial de recordatorios: ${label}`}
                          aria-label={`Historial de recordatorios: ${label}`}
                          onClick={() => setRemindersFor(payment.id)}
                        />
                        {writable ? (
                          <AdminButton
                            icon="check"
                            busy={busyId === `collect:${payment.id}`}
                            disabled={Boolean(busyId)}
                            title={`Marcar cobrado: ${label}`}
                            aria-label={`Marcar cobrado: ${label}`}
                            onClick={() => openCollect(payment)}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="close"
                            disabled={Boolean(busyId)}
                            title={`Anular cobro a plazo: ${label}`}
                            aria-label={`Anular cobro a plazo: ${label}`}
                            onClick={() => closeCollection(payment, "cancel")}
                          />
                        ) : null}
                      </span>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
            )}
            {pendingPayments.length === 0 ? (
              <AdminEmpty icon="search" title="Sin resultados" hint="Ningún cobro a plazo coincide con la búsqueda." />
            ) : null}
          </AdminDataState>
          <FinancePaymentPagination page={finance.data?.pagination?.pending} visible={pendingPayments.length} busy={finance.loading} onChange={page => changePaymentPage("pending", page)} />
        </AdminPanel>

        <AdminPanel
          title="Cobros de clientes" icon="finance"
          meta={`${formatNumber(finance.data?.pagination?.settled.total ?? 0)} movimientos · todos los resultados`}
          action={
            <AdminButton
              icon="download"
              onClick={exportCollections}
              title="Exportar la página visible de cobros a CSV"
              aria-label="Exportar la página visible de cobros a CSV"
            >
              Exportar página CSV
            </AdminButton>
          }
        >
          <AdminDataState
            loading={finance.loading}
            error={finance.error}
            onRetry={finance.reload}
            empty={settledPayments.length === 0}
            emptyTitle="Sin cobros registrados" emptyIcon="finance"
            emptyHint="Registrá el primer cobro para verlo acá con su presupuesto y su fecha real."
            rows={4}
          >
            {compact ? (
              <AdminCardGrid
                label="Cobros de clientes"
                cards={settledPayments.map((payment): AdminCardData => {
                  const collectedAt = payment.collectedAt ?? payment.paidAt;
                  return {
                    id: payment.id,
                    title: payment.client.company || payment.client.name,
                    titleTooltip: `${payment.client.company || payment.client.name}${payment.budget ? ` · ${payment.budget.title}` : ""}`,
                    subtitle: payment.budget?.title ?? null,
                    badges: [{ label: paymentStatusLabel(payment.status), tone: paymentStatusTone(payment.status) }],
                    fields: [
                      {
                        label: "Cobrado",
                        value: collectedAt ? `${formatDateShort(collectedAt)} · ${formatTime(collectedAt)}` : "—",
                        title: collectedAt ? formatDateTime(collectedAt) : "Sin fecha de cobro",
                      },
                      {
                        label: "Monto",
                        value: <strong>{formatMoney(payment.amount)}</strong>,
                        title: formatMoney(payment.amount),
                      },
                      {
                        label: "Método",
                        value: (
                          <>
                            {payment.method || "—"}
                            {payment.treasuryAccount ? (
                              <small className="admin-cell-sub"> · {payment.treasuryAccount.name}</small>
                            ) : null}
                          </>
                        ),
                        title: payment.treasuryAccount
                          ? `Entró en ${payment.treasuryAccount.name}`
                          : `${payment.method || "Sin método"} · sin cuenta de tesorería registrada`,
                      },
                      {
                        label: "Factura",
                        value: payment.invoiceNumber ? <span className="admin-code">{payment.invoiceNumber}</span> : "—",
                        title: payment.invoiceNumber
                          ? `Factura ${payment.invoiceNumber}${payment.reference ? ` · referencia ${payment.reference}` : ""}`
                          : payment.reference || "Sin factura emitida",
                      },
                    ],
                  };
                })}
              />
            ) : (
            <AdminTable
              view="cobros"
              label="Cobros de clientes"
              columns={[
                { label: "Cobrado" },
                { label: "Cliente" },
                { label: "Presupuesto" },
                { label: "Factura" },
                { label: "Monto", end: true },
                { label: "Método" },
                { label: "Referencia" },
                { label: "Estado" },
              ]}
            >
              {settledPayments.map((payment) => {
                const collectedAt = payment.collectedAt ?? payment.paidAt;
                return (
                  <AdminRow key={payment.id}>
                    <AdminCell title={collectedAt ? formatDateTime(collectedAt) : "Sin fecha de cobro"}>
                      {collectedAt ? `${formatDateShort(collectedAt)} · ${formatTime(collectedAt)}` : "—"}
                    </AdminCell>
                    <AdminCell title={payment.client.company || payment.client.name}>
                      {payment.client.company || payment.client.name}
                    </AdminCell>
                    <AdminCell title={payment.budget?.title || "Sin presupuesto asociado"}>{payment.budget?.title || "—"}</AdminCell>
                    <AdminCell title={payment.invoiceNumber ? `Factura ${payment.invoiceNumber}` : "Sin factura emitida"}>
                      <span className="admin-code">{payment.invoiceNumber || "—"}</span>
                    </AdminCell>
                    <AdminCell end title={formatMoney(payment.amount)}>
                      <strong>{formatMoney(payment.amount)}</strong>
                    </AdminCell>
                    <AdminCell
                      title={
                        payment.treasuryAccount
                          ? `Entró en ${payment.treasuryAccount.name}`
                          : `${payment.method || "Sin método"} · sin cuenta de tesorería registrada`
                      }
                    >
                      {payment.method || "—"}
                      {payment.treasuryAccount ? <small className="admin-cell-sub"> · {payment.treasuryAccount.name}</small> : null}
                    </AdminCell>
                    <AdminCell title={payment.reference || "Sin referencia"}>
                      <span className="admin-code">{payment.reference || "—"}</span>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={paymentStatusTone(payment.status)}>{paymentStatusLabel(payment.status)}</AdminBadge>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
            )}
            {settledPayments.length === 0 ? (
              <AdminEmpty icon="search" title="Sin resultados" hint="Ningún cobro coincide con la búsqueda." />
            ) : null}
          </AdminDataState>
          <FinancePaymentPagination received page={finance.data?.pagination?.settled} visible={settledPayments.length} busy={finance.loading} onChange={page => changePaymentPage("settled", page)} />
        </AdminPanel>
        </>
      ) : null}

      {section === "proveedores" ? (
        <AdminPanel
          title="Cuentas por pagar" icon="suppliers"
          meta={`${formatNumber(filteredJobs.length)} trabajos`}
          action={
            <span className="admin-panel-actions">
              <AdminButton
                icon="download"
                onClick={exportPayables}
                title="Exportar las cuentas por pagar filtradas a CSV"
                aria-label="Exportar las cuentas por pagar filtradas a CSV"
              >
                Exportar CSV
              </AdminButton>
              <Link className="admin-panel-link" href="/proveedores">
                Gestionar en Proveedores →
              </Link>
            </span>
          }
        >
          {writable && payJob && payJobRow ? (
            <AdminDialog
              title={`Pago a ${payJobRow.supplier.name}`}
              icon="check"
              description={`${payJobRow.description} · saldo ${formatMoney(supplierJobBalance(payJobRow))}`}
              size="md"
              error={payError}
              dirty={JSON.stringify(payJob) !== JSON.stringify(payJobBase)}
              onClose={() => setPayJob(null)}
              footer={({ requestClose }) => (
                <>
                  <AdminButton icon="close" type="button" disabled={payBusy} onClick={requestClose}>
                    Cancelar
                  </AdminButton>
                  <AdminButton variant="primary" icon="check" type="submit" form={payJobFormId} busy={payBusy} busyLabel="Guardando…" disabled={payBusy}>
                    Registrar pago
                  </AdminButton>
                </>
              )}
            >
              <form id={payJobFormId} className="admin-form" onSubmit={savePayJob} aria-busy={payBusy || undefined}>
                <AdminDialogSection title="Pago">
                <MoneyField
              limit={FIELD_LIMITS.amountStorage}
                  label="Monto del pago"
                  required
                  value={payJob.amount}
                  onChange={(value) => setPayJob({ ...payJob, amount: value })}
                />
                <Combobox
                  label="Cuenta del pago"
                  value={payJob.accountId || defaultAccountId}
                  onChange={(value) => setPayJob({ ...payJob, accountId: value })}
                  placeholder="Cuenta…"
                  options={accountOptions.length > 0 ? accountOptions : [{ value: "", label: "Sin cuentas de tesorería" }]}
                />
                <DateField
                  label="Fecha del pago"
                  value={payJob.date}
                  onChange={(value) => setPayJob({ ...payJob, date: value })}
                />
                <SelectField
                  label="Método del pago"
                  value={payJob.method}
                  onChange={(value) => setPayJob({ ...payJob, method: value })}
                  options={METHOD_SELECT_OPTIONS}
                />
                </AdminDialogSection>
                <AdminDialogSection title="Más opciones" collapsible defaultOpen={Boolean(payJob.receipt)} hint="comprobante">
                <TextField
                  label="Comprobante"
                  optional
                  hint="Número o referencia del comprobante"
                  maxLength={120}
                  value={payJob.receipt}
                  onChange={(value) => setPayJob({ ...payJob, receipt: value })}
                />
                </AdminDialogSection>
              </form>
            </AdminDialog>
          ) : null}

          <AdminDataState
            loading={finance.loading}
            error={finance.error}
            onRetry={finance.reload}
            empty={filteredJobs.length === 0}
            emptyTitle="Sin trabajos de proveedor" emptyIcon="suppliers"
            emptyHint="Los trabajos se cargan y avanzan en Proveedores; acá ves el costo, el anticipo, el saldo y podés pagarlos desde una cuenta."
            rows={4}
          >
            {compact ? (
              <AdminCardGrid
                label="Cuentas por pagar"
                cards={filteredJobs.map((job): AdminCardData => {
                  const balance = supplierJobBalance(job);
                  const settled = job.status === "PAID" || job.status === "CANCELLED";
                  return {
                    id: job.id,
                    title: job.supplier.name,
                    titleTooltip: `${job.supplier.name} · ${job.description}`,
                    subtitle: `${job.description}${job.event ? ` · ${job.event.name}` : ""}`,
                    badges: [{ label: jobStatusLabel(job.status), tone: statusTone(job.status) }],
                    fields: [
                      {
                        label: "Vence",
                        value: job.dueAt ? (
                          <>
                            <span className="admin-nowrap">{formatDateShort(job.dueAt)}</span>{" "}
                            {settled ? null : (
                              <AdminCountdown
                                value={job.dueAt}
                                className="admin-countdown--inline"
                                title={`Cuánto falta para el vencimiento: ${job.description}`}
                              />
                            )}
                          </>
                        ) : (
                          "—"
                        ),
                        title: job.dueAt ? `Vence el ${formatDateShort(job.dueAt)}` : "Sin fecha prevista",
                      },
                      { label: "Total", value: formatMoney(job.total), title: formatMoney(job.total) },
                      { label: "Anticipo", value: formatMoney(job.advance), title: formatMoney(job.advance) },
                      {
                        label: "Saldo",
                        value: <strong>{formatMoney(balance)}</strong>,
                        title: `Saldo ${formatMoney(balance)} · total ${formatMoney(job.total)}`,
                      },
                    ],
                    footer:
                      writable && !settled && balance > 0 ? (
                        <span className="admin-actions">
                          <AdminButton
                            icon="finance"
                            title={`Registrar pago a ${job.supplier.name}: ${job.description} (saldo ${formatMoney(balance)})`}
                            aria-label={`Registrar pago a ${job.supplier.name}: ${job.description}`}
                            disabled={Boolean(payBusy)}
                            onClick={() => openPayJob(job)}
                          >
                            Pagar
                          </AdminButton>
                        </span>
                      ) : null,
                  };
                })}
              />
            ) : (
            <AdminTable
              view="pagar"
              label="Cuentas por pagar"
              columns={[
                { label: "Proveedor" },
                { label: "Trabajo" },
                { label: "Evento" },
                { label: "Vence" },
                { label: "Total", end: true },
                { label: "Anticipo", end: true },
                { label: "Saldo", end: true },
                { label: "Estado" },
                { label: "Acciones", end: true },
              ]}
            >
              {filteredJobs.map((job) => {
                const balance = supplierJobBalance(job);
                const settled = job.status === "PAID" || job.status === "CANCELLED";
                return (
                  <AdminRow key={job.id}>
                    <AdminCell title={job.supplier.name}>
                      <strong>{job.supplier.name}</strong>
                    </AdminCell>
                    <AdminCell title={job.description}>{job.description}</AdminCell>
                    <AdminCell title={job.event?.name || "Sin evento asociado"}>{job.event?.name || "—"}</AdminCell>
                    <AdminCell title={job.dueAt ? `Vence el ${formatDateShort(job.dueAt)}` : "Sin fecha prevista"}>
                      <span className="admin-nowrap">{job.dueAt ? formatDateShort(job.dueAt) : "—"}</span>
                      {settled ? null : (
                        <AdminCountdown
                          value={job.dueAt}
                          className="admin-countdown--inline"
                          title={`Cuánto falta para el vencimiento: ${job.description}`}
                        />
                      )}
                    </AdminCell>
                    <AdminCell end title={formatMoney(job.total)}>
                      {formatMoney(job.total)}
                    </AdminCell>
                    <AdminCell end title={formatMoney(job.advance)}>
                      {formatMoney(job.advance)}
                    </AdminCell>
                    <AdminCell end title={`Saldo ${formatMoney(balance)} · total ${formatMoney(job.total)}`}>
                      <strong>{formatMoney(balance)}</strong>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={statusTone(job.status)}>{jobStatusLabel(job.status)}</AdminBadge>
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      {writable && !settled && balance > 0 ? (
                        <AdminButton
                          icon="finance"
                          title={`Registrar pago a ${job.supplier.name}: ${job.description} (saldo ${formatMoney(balance)})`}
                          aria-label={`Registrar pago a ${job.supplier.name}: ${job.description}`}
                          disabled={Boolean(payBusy)}
                          onClick={() => openPayJob(job)}
                        >
                          Pagar
                        </AdminButton>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
            )}
            {filteredJobs.length === 0 ? <AdminEmpty icon="search" title="Sin resultados" hint="Ningún trabajo coincide con la búsqueda." /> : null}
          </AdminDataState>
        </AdminPanel>
      ) : null}
      {section === "tesoreria" ? (
        <>
        <AdminPanel
          title="Tesorería" icon="wallet"
          meta={`${formatNumber(accounts.length)} cuentas · disponible ${formatMoney(summary.total)}`}
          action={
            writable ? (
              <AdminButton
                icon="plus"
                onClick={() => {
                  setAccountError("");
                  if (showAccountForm && !accountForm.id) {
                    setShowAccountForm(false);
                    return;
                  }
                  setAccountForm(EMPTY_ACCOUNT_FORM);
                  setShowAccountForm(true);
                }}
                aria-expanded={showAccountForm}
                title="Crear una cuenta de tesorería"
              >
                Nueva cuenta
              </AdminButton>
            ) : null
          }
        >
          <AdminKpis state={kpiState(treasury)} className="admin-kpis--treasury" label="Disponible de tesorería">
            <AdminKpi
              label="Disponible en efectivo" icon="wallet"
              value={formatMoney(summary.cash)}
              note={`${formatNumber(accountCounts.CASH ?? 0)} ${accountCounts.CASH === 1 ? "cuenta de efectivo" : "cuentas de efectivo"}`}
              tone={summary.cash > 0 ? "ok" : undefined}
            />
            <AdminKpi
              label="Disponible en banco" icon="bank"
              value={formatMoney(summary.bank)}
              note={`${formatNumber(accountCounts.BANK ?? 0)} ${accountCounts.BANK === 1 ? "cuenta bancaria" : "cuentas bancarias"}`}
            />
            <AdminKpi
              label="Cheques a cobrar" icon="receipt"
              value={formatMoney(summary.cheque)}
              note={`${formatNumber(accountCounts.CHEQUE ?? 0)} ${accountCounts.CHEQUE === 1 ? "cuenta de cheques" : "cuentas de cheques"}`}
              tone={summary.cheque > 0 ? "warn" : undefined}
            />
            <AdminKpi
              label="Total disponible" icon="wallet"
              value={formatMoney(summary.total)}
              note={`${formatNumber(summary.activeAccounts)} activas de ${formatNumber(summary.accounts)}`}
            />
          </AdminKpis>
          <p className="admin-note admin-treasury-formula">
            <AdminIcon name="info" size={14} />
            <span>
              El disponible es el saldo inicial declarado de cada cuenta más los movimientos registrados (entradas, salidas
              y transferencias). Incluye las cuentas inactivas. <strong>No es el saldo bancario real</strong>: ese lo
              confirma el extracto del banco.
            </span>
          </p>

          {writable && showAccountForm ? (
            <AdminDialog
              title={accountForm.id ? `Editar cuenta · ${accountForm.name}` : "Nueva cuenta de tesorería"}
              icon="wallet"
              description="Efectivo, banco o cheques. El saldo inicial es lo que ya había en la cuenta."
              size="md"
              error={accountError}
              dirty={accountDirty}
              onClose={() => {
              setShowAccountForm(false);
              setAccountForm(EMPTY_ACCOUNT_FORM);
              setAccountError("");
            }}
              footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={accountBusy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={accountFormId} busy={accountBusy} busyLabel="Guardando…">
                {accountForm.id ? "Guardar cuenta" : "Crear cuenta"}
              </AdminButton>
            </>
          )}
            >
              <form id={accountFormId} className="admin-form" onSubmit={(event) => void saveAccount(event)} aria-busy={accountBusy || undefined}>
                <AdminDialogSection title="Cuenta">
              <TextField
                label="Nombre"
                required
                autoFocus
                maxLength={120}
                value={accountForm.name}
                onChange={(value) => setAccountForm({ ...accountForm, name: value })}
                placeholder="Efectivo, Ueno Bank, Cheques…"
              />
              <SelectField
                label="Tipo"
                value={accountForm.type}
                onChange={(value) => setAccountForm({ ...accountForm, type: value })}
                options={ACCOUNT_TYPE_OPTIONS}
              />
              {accountForm.type === "BANK" ? (
                <>
                  <TextField
                    label="Banco"
                    hint="Del catálogo del BCP o libre; sin logo versionado se dibuja el monograma"
                    list={BANK_LIST_ID}
                    maxLength={120}
                    value={accountForm.bank}
                    onChange={(value) => setAccountForm({ ...accountForm, bank: value })}
                    placeholder="Ueno Bank"
                  />
                  <datalist id={BANK_LIST_ID}>
                    {bankSuggestions(accountForm.bank).map((banco) => (
                      <option key={banco} value={banco} />
                    ))}
                  </datalist>
                </>
              ) : null}
              <MoneyField
              limit={FIELD_LIMITS.amountStorage}
                label="Saldo inicial"
                hint="Lo que ya había en la cuenta (opcional)"
                value={accountForm.openingBalance}
                onChange={(value) => setAccountForm({ ...accountForm, openingBalance: value })}
                placeholder="0"
              />
                </AdminDialogSection>
                <AdminDialogSection
                  title="Más opciones"
                  collapsible
                  defaultOpen={Boolean(accountForm.id)}
                  hint="número, alias, orden y estado"
                >
              <TextField
                label="Número de cuenta"
                hint="Para transferir; se muestra junto a la cuenta al cobrar"
                maxLength={40}
                value={accountForm.number}
                onChange={(value) => setAccountForm({ ...accountForm, number: value })}
                placeholder="6191649354"
              />
              <TextField
                label="Alias"
                hint="Alternativa al número (opcional)"
                maxLength={60}
                value={accountForm.alias}
                onChange={(value) => setAccountForm({ ...accountForm, alias: value })}
                placeholder="ledbox.cta"
              />
              <NumberField
                label="Orden"
                hint="Menor va primero en las listas"
                maxLength={4}
                value={accountForm.sortOrder}
                onChange={(value) => setAccountForm({ ...accountForm, sortOrder: value })}
                placeholder="0"
              />
              <SwitchField
                label="Activa"
                hint="Solo las activas se ofrecen para movimientos"
                checked={accountForm.active}
                onChange={(checked) => setAccountForm({ ...accountForm, active: checked })}
              />
                </AdminDialogSection>
              </form>
            </AdminDialog>
          ) : null}

          <AdminDataState
            loading={treasury.loading}
            error={treasury.error}
            onRetry={treasury.reload}
            empty={accounts.length === 0}
            emptyTitle="Sin cuentas de tesorería" emptyIcon="wallet"
            emptyHint="Creá la primera cuenta (efectivo, banco o cheques) para ver el disponible real y registrar movimientos."
            rows={3}
          >
            {compact ? (
              <AdminCardGrid
                label="Cuentas de tesorería"
                cards={accounts.map((account): AdminCardData => ({
                  id: account.id,
                  title: account.name,
                  titleTooltip: `Cuenta «${account.name}» · ${account.currency}`,
                  subtitle: account.bank || null,
                  badges: [
                    { label: treasuryAccountTypeLabel(account.type), tone: treasuryAccountTypeTone(account.type) },
                    { label: account.active ? "Activa" : "Inactiva", tone: account.active ? "ok" : "neutral" },
                  ],
                  fields: [
                    {
                      label: "Saldo",
                      value: <strong>{formatMoney(account.balance)}</strong>,
                      title: accountBalanceTitle(account),
                    },
                    {
                      label: "Saldo inicial",
                      value: formatMoney(account.openingBalance),
                      title: `Saldo inicial declarado: ${formatMoney(account.openingBalance)}`,
                    },
                    ...(account.bank ? [{ label: "Banco", value: <BankCell bank={account.bank} />, title: `Banco de la cuenta: ${account.bank}` }] : []),
                    ...(account.number || account.alias
                      ? [
                          {
                            label: "Para transferir",
                            value: <span className="admin-code">{account.number || account.alias}</span>,
                            title: account.number ? `Número de cuenta: ${account.number}` : `Alias: ${account.alias}`,
                          },
                        ]
                      : []),
                  ],
                  footer: (
                    <span className="admin-actions">
                      {writable ? (
                        <AdminButton
                          icon="edit"
                          title={`Editar cuenta: ${account.name}`}
                          aria-label={`Editar cuenta: ${account.name}`}
                          onClick={() => editAccount(account)}
                        />
                      ) : null}
                      {writable ? (
                        <AdminButton
                          icon="power"
                          busy={busyId === `account:${account.id}`}
                          disabled={Boolean(busyId)}
                          title={account.active ? `Desactivar cuenta: ${account.name}` : `Activar cuenta: ${account.name}`}
                          aria-label={account.active ? `Desactivar cuenta: ${account.name}` : `Activar cuenta: ${account.name}`}
                          onClick={() => void toggleAccount(account)}
                        />
                      ) : null}
                    </span>
                  ),
                }))}
              />
            ) : (
            <AdminTable
              view="tesoreria-cuentas"
              label="Cuentas de tesorería"
              columns={[
                { label: "Cuenta" },
                { label: "Tipo" },
                { label: "Banco" },
                { label: "Saldo inicial", end: true },
                { label: "Saldo", end: true },
                { label: "Estado" },
                { label: "Acciones", end: true },
              ]}
            >
              {accounts.map((account) => (
                <AdminRow key={account.id}>
                  <AdminCell title={`Cuenta «${account.name}» · ${account.currency}`}>
                    <strong>{account.name}</strong>
                  </AdminCell>
                  <AdminCell title={treasuryAccountTypeLabel(account.type)}>
                    <AdminBadge tone={treasuryAccountTypeTone(account.type)}>{treasuryAccountTypeLabel(account.type)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={account.bank ? `Banco de la cuenta: ${account.bank}` : "Cuenta sin banco asociado"}>
                    <BankCell bank={account.bank} />
                  </AdminCell>
                  <AdminCell end title={`Saldo inicial declarado: ${formatMoney(account.openingBalance)}`}>
                    {formatMoney(account.openingBalance)}
                  </AdminCell>
                  <AdminCell end title={accountBalanceTitle(account)}>
                    <strong>{formatMoney(account.balance)}</strong>
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={account.active ? "ok" : "neutral"}>{account.active ? "Activa" : "Inactiva"}</AdminBadge>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      {writable ? (
                        <AdminButton
                          icon="edit"
                          title={`Editar cuenta: ${account.name}`}
                          aria-label={`Editar cuenta: ${account.name}`}
                          onClick={() => editAccount(account)}
                        />
                      ) : null}
                      {writable ? (
                        <AdminButton
                          icon="power"
                          busy={busyId === `account:${account.id}`}
                          disabled={Boolean(busyId)}
                          title={account.active ? `Desactivar cuenta: ${account.name}` : `Activar cuenta: ${account.name}`}
                          aria-label={account.active ? `Desactivar cuenta: ${account.name}` : `Activar cuenta: ${account.name}`}
                          onClick={() => void toggleAccount(account)}
                        />
                      ) : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
            )}
          </AdminDataState>
        </AdminPanel>

        <AdminPanel
          title="Movimientos de tesorería" icon="refresh"
          meta={`${formatNumber(movements.length)} en ${periodLabel}`}
          action={
            writable ? (
              <AdminButton
                icon="plus"
                onClick={() => {
                  setMovementError("");
                  if (showMovementForm) {
                    setShowMovementForm(false);
                    return;
                  }
                  setMovementForm({
                    direction: "IN",
                    accountId: defaultAccountId,
                    counterAccountId: "",
                    amount: "",
                    date: todayDayKey(),
                    notes: "",
                  });
                  setShowMovementForm(true);
                }}
                aria-expanded={showMovementForm}
                title="Registrar una entrada, una salida o una transferencia entre cuentas"
              >
                Nuevo movimiento
              </AdminButton>
            ) : null
          }
        >
          {writable && showMovementForm ? (
            <AdminDialog
              title="Nuevo movimiento de tesorería"
              icon="refresh"
              description="Entrada, salida o transferencia entre cuentas; mueve el saldo de las cuentas elegidas."
              size="md"
              error={movementError}
              dirty={movementDirty}
              onClose={() => {
                setShowMovementForm(false);
                setMovementError("");
              }}
              footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={movementBusy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={movementFormId} busy={movementBusy} busyLabel="Guardando…">
                Registrar movimiento
              </AdminButton>
            </>
          )}
            >
              <form id={movementFormId} className="admin-form" onSubmit={(event) => void saveMovement(event)} aria-busy={movementBusy || undefined}>
                <AdminDialogSection title="Cuentas">
              <SelectField
                label="Movimiento"
                value={movementForm.direction}
                onChange={(value) => setMovementForm({ ...movementForm, direction: value })}
                options={DIRECTION_OPTIONS}
              />
              <Combobox
                label={movementForm.direction === "TRANSFER" ? "Cuenta origen" : "Cuenta"}
                required
                value={movementForm.accountId || defaultAccountId}
                onChange={(value) => setMovementForm({ ...movementForm, accountId: value })}
                placeholder="Buscá la cuenta…"
                options={
                  accountOptions.length > 0 ? accountOptions : [{ value: "", label: "Sin cuentas de tesorería" }]
                }
              />
              {movementForm.direction === "TRANSFER" ? (
                <Combobox
                  label="Cuenta destino"
                  required
                  hint="Ej.: un cheque cobrado en efectivo va de Cheques a Efectivo"
                  value={movementForm.counterAccountId}
                  onChange={(value) => setMovementForm({ ...movementForm, counterAccountId: value })}
                  placeholder="Buscá la cuenta destino…"
                  options={accountOptions.filter((option) => option.value !== (movementForm.accountId || defaultAccountId))}
                />
              ) : null}
                </AdminDialogSection>
                <AdminDialogSection title="Importe y fecha">
              <MoneyField
              limit={FIELD_LIMITS.amountStorage}
                label="Monto"
                hint="En guaraníes"
                required
                value={movementForm.amount}
                onChange={(value) => setMovementForm({ ...movementForm, amount: value })}
              />
              <DateField
                label="Fecha"
                required
                value={movementForm.date}
                onChange={(value) => setMovementForm({ ...movementForm, date: value })}
              />
              <TextField
                label="Notas"
                hint="Opcional"
                maxLength={1000}
                value={movementForm.notes}
                onChange={(value) => setMovementForm({ ...movementForm, notes: value })}
                placeholder="Detalle del movimiento"
              />
                </AdminDialogSection>
              </form>
            </AdminDialog>
          ) : null}

          <AdminDataState
            loading={treasury.loading}
            error={treasury.error}
            onRetry={treasury.reload}
            empty={movements.length === 0}
            emptyTitle="Sin movimientos en el período" emptyIcon="refresh"
            emptyHint="Los cobros cobrados, los pagos a proveedores, los gastos y las transferencias aparecen acá con su cuenta."
            rows={4}
          >
            {compact ? (
              <AdminCardGrid
                label="Movimientos de tesorería"
                cards={movements.map((movement): AdminCardData => ({
                  id: movement.id,
                  title: movementRoute(movement),
                  titleTooltip: movementTitle(movement),
                  subtitle: movement.notes || null,
                  badges: [{ label: treasuryDirectionLabel(movement.direction), tone: treasuryDirectionTone(movement.direction) }],
                  fields: [
                    {
                      label: "Fecha",
                      value: formatDateShort(movement.occurredAt),
                      title: `${formatDate(movement.occurredAt)} · registrado por ${movement.createdByName}`,
                    },
                    {
                      label: "Origen",
                      value: (
                        <>
                          {treasuryOriginLabel(movement.origin)}
                          {movement.sourceLabel ? <small className="admin-cell-sub"> · {movement.sourceLabel}</small> : null}
                        </>
                      ),
                      title: movement.sourceLabel
                        ? `${treasuryOriginLabel(movement.origin)}: ${movement.sourceLabel}`
                        : treasuryOriginLabel(movement.origin),
                    },
                    {
                      label: "Monto",
                      value: (
                        <span className="admin-nowrap admin-treasury-delta" data-tone={movementTone(movement)}>
                          {movementAmount(movement)}
                        </span>
                      ),
                      title: movementTitle(movement),
                    },
                  ],
                }))}
              />
            ) : (
            <AdminTable
              view="tesoreria-movimientos"
              label="Movimientos de tesorería"
              columns={[
                { label: "Fecha" },
                { label: "Movimiento" },
                { label: "Cuenta" },
                { label: "Origen" },
                { label: "Notas" },
                { label: "Monto", end: true },
              ]}
            >
              {movements.map((movement) => (
                <AdminRow key={movement.id} tone={movement.direction === "OUT" ? "danger" : undefined}>
                  <AdminCell title={`${formatDate(movement.occurredAt)} · registrado por ${movement.createdByName}`}>
                    <span className="admin-nowrap">{formatDateShort(movement.occurredAt)}</span>
                  </AdminCell>
                  <AdminCell title={treasuryDirectionLabel(movement.direction)}>
                    <AdminBadge tone={treasuryDirectionTone(movement.direction)}>{treasuryDirectionLabel(movement.direction)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={movementTitle(movement)}>
                    <strong>{movementRoute(movement)}</strong>
                  </AdminCell>
                  <AdminCell title={movement.sourceLabel ? `${treasuryOriginLabel(movement.origin)}: ${movement.sourceLabel}` : treasuryOriginLabel(movement.origin)}>
                    {treasuryOriginLabel(movement.origin)}
                    {movement.sourceLabel ? <small className="admin-cell-sub"> · {movement.sourceLabel}</small> : null}
                  </AdminCell>
                  <AdminCell title={movement.notes || "Sin notas"}>
                    {movement.notes || <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell end title={movementTitle(movement)}>
                    <span className="admin-nowrap admin-treasury-delta" data-tone={movementTone(movement)}>
                      {movementAmount(movement)}
                    </span>
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
            )}
          </AdminDataState>
        </AdminPanel>
        </>
      ) : null}

      {section === "conciliacion" ? (
        <ConciliacionBancaria
          accounts={accounts}
          defaultAccountId={defaultAccountId}
          period={period}
          writable={writable}
          onNotice={setNotice}
          onTreasuryChanged={treasury.reload}
        />
      ) : null}

      {section === "gastos" ? (
        <AdminPanel
          title="Gastos" icon="receipt"
          meta={`${formatNumber(filteredExpenses.length)} de ${formatNumber(expenseRows.length)} · ${periodLabel}`}
        >
          <div className="admin-toolbar admin-toolbar--panel">
            <AdminSelect
              value={expenseCategoryFilter}
              onChange={setExpenseCategoryFilter}
              label="Filtrar gastos por categoría"
              options={[{ value: "", label: "Todas las categorías" }, ...CATEGORY_OPTIONS.slice(1)]}
            />
            <AdminSelect
              value={expenseProjectFilter}
              onChange={setExpenseProjectFilter}
              label="Filtrar gastos por proyecto"
              options={[{ value: "", label: "Todos los proyectos" }, { value: "none", label: "Sin proyecto (a definir)" }, ...projectOptions.slice(1)]}
            />
            <AdminSelect
              value={expenseAccountFilter}
              onChange={setExpenseAccountFilter}
              label="Filtrar gastos por cuenta"
              options={[{ value: "", label: "Todas las cuentas" }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
            />
            <span className="admin-export">
              <AdminButton
                icon="download"
                onClick={exportExpenses}
                disabled={filteredExpenses.length === 0}
                title="Exportar los gastos filtrados a CSV"
                aria-label="Exportar los gastos filtrados a CSV"
              >
                Exportar CSV
              </AdminButton>
            </span>
            {writable ? (
              <AdminButton
                icon="plus"
                onClick={() => {
                  setExpenseError("");
                  if (showExpenseForm) {
                    setShowExpenseForm(false);
                    return;
                  }
                  setExpenseForm({ ...expenseForm, amount: "", description: "", date: todayDayKey() });
                  setShowExpenseForm(true);
                }}
                aria-expanded={showExpenseForm}
                title="Cargar un gasto en segundos"
              >
                Nuevo gasto
              </AdminButton>
            ) : null}
          </div>

          {writable && showExpenseForm ? (
            <AdminDialog
              title="Nuevo gasto"
              icon="receipt"
              description="Carga el gasto y genera su egreso en la cuenta elegida. «Guardar y cargar otro» conserva cuenta, categoría y proyecto."
              size="md"
              error={expenseError}
              dirty={expenseDirty}
              onClose={() => setShowExpenseForm(false)}
              footer={({ requestClose }) => (
                <>
                  <AdminButton icon="close" type="button" onClick={requestClose} disabled={expenseBusy}>
                    Cancelar
                  </AdminButton>
                  <AdminButton
                    type="button"
                    icon="plus"
                    disabled={expenseBusy}
                    onClick={() => {
                      // Mismas reglas del envío normal (campos requeridos) antes de guardar.
                      const formNode = document.getElementById(expenseFormId);
                      if (formNode instanceof HTMLFormElement && !formNode.reportValidity()) return;
                      void saveExpense("another");
                    }}
                    title="Guarda el gasto y deja el formulario listo para cargar otro"
                  >
                    Guardar y cargar otro
                  </AdminButton>
                  <AdminButton type="submit" variant="primary" icon="check" form={expenseFormId} busy={expenseBusy} busyLabel="Guardando…">
                    Guardar
                  </AdminButton>
                </>
              )}
            >
              <form
                id={expenseFormId}
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveExpense("close");
                }}
                aria-busy={expenseBusy || undefined}
              >
                <AdminDialogSection title="Gasto">
                  <MoneyField
              limit={FIELD_LIMITS.amountStorage}
                    id={EXPENSE_AMOUNT_ID}
                    label="Monto"
                    hint="En guaraníes"
                    required
                    autoFocus
                    value={expenseForm.amount}
                    onChange={(value) => setExpenseForm({ ...expenseForm, amount: value })}
                    placeholder="Monto"
                  />
                  <TextField
                    label="Descripción"
                    required
                    maxLength={200}
                    value={expenseForm.description}
                    onChange={(value) => setExpenseForm({ ...expenseForm, description: value })}
                    placeholder="Descripción"
                  />
                  <SelectField
                    label="Categoría"
                    required
                    value={expenseForm.category}
                    onChange={(value) => setExpenseForm({ ...expenseForm, category: value })}
                    options={CATEGORY_OPTIONS}
                  />
                  <Combobox
                    label="Cuenta"
                    value={expenseForm.accountId || defaultAccountId}
                    onChange={(value) => setExpenseForm({ ...expenseForm, accountId: value })}
                    placeholder="Cuenta…"
                    options={accountOptions.length > 0 ? accountOptions : [{ value: "", label: "Sin cuentas de tesorería" }]}
                  />
                  <Combobox
                    label="Proyecto"
                    value={expenseForm.eventId}
                    onChange={(value) => setExpenseForm({ ...expenseForm, eventId: value })}
                    placeholder="Proyecto…"
                    options={projectOptions}
                  />
                </AdminDialogSection>
                <AdminDialogSection title="Más opciones" collapsible hint="fecha, proveedor, método, comprobante y notas">
                  <DateField
                    label="Fecha"
                    hint="Por defecto, hoy"
                    value={expenseForm.date}
                    onChange={(value) => setExpenseForm({ ...expenseForm, date: value })}
                  />
                  <Combobox
                    label="Proveedor"
                    value={expenseForm.supplierId}
                    onChange={(value) => setExpenseForm({ ...expenseForm, supplierId: value })}
                    placeholder="Proveedor…"
                    options={supplierOptions}
                  />
                  <SelectField
                    label="Método de pago"
                    value={expenseForm.method}
                    onChange={(value) => setExpenseForm({ ...expenseForm, method: value })}
                    options={METHOD_SELECT_OPTIONS}
                  />
                  <TextField
                    label="Comprobante"
                    hint="Número o referencia (opcional)"
                    maxLength={120}
                    value={expenseForm.receipt}
                    onChange={(value) => setExpenseForm({ ...expenseForm, receipt: value })}
                    placeholder="Comprobante"
                  />
                  <TextField
                    label="Notas"
                    hint="Opcional"
                    maxLength={1000}
                    value={expenseForm.notes}
                    onChange={(value) => setExpenseForm({ ...expenseForm, notes: value })}
                    placeholder="Notas"
                  />
                </AdminDialogSection>
              </form>
            </AdminDialog>
          ) : null}

          <AdminDataState
            loading={expenses.loading}
            error={expenses.error}
            onRetry={expenses.reload}
            empty={filteredExpenses.length === 0}
            emptyTitle={expenseRows.length === 0 ? "Sin gastos en el período" : "Sin resultados"}
            emptyIcon="receipt"
            emptyHint={
              expenseRows.length === 0
                ? "Cargá el primer gasto con monto, descripción y categoría: la cuenta y el proyecto se eligen en la misma fila."
                : "Ningún gasto coincide con los filtros de categoría, proyecto o cuenta."
            }
            rows={4}
          >
            {compact ? (
              <AdminCardGrid
                label="Gastos"
                cards={filteredExpenses.map((expense): AdminCardData => ({
                  id: expense.id,
                  title: expense.description,
                  titleTooltip: [
                    `Gasto del ${formatDate(expense.date)}`,
                    `Registrado por ${expense.createdByName}`,
                    expense.method ? `Método: ${expense.method}` : null,
                    expense.receipt ? `Comprobante: ${expense.receipt}` : null,
                    expense.notes ? `Notas: ${expense.notes}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  subtitle: expense.supplier ? `Proveedor: ${expense.supplier.name}` : expense.notes || null,
                  badges: [{ label: expenseCategoryLabel(expense.category), tone: "neutral" as const }],
                  fields: [
                    { label: "Fecha", value: formatDateShort(expense.date), title: `Gasto del ${formatDate(expense.date)}` },
                    { label: "Cuenta", value: expense.account.name, title: `Cuenta: ${expense.account.name}` },
                    {
                      label: "Proyecto",
                      value: writable ? (
                        <AdminSelect
                          className="admin-filter admin-filter--cell"
                          value={expense.event?.id ?? ""}
                          onChange={(value) => void assignExpenseProject(expense, value)}
                          label={`Proyecto del gasto: ${expense.description}`}
                          title={expense.event ? `Proyecto del gasto: ${expense.event.name}` : "A definir: elegí el proyecto para asociarlo"}
                          disabled={Boolean(busyId)}
                          options={projectOptions}
                        />
                      ) : expense.event ? (
                        expense.event.name
                      ) : (
                        <span className="admin-muted">A definir</span>
                      ),
                      title: expense.event ? `Proyecto: ${expense.event.name}` : "A definir: sin proyecto asociado",
                    },
                    {
                      label: "Monto",
                      value: <strong>{formatMoney(expense.amount)}</strong>,
                      title: `${formatMoney(expense.amount)}${expense.notes ? ` · ${expense.notes}` : ""}`,
                    },
                  ],
                }))}
              />
            ) : (
            <AdminTable
              view="gastos"
              label="Gastos"
              columns={[
                { label: "Fecha" },
                { label: "Descripción" },
                { label: "Categoría" },
                { label: "Proyecto" },
                { label: "Cuenta" },
                { label: "Proveedor" },
                { label: "Monto", end: true },
              ]}
            >
              {filteredExpenses.map((expense) => (
                <AdminRow key={expense.id}>
                  <AdminCell
                    title={[
                      `Gasto del ${formatDate(expense.date)}`,
                      `Registrado por ${expense.createdByName}`,
                      expense.method ? `Método: ${expense.method}` : null,
                      expense.receipt ? `Comprobante: ${expense.receipt}` : null,
                      expense.notes ? `Notas: ${expense.notes}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <span className="admin-nowrap">{formatDateShort(expense.date)}</span>
                  </AdminCell>
                  <AdminCell title={expense.description}>
                    <strong>{expense.description}</strong>
                  </AdminCell>
                  <AdminCell title={expenseCategoryLabel(expense.category)}>
                    <AdminBadge tone="neutral">{expenseCategoryLabel(expense.category)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={expense.event ? `Proyecto: ${expense.event.name}` : "A definir: sin proyecto asociado"}>
                    {writable ? (
                      <AdminSelect
                        className="admin-filter admin-filter--cell"
                        value={expense.event?.id ?? ""}
                        onChange={(value) => void assignExpenseProject(expense, value)}
                        label={`Proyecto del gasto: ${expense.description}`}
                        title={
                          expense.event
                            ? `Proyecto del gasto: ${expense.event.name}`
                            : "A definir: elegí el proyecto para asociarlo"
                        }
                        disabled={Boolean(busyId)}
                        options={projectOptions}
                      />
                    ) : expense.event ? (
                      expense.event.name
                    ) : (
                      <span className="admin-muted">A definir</span>
                    )}
                  </AdminCell>
                  <AdminCell title={`Cuenta: ${expense.account.name}`}>{expense.account.name}</AdminCell>
                  <AdminCell title={expense.supplier ? `Proveedor: ${expense.supplier.name}` : "Sin proveedor"}>
                    {expense.supplier?.name || <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell end title={`${formatMoney(expense.amount)}${expense.notes ? ` · ${expense.notes}` : ""}`}>
                    <strong>{formatMoney(expense.amount)}</strong>
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
            )}
          </AdminDataState>
        </AdminPanel>
      ) : null}


      {reminderDetail ? (
        <PaymentRemindersDialog
          payment={reminderDetail}
          writable={writable}
          busyId={reminderBusyId}
          onEmail={(payment) => void remindByEmail(payment)}
          onTemplate={sendWhatsappTemplate}
          onClose={() => setRemindersFor("")}
        />
      ) : null}

      {simulatedMail ? <AdminSimulatedMailDialog mail={simulatedMail} onClose={() => setSimulatedMail(null)} /> : null}

      {templateTarget ? (
        <MessageTemplateSendDialog
          target={templateTarget}
          onClose={() => setTemplateTarget(null)}
          onRegistered={() => finance.reload()}
        />
      ) : null}

      {proofDialog ? (
        <BudgetProofDialog
          title={`Comprobante · ${proofDialog.client.company || proofDialog.client.name}`}
          subtitle={[
            proofDialog.budget?.title ?? "Sin presupuesto asociado",
            formatMoney(proofDialog.amount),
            "recibido desde el portal; al marcar cobrado el cobro queda cerrado con su auditoría",
          ].join(" · ")}
          proofs={proofDialog.budget ? proofsByBudget[proofDialog.budget.id] ?? [] : []}
          onClose={() => setProofDialog(null)}
          onCollect={writable ? () => void collectFromProofDialog(proofDialog) : undefined}
          collectBusy={busyId === `collect:${proofDialog.id}`}
        />
      ) : null}

      {expectedReview ? (
        <ExpectedReviewDialog
          row={expectedReview.row}
          mode={expectedReview.mode}
          accounts={activeAccounts}
          busy={expectedBusy}
          error={expectedError}
          onViewProof={
            expectedProofOf(expectedReview.row)
              ? () => {
                  const linked = expectedProofOf(expectedReview.row);
                  if (linked) setExpectedProof({ row: expectedReview.row, proof: linked });
                }
              : null
          }
          onSubmit={(payload) => void submitExpectedReview(payload)}
          onClose={() => {
            setExpectedReview(null);
            setExpectedError("");
          }}
        />
      ) : null}

      {expectedSplit ? (
        <ExpectedSplitDialog
          row={expectedSplit}
          busy={expectedBusy}
          error={expectedError}
          onSplit={(parts) => void submitExpectedSplit(parts)}
          onClose={() => {
            setExpectedSplit(null);
            setExpectedError("");
          }}
        />
      ) : null}

      {collectPayment ? (
        <CollectPaymentDialog
          payment={collectPayment}
          accounts={activeAccounts}
          busy={collectBusy}
          error={collectError}
          onCollect={(payload) => void submitCollect(payload)}
          onClose={() => {
            setCollectPayment(null);
            setCollectError("");
          }}
        />
      ) : null}

      {expectedTimeline ? (
        <ExpectedTimelineDialog row={expectedTimeline} onClose={() => setExpectedTimeline(null)} />
      ) : null}

      {expectedProof ? (
        <BudgetProofDialog
          title={`Comprobante · ${expectedPaymentConcept(expectedProof.row)}`}
          subtitle={[
            expectedProof.row.budget.title,
            expectedProof.row.budget.client.company || expectedProof.row.budget.client.name,
            formatMoney(expectedProof.row.amount),
            `subido por ${expectedProof.proof.uploadedByName}`,
          ].join(" · ")}
          proofs={[expectedProof.proof]}
          onClose={() => setExpectedProof(null)}
        />
      ) : null}
    </div>
  );
}
