"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectionDueText,
  collectionDueTone,
  dueTone,
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
  whatsappHref,
} from "@/lib/admin-format";
import { csvDay, csvFilename, csvStamp, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import {
  collectedAmount,
  isCollectedPayment,
  supplierJobBalance,
  type AdminPaymentReminder,
  type AdminPaymentRow,
  type AdminReminderRun,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";
import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import { useAdminSession } from "../AdminShell";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminFormPanel,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { DateField, MoneyField, SearchField, SelectField, TextField } from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";

/** Métodos de pago del alta directa (catálogo cerrado, espejo del API). */
const METHOD_OPTIONS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"];
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
              {payment.dueAt ? `${formatDate(payment.dueAt)} · ${collectionDueText(payment.dueAt)}` : "Sin vencimiento"}
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

  const writable = canWriteFinance(role);
  const canRunReminders = role === "OWNER" || role === "ADMIN";
  const payments = useMemo(() => finance.data?.payments ?? [], [finance.data]);
  const jobs = useMemo(() => finance.data?.jobs ?? [], [finance.data]);
  const term = form.mode === "term";
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
    const overdue = pending.filter((payment) => collectionDueTone(payment.dueAt) === "danger").length;
    const advances = jobs.reduce((sum, job) => sum + job.advance, 0);
    const payable = jobs.reduce((sum, job) => sum + supplierJobBalance(job), 0);
    return { collected, collectedCount, pendingTotal, pendingCount: pending.length, overdue, advances, payable };
  }, [payments, jobs]);

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
            collectionDueText(payment.dueAt),
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
              { label: "Acciones", end: true },
            ]}
          >
            {pendingPayments.map((payment) => {
              const label = payment.client.company || payment.client.name;
              const emailToday = reminderToday(payment, "email");
              const whatsappToday = reminderToday(payment, "whatsapp");
              const whatsappLink = paymentWhatsappHref(payment);
              const emailDoneToday = emailToday?.status === "sent";
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
                    title={payment.dueAt ? `Vence el ${formatDate(payment.dueAt)} · ${collectionDueText(payment.dueAt)}` : "Sin vencimiento de cobro"}
                  >
                    <span className="admin-nowrap" data-tone={collectionDueTone(payment.dueAt)}>
                      {payment.dueAt ? formatDateShort(payment.dueAt) : "—"}
                    </span>
                    {payment.dueAt ? <small className="admin-cell-sub"> · {collectionDueText(payment.dueAt)}</small> : null}
                  </AdminCell>
                  <AdminCell title={payment.chequeDate ? `Cheque del ${formatDate(payment.chequeDate)}` : payment.method || "Sin método"}>
                    {payment.method || "—"}
                    {payment.chequeDate ? <small className="admin-cell-sub"> · cheque {formatDateShort(payment.chequeDate)}</small> : null}
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
                  <AdminCell>{payment.method || "—"}</AdminCell>
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
        <AdminDataState
          loading={finance.loading}
          error={finance.error}
          onRetry={finance.reload}
          empty={filteredJobs.length === 0}
          emptyTitle="Sin trabajos de proveedor"
          emptyHint="Los trabajos se cargan y avanzan en Proveedores; acá ves el costo, el anticipo y el saldo."
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
                    <span className="admin-nowrap" data-tone={settled ? undefined : dueTone(job.dueAt)}>
                      {job.dueAt ? formatDateShort(job.dueAt) : "—"}
                    </span>
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
    </div>
  );
}
