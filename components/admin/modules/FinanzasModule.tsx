"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  countdownTone,
  DATE_PERIODS,
  datePeriodLabel,
  datePeriodQuery,
  expenseCategoryLabel,
  formatCountdown,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  isTodayAsuncion,
  jobStatusLabel,
  paymentReminderMessage,
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
  whatsappHref,
} from "@/lib/admin-format";
import { csvDay, csvFilename, csvStamp, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import { bankMark } from "@/lib/bank-mark";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import {
  collectedAmount,
  EXPENSE_CATEGORIES,
  groupProofsByBudget,
  isCollectedPayment,
  PAYMENT_METHODS,
  supplierJobBalance,
  TREASURY_ACCOUNT_TYPES,
  type AdminBudgetPaymentProofRow,
  type AdminExpenseRow,
  type AdminPaymentReminder,
  type AdminPaymentRow,
  type AdminReminderRun,
  type AdminSupplierJobRow,
  type AdminTreasuryAccountRow,
  type AdminTreasuryMovementRow,
  type AdminTreasurySummary,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";
import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import { useAdminSession } from "../AdminShell";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminEmpty,
  AdminFormPanel,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { DateField, MoneyField, NumberField, SearchField, SelectField, SwitchField, TextField } from "../AdminFields";
import { adminApiGet, adminSend, useAdminResource } from "@/lib/admin-api";
import { BudgetProofDialog } from "./PresupuestosModule";

/** Métodos de pago del alta directa (catálogo cerrado, espejo del API). */
const METHOD_OPTIONS = [...PAYMENT_METHODS];
/** Un cobro a plazo se cobra por transferencia, efectivo o cheque. */
const TERM_METHOD_OPTIONS = ["Transferencia", "Efectivo", "Cheque"];
/** Plazos ofrecidos en días desde la emisión de la factura (issue #16). */
const TERM_DAY_OPTIONS = ["0", "15", "30", "60"];

const TERM_DAY_LABEL: Record<string, string> = {
  "0": "0 días (contra entrega)",
  "15": "15 días",
  "30": "30 días",
  "60": "60 días",
};

// ── Tesorería y gastos (issue #27) ──────────────────────────────────────────

/** Períodos del filtro compartido de movimientos y gastos. */
const PERIOD_OPTIONS = DATE_PERIODS.map((period) => ({ value: period, label: datePeriodLabel(period) }));
const ACCOUNT_TYPE_OPTIONS = TREASURY_ACCOUNT_TYPES.map((type) => ({ value: type, label: treasuryAccountTypeLabel(type) }));
const CATEGORY_OPTIONS = [
  { value: "", label: "Categoría…" },
  ...EXPENSE_CATEGORIES.map((category) => ({ value: category, label: expenseCategoryLabel(category) })),
];
const METHOD_SELECT_OPTIONS = [{ value: "", label: "Sin especificar" }, ...PAYMENT_METHODS.map((method) => ({ value: method, label: method }))];
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

/** Id del campo de monto de la carga rápida: vuelve el foco al guardar y seguir. */
const EXPENSE_AMOUNT_ID = "gasto-monto";

type AccountForm = {
  id: string;
  name: string;
  type: string;
  bank: string;
  openingBalance: string;
  sortOrder: string;
  active: boolean;
};

const EMPTY_ACCOUNT_FORM: AccountForm = { id: "", name: "", type: "CASH", bank: "", openingBalance: "", sortOrder: "", active: true };

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

/** Banco de una cuenta con su marca (`lib/bank-mark.ts`): asset del repo o monograma. */
function BankCell({ bank }: { bank: string | null }) {
  const mark = bankMark(bank);
  if (!mark) return <span className="admin-muted">—</span>;
  return (
    <span className="admin-treasury-bank" title={`Banco: ${mark.label}`}>
      {mark.asset ? (
        <img className="admin-bank-asset" src={mark.asset} alt={`Logo de ${mark.label}`} />
      ) : (
        <span className="admin-bank-mark" style={{ background: mark.color }} aria-hidden="true">
          {mark.initials}
        </span>
      )}
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

/** Link del mensaje prellenado al teléfono del cliente; `null` sin teléfono válido. */
function paymentWhatsappHref(payment: AdminPaymentRow): string | null {
  return whatsappHref(
    payment.client.phone,
    paymentReminderMessage({
      client: payment.client.company || payment.client.name,
      amount: payment.amount,
      dueAt: payment.dueAt,
      invoiceNumber: payment.invoiceNumber,
      budgetTitle: payment.budget?.title ?? null,
      portalUrl: payment.budget?.publicToken ? portalBudgetUrl(payment.budget.publicToken) : null,
    }),
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
  onWhatsapp,
  onClose,
}: {
  payment: AdminPaymentRow;
  writable: boolean;
  busyId: string;
  onEmail: (payment: AdminPaymentRow) => void;
  onWhatsapp: (payment: AdminPaymentRow) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = payment.client.company || payment.client.name;
  const emailToday = reminderToday(payment, "email");
  const whatsappToday = reminderToday(payment, "whatsapp");
  const whatsappLink = paymentWhatsappHref(payment);
  const reminders = payment.reminders ?? [];
  const emailDoneToday = emailToday?.status === "sent";

  return (
    <div
      className="admin-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="admin-dialog admin-dialog--wide" role="dialog" aria-modal="true" aria-label={`Recordatorios de ${label}`}>
        <header className="admin-dialog-head">
          <h2 className="admin-dialog-title">Recordatorios · {label}</h2>
          <button ref={closeRef} type="button" className="admin-iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
            <AdminIcon name="close" size={15} />
          </button>
        </header>

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
            {whatsappLink ? (
              <a
                className="admin-btn"
                href={whatsappLink}
                target="_blank"
                rel="noreferrer"
                data-done={whatsappToday ? "true" : undefined}
                title={
                  whatsappToday
                    ? `WhatsApp abierto hoy ${reminderStamp(whatsappToday.sentAt)}: ${label}`
                    : `Recordar por WhatsApp: ${label}`
                }
                aria-label={`Recordar por WhatsApp: ${label}`}
                onClick={() => onWhatsapp(payment)}
              >
                <WhatsappIcon size={15} />
                <span>Recordar por WhatsApp</span>
              </a>
            ) : (
              <span className="admin-muted">El cliente no tiene teléfono cargado</span>
            )}
          </div>
        ) : null}

        <p className="admin-dialog-text">
          Historial de recordatorios del cobro (máximo uno por canal y día; los repetidos no se envían de nuevo).
        </p>
        {reminders.length === 0 ? (
          <AdminEmpty title="Sin recordatorios" hint="Todavía no se envió ni abrió ningún recordatorio para este cobro." />
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

        <div className="admin-dialog-foot">
          <span className="admin-dialog-spacer" />
          <AdminButton onClick={onClose}>Cerrar</AdminButton>
        </div>
      </section>
    </div>
  );
}

export function FinanzasModule() {
  const { role } = useAdminSession();
  const finance = useAdminResource("/api/admin/finance", (payload) => ({
    payments: payload.clientPayments ?? [],
    jobs: payload.supplierJobs ?? [],
  }));
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  const budgets = useAdminResource("/api/admin/budgets", (payload) => payload.budgets ?? []);

  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PaymentForm>(EMPTY_PAYMENT_FORM);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  // Recordatorios de cobro (issue #19): envío por email, apertura de WhatsApp y
  // detalle del cobro con su historial.
  const [reminderBusyId, setReminderBusyId] = useState("");
  const [remindersFor, setRemindersFor] = useState("");
  const [runningReminders, setRunningReminders] = useState(false);

  // Comprobantes del portal (issue #17): metadatos por presupuesto y visor del
  // cobro pendiente, con "Marcar cobrado" a un clic.
  const [proofsByBudget, setProofsByBudget] = useState<Record<string, AdminBudgetPaymentProofRow[]>>({});
  const [proofDialog, setProofDialog] = useState<AdminPaymentRow | null>(null);

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
  const [expenseMore, setExpenseMore] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({
    amount: "",
    description: "",
    category: "",
    accountId: "",
    eventId: "",
    date: todayDayKey(),
    supplierId: "",
    method: "",
    receipt: "",
    notes: "",
  });
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [expenseProjectFilter, setExpenseProjectFilter] = useState("");
  const [expenseAccountFilter, setExpenseAccountFilter] = useState("");
  const [payJob, setPayJob] = useState<PayJobForm | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState("");

  const writable = canWriteFinance(role);
  const canRunReminders = role === "OWNER" || role === "ADMIN";
  const payments = useMemo(() => finance.data?.payments ?? [], [finance.data]);
  const jobs = useMemo(() => finance.data?.jobs ?? [], [finance.data]);
  const term = form.mode === "term";

  const accounts = useMemo(() => treasury.data?.accounts ?? [], [treasury.data]);
  const activeAccounts = useMemo(() => accounts.filter((account) => account.active), [accounts]);
  /** Cuenta por defecto de todo lo que sale o entra: la primera activa. */
  const defaultAccountId = activeAccounts[0]?.id ?? "";
  const summary = treasury.data?.summary ?? EMPTY_TREASURY_SUMMARY;
  const movements = useMemo(() => treasury.data?.movements ?? [], [treasury.data]);
  const expenseRows = useMemo(() => expenses.data?.rows ?? [], [expenses.data]);
  const projects = useMemo(() => expenses.data?.projects ?? [], [expenses.data]);
  const expenseSuppliers = useMemo(() => expenses.data?.suppliers ?? [], [expenses.data]);

  const accountOptions = useMemo(
    () => activeAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${treasuryAccountTypeLabel(account.type)}` })),
    [activeAccounts],
  );
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

  const pendingPayments = useMemo(
    () =>
      payments
        .filter((payment) => payment.status === "PENDING")
        .filter((payment) =>
          matchesQuery(query, [
            payment.client.company,
            payment.client.name,
            payment.budget?.title,
            payment.method,
            payment.invoiceNumber,
            payment.reference,
          ]),
        )
        .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999")),
    [payments, query],
  );

  const settledPayments = useMemo(
    () =>
      payments
        .filter((payment) => payment.status !== "PENDING")
        .filter((payment) =>
          matchesQuery(query, [
            payment.client.company,
            payment.client.name,
            payment.budget?.title,
            payment.method,
            payment.reference,
            payment.invoiceNumber,
            paymentStatusLabel(payment.status),
          ]),
        )
        .sort((a, b) =>
          (b.collectedAt ?? b.paidAt ?? "").localeCompare(a.collectedAt ?? a.paidAt ?? ""),
        ),
    [payments, query],
  );

  const filteredJobs = useMemo(
    () => jobs.filter((job) => matchesQuery(query, [job.supplier.name, job.event?.name, job.description, job.status])),
    [jobs, query],
  );

  const totals = useMemo(() => {
    const collected = collectedAmount(payments);
    const collectedCount = payments.filter(isCollectedPayment).length;
    const pending = payments.filter((payment) => payment.status === "PENDING");
    const pendingTotal = pending.reduce((sum, payment) => sum + payment.amount, 0);
    const overdue = pending.filter((payment) => countdownTone(payment.dueAt) === "danger").length;
    const advances = jobs.reduce((sum, job) => sum + job.advance, 0);
    const payable = jobs.reduce((sum, job) => sum + supplierJobBalance(job), 0);
    return { collected, collectedCount, pendingTotal, pendingCount: pending.length, overdue, advances, payable };
  }, [payments, jobs]);

  // Comprobantes del portal (issue #17): una sola consulta de metadatos por
  // carga de finanzas; el visor filtra por el presupuesto del cobro.
  const proofSignature = useMemo(
    () =>
      [
        ...new Set(
          payments
            .map((payment) => payment.budget?.id)
            .filter((id): id is string => Boolean(id)),
        ),
      ].join(","),
    [payments],
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
    const total = settledPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const blocks: CsvBlock[] = [
      {
        title: "Cobros de clientes",
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
          ["", "", "", "", "", "", "Total", total],
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
        title: "Cobros a plazo por cobrar",
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
    setBusy(true);
    setFormError("");
    setNotice(null);
    const payload: Record<string, unknown> = {
      kind: "client",
      clientId: form.clientId,
      budgetId: form.budgetId || undefined,
      amount: Number(form.amount),
      method: form.method || undefined,
      // Cuenta de tesorería del cobro (issue #27): la elegida o la primera activa.
      treasuryAccountId: form.treasuryAccountId || defaultAccountId || undefined,
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
    }
    const result = await adminSend("/api/admin/finance", payload);
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice({ tone: "ok", text: term ? "Cobro a plazo registrado." : "Cobro registrado." });
    setForm({ ...EMPTY_PAYMENT_FORM });
    finance.reload();
  }

  /** Cierra un cobro a plazo: lo cobra (fecha real) o lo anula; el API decide y audita. */
  async function closeCollection(payment: AdminPaymentRow, action: "collect" | "cancel") {
    const label = payment.client.company || payment.client.name;
    setBusyId(`${action}:${payment.id}`);
    setNotice(null);
    setFormError("");
    const result = await adminSend(
      "/api/admin/finance",
      { kind: "client", paymentId: payment.id, action },
      "PATCH",
    );
    setBusyId("");
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setNotice({
      tone: "ok",
      text: action === "collect" ? `Cobro de ${label} marcado como cobrado.` : `Cobro a plazo de ${label} anulado.`,
    });
    finance.reload();
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
    const result = await adminSend<{ reminder?: AdminPaymentReminder; alreadySentToday?: boolean }>(
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
    } else {
      setNotice({ tone: "ok", text: `Recordatorio enviado a ${reminder?.to ?? label} con el link del portal.` });
    }
    finance.reload();
  }

  /** Abre WhatsApp con el mensaje prellenado y deja constancia del día (sin APIs externas). */
  function remindByWhatsapp(payment: AdminPaymentRow) {
    setReminderBusyId(`whatsapp:${payment.id}`);
    void adminSend("/api/admin/reminders", { paymentId: payment.id, channel: "whatsapp" }).then((result) => {
      setReminderBusyId("");
      if (result.ok) finance.reload();
    });
  }

  /** Fuerza la corrida diaria (OWNER/ADMIN): mismo despacho idempotente del primer uso. */
  async function runReminders() {
    setRunningReminders(true);
    setNotice(null);
    const result = await adminSend<{ result?: AdminReminderRun }>("/api/admin/reminders/run", {});
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
      setNotice({
        tone: summary.failed > 0 ? "error" : "ok",
        text: `Recordatorios de hoy: ${parts.join(" · ")} (${formatNumber(summary.candidates)} cobros en la ventana de 7 días).`,
      });
    }
    finance.reload();
  }

  /** "Marcar cobrado" desde el visor del comprobante: cierra el cobro y el diálogo. */
  async function collectFromProofDialog(payment: AdminPaymentRow) {
    await closeCollection(payment, "collect");
    setProofDialog(null);
  }

  // ── Tesorería (issue #27) ─────────────────────────────────────────────────

  /** Guarda una cuenta de tesorería: alta o edición, con auditoría del API. */
  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = accountForm.name.trim();
    setAccountBusy(true);
    setAccountError("");
    setNotice(null);
    const payload: Record<string, unknown> = {
      kind: "account",
      name,
      type: accountForm.type,
      bank: accountForm.type === "BANK" ? accountForm.bank.trim() : undefined,
      openingBalance: Number(accountForm.openingBalance || 0),
      sortOrder: Number(accountForm.sortOrder || 0),
      active: accountForm.active,
    };
    const result = accountForm.id
      ? await adminSend("/api/admin/treasury", { ...payload, accountId: accountForm.id }, "PATCH")
      : await adminSend("/api/admin/treasury", payload);
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
    const result = await adminSend("/api/admin/treasury", payload);
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
    });
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
    const result = await adminSend("/api/admin/expenses", { expenseId: expense.id, eventId: eventId || null }, "PATCH");
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
    setPayJob({
      jobId: job.id,
      accountId: defaultAccountId,
      amount: String(supplierJobBalance(job) || ""),
      date: todayDayKey(),
      method: "",
      receipt: "",
    });
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
    });
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
      <section className="admin-kpis" aria-label="Indicadores de finanzas">
        <AdminKpi
          label="Cobrado a clientes"
          value={formatMoney(totals.collected)}
          note={`${formatNumber(totals.collectedCount)} cobros`}
          tone="ok"
        />
        <AdminKpi
          label="Por cobrar"
          value={formatMoney(totals.pendingTotal)}
          note={pendingMeta}
          tone={totals.overdue > 0 ? "danger" : totals.pendingCount > 0 ? "warn" : undefined}
        />
        <AdminKpi label="Anticipos pagados" value={formatMoney(totals.advances)} note="a proveedores" />
        <AdminKpi
          label="Saldo por pagar"
          value={formatMoney(totals.payable)}
          note={`${formatNumber(jobs.length)} trabajos de proveedor`}
          tone="warn"
        />
      </section>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar movimientos"
          placeholder="Buscar por cliente, proveedor, evento o referencia…"
        />
        <AdminSelect
          value={period}
          onChange={setPeriod}
          label="Período de movimientos y gastos"
          title="Período de la lista de movimientos de tesorería y de los gastos"
          options={PERIOD_OPTIONS}
        />
        <span className="admin-export">
          <Link
            className="admin-btn"
            href="/imprimir/reporte"
            target="_blank"
            rel="noreferrer"
            title="Abrir el reporte mensual imprimible"
            aria-label="Abrir el reporte mensual imprimible"
          >
            <AdminIcon name="print" size={15} />
            <span>Reporte mensual</span>
          </Link>
        </span>
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

      {notice ? <AdminNote tone={notice.tone}>{notice.text}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo cobro de cliente"
          submitLabel={term ? "Registrar cobro a plazo" : "Registrar cobro"}
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <SelectField
            label="Cliente"
            required
            value={form.clientId}
            onChange={(value) => setForm({ ...form, clientId: value, budgetId: "" })}
            options={[
              { value: "", label: "Elegí un cliente…" },
              ...(clients.data ?? []).map((client) => ({ value: client.id, label: client.company || client.name })),
            ]}
          />
          <SelectField
            label="Presupuesto"
            hint="Opcional"
            value={form.budgetId}
            onChange={(value) => setForm({ ...form, budgetId: value })}
            options={[
              { value: "", label: "Sin presupuesto" },
              ...clientBudgets.map((budget) => ({ value: budget.id, label: `${budget.title} · ${formatMoney(budget.total)}` })),
            ]}
          />
          <SelectField
            label="Cuenta de tesorería"
            hint={
              activeAccounts.length > 0
                ? term
                  ? "Donde va a entrar el cobro"
                  : "Donde entra la plata"
                : "Todavía no hay cuentas: el cobro no genera movimiento"
            }
            value={form.treasuryAccountId || defaultAccountId}
            onChange={(value) => setForm({ ...form, treasuryAccountId: value })}
            options={
              accountOptions.length > 0
                ? accountOptions
                : [{ value: "", label: "Sin cuentas de tesorería" }]
            }
          />
          <MoneyField
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
              setForm({
                ...form,
                mode,
                method: mode === "term" && form.method === "Tarjeta" ? "Transferencia" : form.method,
              });
            }}
            options={[
              { value: "now", label: "Cobrado ahora" },
              { value: "term", label: "A plazo (por cobrar)" },
            ]}
          />
          <SelectField
            label="Método"
            value={form.method}
            onChange={(value) => setForm({ ...form, method: value, chequeDate: "" })}
            options={(term ? TERM_METHOD_OPTIONS : METHOD_OPTIONS).map((method) => ({ value: method, label: method }))}
          />
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
            <TextField
              label="Referencia"
              hint="Nº de transferencia o recibo"
              maxLength={120}
              value={form.reference}
              onChange={(value) => setForm({ ...form, reference: value })}
              placeholder="Opcional"
            />
          )}
        </AdminFormPanel>
      ) : null}

      <AdminPanel
        title="Tesorería"
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
        <section className="admin-kpis admin-kpis--treasury" aria-label="Disponible de tesorería">
          <AdminKpi
            label="Disponible en efectivo"
            value={formatMoney(summary.cash)}
            note={`${formatNumber(accountCounts.CASH ?? 0)} ${accountCounts.CASH === 1 ? "cuenta de efectivo" : "cuentas de efectivo"}`}
            tone={summary.cash > 0 ? "ok" : undefined}
          />
          <AdminKpi
            label="Disponible en banco"
            value={formatMoney(summary.bank)}
            note={`${formatNumber(accountCounts.BANK ?? 0)} ${accountCounts.BANK === 1 ? "cuenta bancaria" : "cuentas bancarias"}`}
          />
          <AdminKpi
            label="Cheques a cobrar"
            value={formatMoney(summary.cheque)}
            note={`${formatNumber(accountCounts.CHEQUE ?? 0)} ${accountCounts.CHEQUE === 1 ? "cuenta de cheques" : "cuentas de cheques"}`}
            tone={summary.cheque > 0 ? "warn" : undefined}
          />
          <AdminKpi
            label="Total disponible"
            value={formatMoney(summary.total)}
            note={`${formatNumber(summary.activeAccounts)} activas de ${formatNumber(summary.accounts)}`}
          />
        </section>
        <p className="admin-note admin-treasury-formula">
          <AdminIcon name="info" size={14} />
          <span>
            El disponible es el saldo inicial declarado de cada cuenta más los movimientos registrados (entradas, salidas
            y transferencias). Incluye las cuentas inactivas. <strong>No es el saldo bancario real</strong>: ese lo
            confirma el extracto del banco.
          </span>
        </p>

        {writable && showAccountForm ? (
          <AdminFormPanel
            title={accountForm.id ? `Editar cuenta · ${accountForm.name}` : "Nueva cuenta de tesorería"}
            submitLabel={accountForm.id ? "Guardar cuenta" : "Crear cuenta"}
            onSubmit={saveAccount}
            onCancel={() => {
              setShowAccountForm(false);
              setAccountForm(EMPTY_ACCOUNT_FORM);
              setAccountError("");
            }}
            busy={accountBusy}
            status={accountError}
          >
            <TextField
              label="Nombre"
              required
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
              <TextField
                label="Banco"
                hint="El logo se dibuja con el monograma"
                maxLength={120}
                value={accountForm.bank}
                onChange={(value) => setAccountForm({ ...accountForm, bank: value })}
                placeholder="Ueno Bank"
              />
            ) : null}
            <MoneyField
              label="Saldo inicial"
              hint="Lo que ya había en la cuenta (opcional)"
              value={accountForm.openingBalance}
              onChange={(value) => setAccountForm({ ...accountForm, openingBalance: value })}
              placeholder="0"
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
          </AdminFormPanel>
        ) : null}

        <AdminDataState
          loading={treasury.loading}
          error={treasury.error}
          onRetry={treasury.reload}
          empty={accounts.length === 0}
          emptyTitle="Sin cuentas de tesorería"
          emptyHint="Creá la primera cuenta (efectivo, banco o cheques) para ver el disponible real y registrar movimientos."
          rows={3}
        >
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
                <AdminCell end>
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
        </AdminDataState>
      </AdminPanel>

      <AdminPanel
        title="Movimientos de tesorería"
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
          <AdminFormPanel
            title="Nuevo movimiento de tesorería"
            submitLabel="Registrar movimiento"
            onSubmit={saveMovement}
            onCancel={() => {
              setShowMovementForm(false);
              setMovementError("");
            }}
            busy={movementBusy}
            status={movementError}
          >
            <SelectField
              label="Movimiento"
              value={movementForm.direction}
              onChange={(value) => setMovementForm({ ...movementForm, direction: value })}
              options={DIRECTION_OPTIONS}
            />
            <SelectField
              label={movementForm.direction === "TRANSFER" ? "Cuenta origen" : "Cuenta"}
              required
              value={movementForm.accountId || defaultAccountId}
              onChange={(value) => setMovementForm({ ...movementForm, accountId: value })}
              options={
                accountOptions.length > 0 ? accountOptions : [{ value: "", label: "Sin cuentas de tesorería" }]
              }
            />
            {movementForm.direction === "TRANSFER" ? (
              <SelectField
                label="Cuenta destino"
                required
                hint="Ej.: un cheque cobrado en efectivo va de Cheques a Efectivo"
                value={movementForm.counterAccountId}
                onChange={(value) => setMovementForm({ ...movementForm, counterAccountId: value })}
                options={[
                  { value: "", label: "Elegí la cuenta destino…" },
                  ...accountOptions.filter((option) => option.value !== (movementForm.accountId || defaultAccountId)),
                ]}
              />
            ) : null}
            <MoneyField
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
          </AdminFormPanel>
        ) : null}

        <AdminDataState
          loading={treasury.loading}
          error={treasury.error}
          onRetry={treasury.reload}
          empty={movements.length === 0}
          emptyTitle="Sin movimientos en el período"
          emptyHint="Los cobros cobrados, los pagos a proveedores, los gastos y las transferencias aparecen acá con su cuenta."
          rows={4}
        >
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
        </AdminDataState>
      </AdminPanel>

      <AdminPanel
        title="Gastos"
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
          <form
            className="admin-inline-form admin-inline-form--gastos"
            onSubmit={(event) => {
              event.preventDefault();
              void saveExpense("close");
            }}
            aria-busy={expenseBusy || undefined}
          >
            <span className="admin-gasto-money">
              <MoneyField
                id={EXPENSE_AMOUNT_ID}
                ariaLabel="Monto del gasto"
                required
                value={expenseForm.amount}
                onChange={(value) => setExpenseForm({ ...expenseForm, amount: value })}
                placeholder="Monto"
              />
            </span>
            <span className="admin-gasto-identity">
              <TextField
                ariaLabel="Descripción del gasto"
                title="Descripción del gasto"
                required
                maxLength={200}
                value={expenseForm.description}
                onChange={(value) => setExpenseForm({ ...expenseForm, description: value })}
                placeholder="Descripción"
              />
            </span>
            <SelectField
              ariaLabel="Categoría del gasto"
              required
              value={expenseForm.category}
              onChange={(value) => setExpenseForm({ ...expenseForm, category: value })}
              options={CATEGORY_OPTIONS}
            />
            <SelectField
              ariaLabel="Cuenta del gasto"
              value={expenseForm.accountId || defaultAccountId}
              onChange={(value) => setExpenseForm({ ...expenseForm, accountId: value })}
              options={accountOptions.length > 0 ? accountOptions : [{ value: "", label: "Sin cuentas de tesorería" }]}
            />
            <SelectField
              ariaLabel="Proyecto del gasto"
              value={expenseForm.eventId}
              onChange={(value) => setExpenseForm({ ...expenseForm, eventId: value })}
              options={projectOptions}
            />
            <AdminButton
              icon={expenseMore ? "close" : "plus"}
              onClick={() => setExpenseMore((open) => !open)}
              title={expenseMore ? "Ocultar los campos opcionales" : "Mostrar fecha, proveedor, método, comprobante y notas"}
              aria-expanded={expenseMore}
            >
              {expenseMore ? "Menos" : "Más opciones"}
            </AdminButton>
            {expenseMore ? (
              <>
                <DateField
                  ariaLabel="Fecha del gasto"
                  title="Fecha del gasto (por defecto, hoy)"
                  value={expenseForm.date}
                  onChange={(value) => setExpenseForm({ ...expenseForm, date: value })}
                />
                <SelectField
                  ariaLabel="Proveedor del gasto"
                  value={expenseForm.supplierId}
                  onChange={(value) => setExpenseForm({ ...expenseForm, supplierId: value })}
                  options={supplierOptions}
                />
                <SelectField
                  ariaLabel="Método de pago del gasto"
                  value={expenseForm.method}
                  onChange={(value) => setExpenseForm({ ...expenseForm, method: value })}
                  options={METHOD_SELECT_OPTIONS}
                />
                <TextField
                  ariaLabel="Comprobante del gasto"
                  title="Número o referencia del comprobante (opcional)"
                  maxLength={120}
                  value={expenseForm.receipt}
                  onChange={(value) => setExpenseForm({ ...expenseForm, receipt: value })}
                  placeholder="Comprobante"
                />
                <TextField
                  ariaLabel="Notas del gasto"
                  title="Notas (opcional)"
                  maxLength={1000}
                  value={expenseForm.notes}
                  onChange={(value) => setExpenseForm({ ...expenseForm, notes: value })}
                  placeholder="Notas"
                />
              </>
            ) : null}
            <span className="admin-form-actions">
              <AdminButton type="submit" variant="primary" icon="check" busy={expenseBusy} disabled={expenseBusy}>
                Guardar
              </AdminButton>
              <AdminButton
                type="button"
                icon="plus"
                disabled={expenseBusy}
                onClick={() => void saveExpense("another")}
                title="Guarda el gasto y deja el formulario listo para cargar otro"
              >
                Guardar y cargar otro
              </AdminButton>
            </span>
          </form>
        ) : null}

        {writable && showExpenseForm && expenseError ? <AdminNote tone="error">{expenseError}</AdminNote> : null}

        <AdminDataState
          loading={expenses.loading}
          error={expenses.error}
          onRetry={expenses.reload}
          empty={filteredExpenses.length === 0}
          emptyTitle={expenseRows.length === 0 ? "Sin gastos en el período" : "Sin resultados"}
          emptyHint={
            expenseRows.length === 0
              ? "Cargá el primer gasto con monto, descripción y categoría: la cuenta y el proyecto se eligen en la misma fila."
              : "Ningún gasto coincide con los filtros de categoría, proyecto o cuenta."
          }
          rows={4}
        >
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
        </AdminDataState>
      </AdminPanel>

      <AdminPanel
        title="Por cobrar"
        meta={pendingPayments.length > 0 ? `${formatNumber(pendingPayments.length)} cobros a plazo` : undefined}
        action={
          <AdminButton
            icon="download"
            onClick={exportPendingCollections}
            title="Exportar los cobros a plazo filtrados a CSV"
            aria-label="Exportar los cobros a plazo filtrados a CSV"
          >
            Exportar CSV
          </AdminButton>
        }
      >
        <AdminDataState
          loading={finance.loading}
          error={finance.error}
          onRetry={finance.reload}
          empty={pendingPayments.length === 0}
          emptyTitle="No hay cobros a plazo"
          emptyHint="Registrá un cobro con factura y vencimiento para seguir acá cuándo se cobra."
          rows={4}
        >
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
              const whatsappLink = paymentWhatsappHref(payment);
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
                  <AdminCell end>
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
                      {writable && whatsappLink ? (
                        <a
                          className="admin-iconbtn"
                          href={whatsappLink}
                          target="_blank"
                          rel="noreferrer"
                          data-done={whatsappToday ? "true" : undefined}
                          title={
                            whatsappToday
                              ? `WhatsApp abierto hoy ${reminderStamp(whatsappToday.sentAt)}: ${label}`
                              : `Recordar por WhatsApp: ${label}`
                          }
                          aria-label={`Recordar por WhatsApp: ${label}`}
                          onClick={() => remindByWhatsapp(payment)}
                        >
                          <WhatsappIcon size={15} />
                        </a>
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
                          onClick={() => closeCollection(payment, "collect")}
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
          {pendingPayments.length === 0 ? (
            <AdminEmpty title="Sin resultados" hint="Ningún cobro a plazo coincide con la búsqueda." />
          ) : null}
        </AdminDataState>
      </AdminPanel>

      <AdminPanel
        title="Cobros de clientes"
        meta={`${formatNumber(settledPayments.length)} movimientos`}
        action={
          <AdminButton
            icon="download"
            onClick={exportCollections}
            title="Exportar los cobros filtrados a CSV"
            aria-label="Exportar los cobros filtrados a CSV"
          >
            Exportar CSV
          </AdminButton>
        }
      >
        <AdminDataState
          loading={finance.loading}
          error={finance.error}
          onRetry={finance.reload}
          empty={settledPayments.length === 0}
          emptyTitle="Sin cobros registrados"
          emptyHint="Registrá el primer cobro para verlo acá con su presupuesto y su fecha real."
          rows={4}
        >
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
          {settledPayments.length === 0 ? (
            <AdminEmpty title="Sin resultados" hint="Ningún cobro coincide con la búsqueda." />
          ) : null}
        </AdminDataState>
      </AdminPanel>

      <AdminPanel
        title="Cuentas por pagar"
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
          <form className="admin-inline-form" onSubmit={savePayJob} aria-busy={payBusy || undefined}>
            <span className="admin-note">
              <strong>Pago a {payJobRow.supplier.name}</strong>
              <span className="admin-cell-sub">
                {" "}
                · {payJobRow.description} · saldo {formatMoney(supplierJobBalance(payJobRow))}
              </span>
            </span>
            <span className="admin-pay-amount">
              <MoneyField
                ariaLabel="Monto del pago"
                required
                value={payJob.amount}
                onChange={(value) => setPayJob({ ...payJob, amount: value })}
              />
            </span>
            <SelectField
              ariaLabel="Cuenta del pago"
              value={payJob.accountId || defaultAccountId}
              onChange={(value) => setPayJob({ ...payJob, accountId: value })}
              options={accountOptions.length > 0 ? accountOptions : [{ value: "", label: "Sin cuentas de tesorería" }]}
            />
            <DateField
              ariaLabel="Fecha del pago"
              title="Fecha del pago"
              value={payJob.date}
              onChange={(value) => setPayJob({ ...payJob, date: value })}
            />
            <SelectField
              ariaLabel="Método del pago"
              value={payJob.method}
              onChange={(value) => setPayJob({ ...payJob, method: value })}
              options={METHOD_SELECT_OPTIONS}
            />
            <TextField
              ariaLabel="Comprobante del pago"
              title="Número o referencia del comprobante (opcional)"
              maxLength={120}
              value={payJob.receipt}
              onChange={(value) => setPayJob({ ...payJob, receipt: value })}
              placeholder="Comprobante"
            />
            <AdminButton type="submit" variant="primary" icon="check" busy={payBusy} disabled={payBusy}>
              Registrar pago
            </AdminButton>
            <AdminButton type="button" disabled={payBusy} onClick={() => setPayJob(null)}>
              Cancelar
            </AdminButton>
          </form>
        ) : null}
        {writable && payJob && payError ? <AdminNote tone="error">{payError}</AdminNote> : null}

        <AdminDataState
          loading={finance.loading}
          error={finance.error}
          onRetry={finance.reload}
          empty={filteredJobs.length === 0}
          emptyTitle="Sin trabajos de proveedor"
          emptyHint="Los trabajos se cargan y avanzan en Proveedores; acá ves el costo, el anticipo, el saldo y podés pagarlos desde una cuenta."
          rows={4}
        >
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
                  <AdminCell end>
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
          {filteredJobs.length === 0 ? <AdminEmpty title="Sin resultados" hint="Ningún trabajo coincide con la búsqueda." /> : null}
        </AdminDataState>
      </AdminPanel>

      {reminderDetail ? (
        <PaymentRemindersDialog
          payment={reminderDetail}
          writable={writable}
          busyId={reminderBusyId}
          onEmail={(payment) => void remindByEmail(payment)}
          onWhatsapp={remindByWhatsapp}
          onClose={() => setRemindersFor("")}
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
    </div>
  );
}
