"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  invoiceConditionLabel,
  invoiceStatusLabel,
  invoiceTaxTypeLabel,
  purchaseTaxTypeLabel,
  todayDayKey,
} from "@/lib/admin-format";
import { downloadCsv, csvDay, type CsvBlock } from "@/lib/admin-export";
import {
  canManageFiscalProfile,
  canReopenFiscalPeriod,
  canWriteFiscal,
  matchesQuery,
} from "@/lib/admin-policy";
import {
  grossToNet,
  invoiceLineSubtotal,
  invoiceNumberLabel,
  monthKeyLabel,
  monthOf,
  shiftMonthKey,
  taxTotalsOf,
  INVOICE_TAX_TYPES,
  type InvoiceTaxTypeValue,
} from "@/lib/fiscal";
import type {
  AdminBudgetRow,
  AdminClientRow,
  AdminFiscalMonthSummary,
  AdminFiscalPayload,
  AdminFiscalPeriodRow,
  AdminIconName,
  AdminInvoiceRow,
  AdminPurchaseInvoiceRow,
  AdminSupplierRow,
} from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminDialog,
  AdminEmpty,
  AdminIconLink,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import {
  DateField,
  MoneyField,
  NumberField,
  SearchField,
  SegmentedField,
  SelectField,
  TextAreaField,
  TextField,
} from "../AdminFields";
import { AdminIcon } from "../AdminIcons";

/**
 * Facturación (issue #41): registro fiscal interno.
 *
 * Subtabs: **Facturas** (ventas), **Compras** (crédito fiscal), **Libro de IVA**
 * del período con export CSV, **Cierre mensual** y **Datos fiscales** de la
 * empresa. TODO sale del API real (`/api/admin/fiscal`, filtrado por empresa) y
 * los montos son enteros PYG calculados con la misma fuente que el servidor
 * (`lib/fiscal.ts`): el panel solo previsualiza.
 *
 * **Alcance honesto**: no es la factura electrónica de SIFEN/DNIT; el
 * comprobante imprimible lo dice con todas las letras (ver `docs/FISCAL-SIFEN.md`).
 *
 * Permisos: FINANCE/OWNER/ADMIN escriben; VIEWER lee y nunca ve acciones
 * mutantes; el perfil fiscal es de OWNER/ADMIN y la reapertura, solo del OWNER
 * (mismas reglas que revalida el API, server-side).
 */

type FiscalTab = "invoices" | "purchases" | "book" | "period" | "profile";

const FISCAL_TABS: Array<{ value: FiscalTab; label: string; icon: AdminIconName }> = [
  { value: "invoices", label: "Facturas", icon: "receipt" },
  { value: "purchases", label: "Compras", icon: "suppliers" },
  { value: "book", label: "Libro de IVA", icon: "overview" },
  { value: "period", label: "Cierre mensual", icon: "lock" },
  { value: "profile", label: "Datos fiscales", icon: "building" },
];

const EMPTY_SUMMARY: AdminFiscalMonthSummary = {
  sales: { taxable10: 0, iva10: 0, taxable5: 0, iva5: 0, exempt: 0, total: 0, count: 0 },
  purchases: { taxable10: 0, iva10: 0, taxable5: 0, iva5: 0, exempt: 0, total: 0, count: 0 },
  debitIva: 0,
  creditIva: 0,
  balance: 0,
  result: 0,
  counts: { sales: 0, purchases: 0, voided: 0 },
};

const TAX_OPTIONS = INVOICE_TAX_TYPES.map((value) => ({ value, label: invoiceTaxTypeLabel(value) }));

/** Meses ofrecidos por el selector: el actual y los 23 anteriores. */
function monthOptions(current: string): string[] {
  return Array.from({ length: 24 }, (_, index) => shiftMonthKey(current, -index));
}

let lineSeq = 0;
function draftKey(): string {
  lineSeq += 1;
  return `line-${lineSeq}`;
}

type InvoiceDraftItem = { key: string; name: string; quantity: string; unitPrice: string; taxType: InvoiceTaxTypeValue };

type InvoiceForm = {
  source: "manual" | "budget";
  budgetId: string;
  clientId: string;
  clientName: string;
  clientRuc: string;
  condition: "CASH" | "CREDIT";
  issuedAt: string;
  dueAt: string;
  notes: string;
  items: InvoiceDraftItem[];
};

function emptyInvoiceForm(): InvoiceForm {
  return {
    source: "manual",
    budgetId: "",
    clientId: "",
    clientName: "",
    clientRuc: "",
    condition: "CASH",
    issuedAt: todayDayKey(),
    dueAt: "",
    notes: "",
    items: [{ key: draftKey(), name: "", quantity: "1", unitPrice: "", taxType: "IVA10" }],
  };
}

type PurchaseForm = {
  id: string;
  supplierId: string;
  reason: string;
  ruc: string;
  timbrado: string;
  number: string;
  date: string;
  taxType: InvoiceTaxTypeValue;
  total: string;
  concept: string;
};

function emptyPurchaseForm(): PurchaseForm {
  return { id: "", supplierId: "", reason: "", ruc: "", timbrado: "", number: "", date: todayDayKey(), taxType: "IVA10", total: "", concept: "" };
}

type Notice = { tone: "ok" | "error"; text: string };

export function FacturacionModule() {
  const { role, demo } = useAdminSession();
  const [tab, setTab] = useState<FiscalTab>("invoices");
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [query, setQuery] = useState("");

  const fiscal = useAdminResource<AdminFiscalPayload>(`/api/admin/fiscal?month=${month}`, (payload) => ({
    profile: payload.fiscalProfile ?? { ruc: null, razonSocial: null, timbrado: null, establecimiento: null, direccion: null },
    month: payload.month ?? month,
    period: payload.fiscalPeriod ?? null,
    summary: payload.fiscalSummary ?? EMPTY_SUMMARY,
    invoices: payload.invoices ?? [],
    purchases: payload.purchases ?? [],
    periods: payload.fiscalPeriods ?? [],
  }));
  const clients = useAdminResource("/api/admin/clients", (payload) => (payload.clients ?? []) as AdminClientRow[]);
  const budgets = useAdminResource("/api/admin/budgets", (payload) => (payload.budgets ?? []) as AdminBudgetRow[]);
  const suppliers = useAdminResource("/api/admin/suppliers", (payload) => (payload.suppliers ?? []) as AdminSupplierRow[]);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");

  // Alta de factura (manual o desde un presupuesto aprobado).
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm | null>(null);
  const [formError, setFormError] = useState("");
  // Detalle, anulación, saldado y compras.
  const [detail, setDetail] = useState<AdminInvoiceRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<AdminInvoiceRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminPurchaseInvoiceRow | null>(null);
  // Cierre y reapertura.
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  // Datos fiscales.
  const [profileForm, setProfileForm] = useState({ ruc: "", razonSocial: "", timbrado: "", establecimiento: "", direccion: "" });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState("");

  const canWrite = canWriteFiscal(role) && !demo;
  const canProfile = canManageFiscalProfile(role) && !demo;
  const canReopen = canReopenFiscalPeriod(role) && !demo;

  const data = fiscal.data;
  const summary = data?.summary ?? EMPTY_SUMMARY;
  const profile = data?.profile ?? null;
  const period = data?.period ?? null;
  const months = useMemo(() => monthOptions(month), [month]);
  const thisMonth = monthOf(new Date());
  const periodClosed = period?.status === "CLOSED";

  useEffect(() => {
    if (!profile || profileLoaded) return;
    setProfileForm({
      ruc: profile.ruc ?? "",
      razonSocial: profile.razonSocial ?? "",
      timbrado: profile.timbrado ?? "",
      establecimiento: profile.establecimiento ?? "",
      direccion: profile.direccion ?? "",
    });
    setProfileLoaded(true);
  }, [profile, profileLoaded]);

  const invoices = useMemo(
    () => (data?.invoices ?? []).filter((invoice) => matchesQuery(query, [invoice.clientName, invoice.clientRuc, invoiceNumberLabel(invoice.number), invoice.budget?.title])),
    [data?.invoices, query],
  );
  const purchases = useMemo(
    () => (data?.purchases ?? []).filter((purchase) => matchesQuery(query, [purchase.reason, purchase.ruc, purchase.number, purchase.concept])),
    [data?.purchases, query],
  );

  const approvedBudgets = useMemo(() => (budgets.data ?? []).filter((budget) => budget.status === "APPROVED"), [budgets.data]);
  const activeClients = useMemo(() => (clients.data ?? []).filter((client) => client.active), [clients.data]);

  const clientOptions = useMemo(
    () => [
      { value: "", label: "Consumidor final (texto libre)" },
      ...activeClients.map((client) => ({ value: client.id, label: client.company?.trim() || client.name })),
    ],
    [activeClients],
  );

  /** Ítems del borrador con su importe bruto y desagregado (misma regla que el API). */
  const draftLines = useMemo(() => {
    if (!invoiceForm) return [];
    return invoiceForm.items.map((item) => {
      const subtotal = invoiceLineSubtotal(Number(item.quantity || 0), Number(item.unitPrice || 0));
      return { ...item, subtotal, ...grossToNet(subtotal, item.taxType) };
    });
  }, [invoiceForm]);

  const draftTotals = useMemo(
    () => taxTotalsOf(draftLines.map((line) => ({ subtotal: line.subtotal, taxType: line.taxType }))),
    [draftLines],
  );

  const selectedBudget = useMemo(
    () => approvedBudgets.find((budget) => budget.id === invoiceForm?.budgetId) ?? null,
    [approvedBudgets, invoiceForm?.budgetId],
  );

  // ── Acciones ──────────────────────────────────────────────────────────────

  function openInvoice() {
    setFormError("");
    setNotice(null);
    setInvoiceForm(emptyInvoiceForm());
  }

  function openFromBudget(budgetId: string) {
    setFormError("");
    setNotice(null);
    setInvoiceForm({ ...emptyInvoiceForm(), source: "budget", budgetId });
  }

  function updateItem(key: string, patch: Partial<InvoiceDraftItem>) {
    setInvoiceForm((current) =>
      current ? { ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) } : current,
    );
  }

  async function submitInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceForm) return;
    setBusy(true);
    setFormError("");
    const credit = invoiceForm.condition === "CREDIT";
    const payload: Record<string, unknown> =
      invoiceForm.source === "budget"
        ? { kind: "invoice", budgetId: invoiceForm.budgetId, condition: invoiceForm.condition, issuedAt: invoiceForm.issuedAt, dueAt: credit ? invoiceForm.dueAt : null, notes: invoiceForm.notes }
        : {
            kind: "invoice",
            clientId: invoiceForm.clientId || null,
            clientName: invoiceForm.clientName,
            clientRuc: invoiceForm.clientRuc,
            condition: invoiceForm.condition,
            issuedAt: invoiceForm.issuedAt,
            dueAt: credit ? invoiceForm.dueAt : null,
            notes: invoiceForm.notes,
            items: invoiceForm.items.map((item) => ({
              name: item.name,
              quantity: Number(item.quantity || 0),
              unitPrice: Number(item.unitPrice || 0),
              taxType: item.taxType,
            })),
          };
    const result = await adminSend<{ invoice: AdminInvoiceRow }>("/api/admin/fiscal", payload, "POST", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice({ tone: "ok", text: `Factura ${invoiceNumberLabel(result.data.invoice.number)} emitida por ${formatMoney(result.data.invoice.total)}.` });
    setInvoiceForm(null);
    fiscal.reload();
  }

  async function togglePaid(invoice: AdminInvoiceRow) {
    setBusyId(`paid:${invoice.id}`);
    setNotice(null);
    const result = await adminSend(
      "/api/admin/fiscal",
      { kind: "invoice", action: "paid", id: invoice.id, paid: invoice.status !== "PAID" },
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
      text: invoice.status === "PAID"
        ? `Factura ${invoiceNumberLabel(invoice.number)} vuelve a emitida.`
        : `Factura ${invoiceNumberLabel(invoice.number)} marcada como saldada.`,
    });
    fiscal.reload();
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setBusy(true);
    setNotice(null);
    const result = await adminSend(
      "/api/admin/fiscal",
      { kind: "invoice", action: "void", id: voidTarget.id, reason: voidReason },
      "PATCH",
      { idempotencyKey: true },
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      setVoidTarget(null);
      return;
    }
    setNotice({ tone: "ok", text: `Factura ${invoiceNumberLabel(voidTarget.number)} anulada. El número queda en el registro.` });
    setVoidTarget(null);
    setVoidReason("");
    fiscal.reload();
  }

  async function submitPurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purchaseForm) return;
    setBusy(true);
    setFormError("");
    const payload = {
      kind: "purchase",
      ...(purchaseForm.id ? { action: "update", id: purchaseForm.id } : {}),
      supplierId: purchaseForm.supplierId || null,
      reason: purchaseForm.reason,
      ruc: purchaseForm.ruc,
      timbrado: purchaseForm.timbrado,
      number: purchaseForm.number,
      date: purchaseForm.date,
      taxType: purchaseForm.taxType,
      total: Number(purchaseForm.total || 0),
      concept: purchaseForm.concept,
    };
    const result = await adminSend("/api/admin/fiscal", payload, purchaseForm.id ? "PATCH" : "POST", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice({
      tone: "ok",
      text: purchaseForm.id ? `Compra de «${purchaseForm.reason}» actualizada.` : `Compra de «${purchaseForm.reason}» registrada en el libro.`,
    });
    setPurchaseForm(null);
    fiscal.reload();
  }

  async function confirmDeletePurchase() {
    if (!deleteTarget) return;
    setBusy(true);
    setNotice(null);
    const result = await adminSend("/api/admin/fiscal", { kind: "purchase", action: "delete", id: deleteTarget.id }, "PATCH", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      setDeleteTarget(null);
      return;
    }
    setNotice({ tone: "ok", text: `Compra de «${deleteTarget.reason}» borrada del libro.` });
    setDeleteTarget(null);
    fiscal.reload();
  }

  async function closeMonth() {
    setBusy(true);
    setNotice(null);
    const result = await adminSend("/api/admin/fiscal", { kind: "period-close", month }, "POST", { idempotencyKey: true });
    setBusy(false);
    setConfirmClose(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setNotice({ tone: "ok", text: `Mes ${monthKeyLabel(month)} cerrado: las facturas y compras de ese mes quedan bloqueadas.` });
    fiscal.reload();
  }

  async function reopenMonth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const result = await adminSend("/api/admin/fiscal", { kind: "period-reopen", month, reason: reopenReason }, "PATCH", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setReopenOpen(false);
    setReopenReason("");
    setNotice({ tone: "ok", text: `Mes ${monthKeyLabel(month)} reabierto. La reapertura quedó auditada.` });
    fiscal.reload();
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProfileError("");
    const result = await adminSend("/api/admin/fiscal", { kind: "profile", ...profileForm }, "POST", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) {
      setProfileError(result.error);
      return;
    }
    setNotice({ tone: "ok", text: "Datos fiscales guardados: son el encabezado del comprobante imprimible." });
    fiscal.reload();
  }

  /** Export del libro del período: mismos datos y filtros que la pantalla. */
  function exportBook() {
    const blocks: CsvBlock[] = [
      {
        title: `Libro de IVA · ${monthKeyLabel(month)}`,
        header: ["Concepto", "Gravada 10 %", "IVA 10 %", "Gravada 5 %", "IVA 5 %", "Exenta", "Total"],
        rows: [
          ["Ventas", summary.sales.taxable10, summary.sales.iva10, summary.sales.taxable5, summary.sales.iva5, summary.sales.exempt, summary.sales.total],
          ["Compras", summary.purchases.taxable10, summary.purchases.iva10, summary.purchases.taxable5, summary.purchases.iva5, summary.purchases.exempt, summary.purchases.total],
          ["IVA débito (ventas)", "", summary.debitIva, "", "", "", ""],
          ["IVA crédito (compras)", "", summary.creditIva, "", "", "", ""],
          ["Saldo de IVA del período", "", summary.balance, "", "", "", ""],
          ["Resultado (ventas − compras)", "", "", "", "", "", summary.result],
        ],
      },
      {
        title: "Ventas del período (sin anuladas)",
        header: ["Número", "Emisión", "Cliente", "RUC", "Condición", "Gravada 10 %", "IVA 10 %", "Gravada 5 %", "IVA 5 %", "Exenta", "Total", "Estado"],
        rows: (data?.invoices ?? [])
          .filter((invoice) => invoice.status !== "VOID")
          .map((invoice) => [
            invoiceNumberLabel(invoice.number),
            csvDay(invoice.issuedAt),
            invoice.clientName,
            invoice.clientRuc ?? "",
            invoiceConditionLabel(invoice.condition),
            invoice.taxable10,
            invoice.iva10,
            invoice.taxable5,
            invoice.iva5,
            invoice.exempt,
            invoice.total,
            invoiceStatusLabel(invoice.status),
          ]),
      },
      {
        title: "Compras del período",
        header: ["Fecha", "Proveedor", "RUC", "Timbrado", "Número", "Tipo", "Gravada 10 %", "IVA 10 %", "Gravada 5 %", "IVA 5 %", "Exenta", "Total"],
        rows: (data?.purchases ?? []).map((purchase) => [
          csvDay(purchase.date),
          purchase.reason,
          purchase.ruc ?? "",
          purchase.timbrado ?? "",
          purchase.number ?? "",
          purchaseTaxTypeLabel(purchase),
          purchase.taxable10,
          purchase.iva10,
          purchase.taxable5,
          purchase.iva5,
          purchase.exempt,
          purchase.total,
        ]),
      },
    ];
    downloadCsv(`ledbox-libro-iva-${month}.csv`, blocks);
  }

  const bookInvoices = data?.invoices ?? [];
  const bookPurchases = data?.purchases ?? [];
  const history: AdminFiscalPeriodRow[] = data?.periods ?? [];

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Resumen fiscal del período">
        <AdminKpi label="Ventas del mes" icon="receipt" value={formatMoney(summary.sales.total)} note={`${formatNumber(summary.sales.count)} facturas · ${monthKeyLabel(month)}`} />
        <AdminKpi label="IVA a pagar" icon="finance" value={formatMoney(summary.balance)} note={`débito ${formatMoney(summary.debitIva)} − crédito ${formatMoney(summary.creditIva)}`} tone={summary.balance > 0 ? "warn" : undefined} />
        <AdminKpi label="Compras del mes" icon="suppliers" value={formatMoney(summary.purchases.total)} note={`${formatNumber(summary.purchases.count)} comprobantes`} />
        <AdminKpi
          label="Estado del mes" icon="lock"
          value={periodClosed ? "Cerrado" : "Abierto"}
          note={periodClosed ? `${period?.closedByName ?? "—"} · ${formatDateTime(period?.closedAt)}` : "se factura y se editan comprobantes"}
          tone={periodClosed ? "ok" : "warn"}
        />
      </section>

      <nav className="admin-subtabs" aria-label="Secciones de facturación">
        {FISCAL_TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            className="admin-subtab"
            data-active={tab === item.value ? "true" : undefined}
            aria-pressed={tab === item.value}
            onClick={() => {
              setTab(item.value);
              setNotice(null);
              setFormError("");
            }}
          >
            <AdminIcon name={item.icon} size={13} />
            {item.label}
          </button>
        ))}
      </nav>

      {notice ? <AdminNote tone={notice.tone}>{notice.text}</AdminNote> : null}

      <AdminToolbar>
        <AdminSelect
          value={month}
          onChange={(value) => setMonth(value)}
          label="Mes fiscal"
          title="Mes del libro de IVA, las facturas y las compras"
          options={months.map((value) => ({ value, label: monthKeyLabel(value) }))}
        />
        {tab === "invoices" || tab === "purchases" ? (
          <SearchField value={query} onChange={setQuery} label="Buscar comprobantes" placeholder="Buscar por cliente, RUC, número o concepto…" />
        ) : null}
        {tab === "invoices" && canWrite && !periodClosed ? (
          <AdminButton variant="primary" icon="plus" onClick={openInvoice} aria-expanded={invoiceForm !== null}>
            Nueva factura
          </AdminButton>
        ) : null}
        {tab === "purchases" && canWrite && !periodClosed ? (
          <AdminButton variant="primary" icon="plus" onClick={() => { setFormError(""); setPurchaseForm(emptyPurchaseForm()); }} aria-expanded={purchaseForm !== null}>
            Registrar compra
          </AdminButton>
        ) : null}
        {tab === "book" ? (
          <AdminButton icon="download" onClick={exportBook} title="Descargar el libro de IVA del período en CSV" aria-label="Descargar el libro de IVA del período en CSV">
            Exportar CSV
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {tab === "invoices" ? (
        <>
          <AdminPanel
            title="Facturas del período" icon="receipt"
            meta={`${formatNumber(invoices.length)} de ${formatNumber(bookInvoices.length)} · ${formatMoney(summary.sales.total)}`}
          >
            <AdminDataState
              loading={fiscal.loading}
              error={fiscal.error}
              onRetry={fiscal.reload}
              empty={bookInvoices.length === 0}
              emptyTitle="Todavía no hay facturas en este mes" emptyIcon="receipt"
              emptyHint={canWrite ? "Emití la primera desde un presupuesto aprobado o de forma manual." : "Cuando el equipo emita facturas, aparecen acá."}
            >
              {invoices.length === 0 ? (
                <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá de mes." />
              ) : (
                <AdminTable
                  view="facturas"
                  label="Facturas del período"
                  columns={[
                    { label: "Número" },
                    { label: "Emisión" },
                    { label: "Cliente" },
                    { label: "RUC" },
                    { label: "Condición" },
                    { label: "Total" },
                    { label: "IVA" },
                    { label: "Estado" },
                    { label: "Acciones", end: true },
                  ]}
                >
                  {invoices.map((invoice) => (
                    <AdminRow key={invoice.id} tone={invoice.status === "VOID" ? "danger" : undefined}>
                      <AdminCell title={`Factura ${invoiceNumberLabel(invoice.number)}`}>
                        <span className="admin-code admin-nowrap">{invoiceNumberLabel(invoice.number)}</span>
                      </AdminCell>
                      <AdminCell title={formatDate(invoice.issuedAt)}>
                        <span className="admin-nowrap">{formatDate(invoice.issuedAt)}</span>
                      </AdminCell>
                      <AdminCell title={invoice.clientName}>
                        <strong>{invoice.clientName}</strong>
                        <small className="admin-cell-sub"> · {invoice.budget?.title || (invoice.clientId ? "Cliente del panel" : "Consumidor final")}</small>
                      </AdminCell>
                      <AdminCell title={invoice.clientRuc || "Sin RUC"}>
                        <span className="admin-nowrap">{invoice.clientRuc || "—"}</span>
                      </AdminCell>
                      <AdminCell>
                        <AdminBadge tone={invoice.condition === "CREDIT" ? "warn" : "neutral"} title={invoice.dueAt ? `Vence el ${formatDate(invoice.dueAt)}` : "Pago al contado"}>
                          {invoiceConditionLabel(invoice.condition)}
                        </AdminBadge>
                      </AdminCell>
                      <AdminCell title={formatMoney(invoice.total)}>
                        <span className="admin-nowrap">{formatMoney(invoice.total)}</span>
                      </AdminCell>
                      <AdminCell title={`IVA 10 % ${formatMoney(invoice.iva10)} · IVA 5 % ${formatMoney(invoice.iva5)}`}>
                        <span className="admin-nowrap">{formatMoney(invoice.iva10 + invoice.iva5)}</span>
                      </AdminCell>
                      <AdminCell>
                        <AdminBadge tone={invoice.status === "PAID" ? "ok" : invoice.status === "VOID" ? "danger" : "info"}>
                          {invoiceStatusLabel(invoice.status)}
                        </AdminBadge>
                        {invoice.status === "VOID" && invoice.voidedByName ? <small className="admin-cell-sub"> · {invoice.voidedByName}</small> : null}
                      </AdminCell>
                      <AdminCell end className="admin-cell--actions">
                        <span className="admin-actions">
                          <AdminButton
                            icon="eye"
                            title={`Ver el detalle de la factura ${invoiceNumberLabel(invoice.number)}`}
                            aria-label={`Ver el detalle de la factura ${invoiceNumberLabel(invoice.number)}`}
                            onClick={() => setDetail(invoice)}
                          />
                          <AdminIconLink
                            href={`/imprimir/factura/${invoice.id}`}
                            icon="print"
                            label={`Abrir el imprimible de la factura ${invoiceNumberLabel(invoice.number)}`}
                          />
                          {canWrite && !periodClosed && invoice.status !== "VOID" ? (
                            <AdminButton
                              icon={invoice.status === "PAID" ? "refresh" : "check"}
                              busy={busyId === `paid:${invoice.id}`}
                              disabled={Boolean(busyId)}
                              title={invoice.status === "PAID" ? "Volver a emitida" : "Marcar saldada"}
                              aria-label={invoice.status === "PAID" ? `Volver a emitida la factura ${invoiceNumberLabel(invoice.number)}` : `Marcar saldada la factura ${invoiceNumberLabel(invoice.number)}`}
                              onClick={() => void togglePaid(invoice)}
                            />
                          ) : null}
                          {canWrite && !periodClosed && invoice.status === "ISSUED" ? (
                            <AdminButton
                              icon="close"
                              title="Anular la factura con motivo (no se borra)"
                              aria-label={`Anular la factura ${invoiceNumberLabel(invoice.number)}`}
                              onClick={() => {
                                setVoidReason("");
                                setVoidTarget(invoice);
                              }}
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

          {approvedBudgets.length > 0 && canWrite && !periodClosed ? (
            <AdminPanel title="Presupuestos aprobados para facturar" icon="budgets" meta={`${formatNumber(approvedBudgets.length)} aprobados`}>
              <AdminTable
                view="facturables"
                label="Presupuestos aprobados"
                columns={[
                  { label: "Presupuesto" },
                  { label: "Cliente" },
                  { label: "Total" },
                  { label: "Emitir", end: true },
                ]}
              >
                {approvedBudgets.slice(0, 35).map((budget) => (
                  <AdminRow key={budget.id}>
                    <AdminCell title={budget.title}>
                      <strong>{budget.title}</strong>
                    </AdminCell>
                    <AdminCell title={budget.client.company || budget.client.name}>{budget.client.company || budget.client.name}</AdminCell>
                    <AdminCell title={formatMoney(budget.total)}>
                      <span className="admin-nowrap">{formatMoney(budget.total)}</span>
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      <AdminButton
                        icon="receipt"
                        title={`Emitir la factura de «${budget.title}»`}
                        aria-label={`Emitir la factura del presupuesto ${budget.title}`}
                        onClick={() => openFromBudget(budget.id)}
                      />
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            </AdminPanel>
          ) : null}
        </>
      ) : null}

      {tab === "purchases" ? (
        <AdminPanel
          title="Compras del período" icon="suppliers"
          meta={`${formatNumber(purchases.length)} de ${formatNumber(bookPurchases.length)} · ${formatMoney(summary.purchases.total)}`}
        >
          <p className="admin-note">
            El comprobante de compra lo emite el proveedor: acá se carga para el crédito fiscal del libro de IVA. Un
            comprobante que mezcla tasas se registra como una compra por cada tasa.
          </p>
          <AdminDataState
            loading={fiscal.loading}
            error={fiscal.error}
            onRetry={fiscal.reload}
            empty={bookPurchases.length === 0}
            emptyTitle="Todavía no hay compras en este mes" emptyIcon="suppliers"
            emptyHint="Registrá los comprobantes de proveedores para computar el crédito de IVA."
          >
            {purchases.length === 0 ? (
              <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá de mes." />
            ) : (
              <AdminTable
                view="compras"
                label="Compras del período"
                columns={[
                  { label: "Fecha" },
                  { label: "Proveedor" },
                  { label: "RUC" },
                  { label: "Comprobante" },
                  { label: "Tipo" },
                  { label: "Gravada" },
                  { label: "IVA" },
                  { label: "Total" },
                  { label: "Acciones", end: true },
                ]}
              >
                {purchases.map((purchase) => (
                  <AdminRow key={purchase.id}>
                    <AdminCell title={formatDate(purchase.date)}>
                      <span className="admin-nowrap">{formatDate(purchase.date)}</span>
                    </AdminCell>
                    <AdminCell title={purchase.reason}>
                      <strong>{purchase.reason}</strong>
                      {purchase.concept ? <small className="admin-cell-sub"> · {purchase.concept}</small> : null}
                    </AdminCell>
                    <AdminCell title={purchase.ruc || "Sin RUC"}>
                      <span className="admin-nowrap">{purchase.ruc || "—"}</span>
                    </AdminCell>
                    <AdminCell title={[purchase.timbrado ? `Timbrado ${purchase.timbrado}` : null, purchase.number].filter(Boolean).join(" · ")}>
                      <span className="admin-code admin-nowrap">{purchase.number || "—"}</span>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={purchaseTaxTypeLabel(purchase) === "Gravada 10 %" ? "accent" : purchaseTaxTypeLabel(purchase) === "Gravada 5 %" ? "info" : "neutral"}>
                        {purchaseTaxTypeLabel(purchase)}
                      </AdminBadge>
                    </AdminCell>
                    <AdminCell title={formatMoney(purchase.taxable10 + purchase.taxable5)}>
                      <span className="admin-nowrap">{formatMoney(purchase.taxable10 + purchase.taxable5)}</span>
                    </AdminCell>
                    <AdminCell title={`IVA 10 % ${formatMoney(purchase.iva10)} · IVA 5 % ${formatMoney(purchase.iva5)}`}>
                      <span className="admin-nowrap">{formatMoney(purchase.iva10 + purchase.iva5)}</span>
                    </AdminCell>
                    <AdminCell title={formatMoney(purchase.total)}>
                      <span className="admin-nowrap">{formatMoney(purchase.total)}</span>
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      {canWrite && !periodClosed ? (
                        <span className="admin-actions">
                          <AdminButton
                            icon="edit"
                            title={`Editar la compra de «${purchase.reason}»`}
                            aria-label={`Editar la compra de ${purchase.reason}`}
                            onClick={() => {
                              setFormError("");
                              setPurchaseForm({
                                id: purchase.id,
                                supplierId: purchase.supplierId ?? "",
                                reason: purchase.reason,
                                ruc: purchase.ruc ?? "",
                                timbrado: purchase.timbrado ?? "",
                                number: purchase.number ?? "",
                                date: csvDay(purchase.date),
                                taxType: purchase.taxable5 > 0 || purchase.iva5 > 0 ? "IVA5" : purchase.exempt > 0 && purchase.taxable10 === 0 ? "EXEMPT" : "IVA10",
                                total: String(purchase.total),
                                concept: purchase.concept ?? "",
                              });
                            }}
                          />
                          <AdminButton
                            icon="trash"
                            title={`Borrar la compra de «${purchase.reason}»`}
                            aria-label={`Borrar la compra de ${purchase.reason}`}
                            onClick={() => setDeleteTarget(purchase)}
                          />
                        </span>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            )}
          </AdminDataState>
        </AdminPanel>
      ) : null}

      {tab === "book" ? (
        <>
          <AdminPanel title="IVA ventas del período" icon="receipt" meta={`${formatNumber(summary.sales.count)} comprobantes · ${formatMoney(summary.sales.total)}`}>
            {bookInvoices.filter((invoice) => invoice.status !== "VOID").length === 0 ? (
              <AdminEmpty icon="receipt" title="Sin ventas en el período" hint="Emití facturas o cambiá de mes para ver el libro." />
            ) : (
              <AdminTable
                view="libro-ventas"
                label="IVA ventas del período"
                columns={[
                  { label: "Número" },
                  { label: "Fecha" },
                  { label: "Cliente" },
                  { label: "RUC" },
                  { label: "Gravada 10 %" },
                  { label: "IVA 10 %" },
                  { label: "Gravada 5 %" },
                  { label: "IVA 5 %" },
                  { label: "Exenta" },
                  { label: "Total" },
                ]}
              >
                {bookInvoices
                  .filter((invoice) => invoice.status !== "VOID")
                  .map((invoice) => (
                    <AdminRow key={invoice.id}>
                      <AdminCell>
                        <span className="admin-code admin-nowrap">{invoiceNumberLabel(invoice.number)}</span>
                      </AdminCell>
                      <AdminCell>{formatDate(invoice.issuedAt)}</AdminCell>
                      <AdminCell title={invoice.clientName}>{invoice.clientName}</AdminCell>
                      <AdminCell>{invoice.clientRuc || "—"}</AdminCell>
                      <AdminCell>{formatMoney(invoice.taxable10)}</AdminCell>
                      <AdminCell>{formatMoney(invoice.iva10)}</AdminCell>
                      <AdminCell>{formatMoney(invoice.taxable5)}</AdminCell>
                      <AdminCell>{formatMoney(invoice.iva5)}</AdminCell>
                      <AdminCell>{formatMoney(invoice.exempt)}</AdminCell>
                      <AdminCell>
                        <strong>{formatMoney(invoice.total)}</strong>
                      </AdminCell>
                    </AdminRow>
                  ))}
              </AdminTable>
            )}
            {summary.counts.voided > 0 ? (
              <p className="admin-note">
                {formatNumber(summary.counts.voided)} factura{summary.counts.voided === 1 ? "" : "s"} anulada
                {summary.counts.voided === 1 ? "" : "s"} en el período: queda{summary.counts.voided === 1 ? "" : "n"} numerada
                {summary.counts.voided === 1 ? "" : "s"} para la trazabilidad, sin sumar al libro.
              </p>
            ) : null}
          </AdminPanel>

          <AdminPanel title="IVA compras del período" icon="suppliers" meta={`${formatNumber(summary.purchases.count)} comprobantes · ${formatMoney(summary.purchases.total)}`}>
            {bookPurchases.length === 0 ? (
              <AdminEmpty icon="suppliers" title="Sin compras en el período" hint="Cargá los comprobantes de proveedores desde la pestaña Compras." />
            ) : (
              <AdminTable
                view="libro-compras"
                label="IVA compras del período"
                columns={[
                  { label: "Fecha" },
                  { label: "Proveedor" },
                  { label: "RUC" },
                  { label: "Comprobante" },
                  { label: "Gravada 10 %" },
                  { label: "IVA 10 %" },
                  { label: "Gravada 5 %" },
                  { label: "IVA 5 %" },
                  { label: "Exenta" },
                  { label: "Total" },
                ]}
              >
                {bookPurchases.map((purchase) => (
                  <AdminRow key={purchase.id}>
                    <AdminCell>{formatDate(purchase.date)}</AdminCell>
                    <AdminCell title={purchase.reason}>{purchase.reason}</AdminCell>
                    <AdminCell>{purchase.ruc || "—"}</AdminCell>
                    <AdminCell title={purchase.timbrado ? `Timbrado ${purchase.timbrado}` : undefined}>
                      <span className="admin-code admin-nowrap">{purchase.number || "—"}</span>
                    </AdminCell>
                    <AdminCell>{formatMoney(purchase.taxable10)}</AdminCell>
                    <AdminCell>{formatMoney(purchase.iva10)}</AdminCell>
                    <AdminCell>{formatMoney(purchase.taxable5)}</AdminCell>
                    <AdminCell>{formatMoney(purchase.iva5)}</AdminCell>
                    <AdminCell>{formatMoney(purchase.exempt)}</AdminCell>
                    <AdminCell>
                      <strong>{formatMoney(purchase.total)}</strong>
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            )}
          </AdminPanel>

          <AdminPanel title="Resumen del libro" icon="overview" meta={monthKeyLabel(month)}>
            <div className="admin-detail">
              <dl className="admin-detail-grid">
                <div className="admin-detail-item">
                  <dt className="admin-detail-label">IVA débito (ventas)</dt>
                  <dd className="admin-detail-value admin-nowrap">{formatMoney(summary.debitIva)}</dd>
                </div>
                <div className="admin-detail-item">
                  <dt className="admin-detail-label">IVA crédito (compras)</dt>
                  <dd className="admin-detail-value admin-nowrap">{formatMoney(summary.creditIva)}</dd>
                </div>
                <div className="admin-detail-item">
                  <dt className="admin-detail-label">Saldo de IVA del período</dt>
                  <dd className="admin-detail-value admin-nowrap">
                    <strong>{formatMoney(summary.balance)}</strong>
                    <small className="admin-cell-sub"> {summary.balance >= 0 ? "a pagar" : "saldo a favor"}</small>
                  </dd>
                </div>
                <div className="admin-detail-item">
                  <dt className="admin-detail-label">Resultado (ventas − compras)</dt>
                  <dd className="admin-detail-value admin-nowrap">{formatMoney(summary.result)}</dd>
                </div>
              </dl>
              <p className="admin-detail-text">
                Registro fiscal interno: <strong>no reemplaza</strong> la declaración de IVA ni los comprobantes
                electrónicos de SIFEN/DNIT. El libro toma las facturas emitidas del mes (las anuladas quedan afuera) y las
                compras registradas.
              </p>
            </div>
          </AdminPanel>
        </>
      ) : null}

      {tab === "period" ? (
        <>
          <AdminPanel
            title={`Cierre de ${monthKeyLabel(month)}`} icon="lock"
            meta={periodClosed ? "cerrado" : "abierto"}
            action={
              periodClosed
                ? canReopen
                  ? (
                      <AdminButton
                        icon="refresh"
                        title="Reabrir el mes cerrado (solo el propietario, con motivo y auditoría)"
                        aria-label="Reabrir el mes cerrado"
                        onClick={() => {
                          setReopenReason("");
                          setReopenOpen(true);
                        }}
                      >
                        Reabrir mes
                      </AdminButton>
                    )
                  : null
                : canWrite
                  ? (
                      <AdminButton variant="primary" icon="check" disabled={month > thisMonth} onClick={() => setConfirmClose(true)} title={month > thisMonth ? "No se puede cerrar un mes futuro" : "Cerrar el mes y bloquear sus comprobantes"} aria-label="Cerrar el mes">
                        Cerrar mes
                      </AdminButton>
                    )
                  : null
            }
          >
            <section className="admin-kpis" aria-label="Resumen del cierre">
              <AdminKpi label="Ventas" icon="receipt" value={formatMoney(summary.sales.total)} note={`${formatNumber(summary.sales.count)} facturas`} />
              <AdminKpi label="Compras" icon="suppliers" value={formatMoney(summary.purchases.total)} note={`${formatNumber(summary.purchases.count)} comprobantes`} />
              <AdminKpi label="IVA débito" icon="finance" value={formatMoney(summary.debitIva)} note="de las ventas" />
              <AdminKpi label="IVA crédito" icon="finance" value={formatMoney(summary.creditIva)} note="de las compras" />
              <AdminKpi label="Saldo de IVA" icon="finance" value={formatMoney(summary.balance)} note={summary.balance >= 0 ? "a pagar" : "saldo a favor"} tone={summary.balance > 0 ? "warn" : undefined} />
              <AdminKpi label="Resultado" icon="finance" value={formatMoney(summary.result)} note="ventas − compras" />
            </section>
            {periodClosed ? (
              <>
                <p className="admin-note">
                  El mes está <strong>cerrado</strong> desde el {formatDateTime(period?.closedAt)} por {period?.closedByName ?? "—"}. El
                  resumen de arriba es el <strong>snapshot del cierre</strong>: la historia del mes no se reescribe.
                </p>
                {period?.reopenedAt ? (
                  <p className="admin-note">
                    Última reapertura: {formatDateTime(period.reopenedAt)} por {period.reopenedByName ?? "—"}
                    {period.reopenReason ? ` · motivo: ${period.reopenReason}` : ""}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="admin-note">
                Cerrar el mes congela el resumen y <strong>bloquea</strong> la emisión, la anulación, el saldado y las compras
                de {monthKeyLabel(month)}. Se reabre solo con el usuario propietario, con motivo y auditoría.
              </p>
            )}
            <AdminDataState
              loading={fiscal.loading}
              error={fiscal.error}
              onRetry={fiscal.reload}
              empty={false}
              emptyTitle=""
            >
              <AdminTable
                view="cierres"
                label="Historial de cierres mensuales"
                columns={[
                  { label: "Mes" },
                  { label: "Estado" },
                  { label: "Ventas" },
                  { label: "Compras" },
                  { label: "Saldo de IVA" },
                  { label: "Cerrado" },
                  { label: "Reabierto" },
                ]}
              >
                {history.length === 0 ? (
                  <AdminRow>
                    <AdminCell>
                      <span className="admin-muted">Sin cierres registrados todavía.</span>
                    </AdminCell>
                    <AdminCell>{""}</AdminCell>
                    <AdminCell>{""}</AdminCell>
                    <AdminCell>{""}</AdminCell>
                    <AdminCell>{""}</AdminCell>
                    <AdminCell>{""}</AdminCell>
                    <AdminCell>{""}</AdminCell>
                  </AdminRow>
                ) : (
                  history.map((row) => (
                    <AdminRow key={row.id} tone={row.status === "OPEN" ? undefined : "ok"}>
                      <AdminCell>
                        <strong>{monthKeyLabel(row.month)}</strong>
                      </AdminCell>
                      <AdminCell>
                        <AdminBadge tone={row.status === "CLOSED" ? "ok" : "warn"}>{row.status === "CLOSED" ? "Cerrado" : "Abierto"}</AdminBadge>
                      </AdminCell>
                      <AdminCell>{row.summary ? formatMoney(row.summary.sales.total) : "—"}</AdminCell>
                      <AdminCell>{row.summary ? formatMoney(row.summary.purchases.total) : "—"}</AdminCell>
                      <AdminCell>{row.summary ? formatMoney(row.summary.balance) : "—"}</AdminCell>
                      <AdminCell title={formatDateTime(row.closedAt)}>
                        <span className="admin-nowrap">{row.closedAt ? `${formatDate(row.closedAt)} · ${row.closedByName ?? ""}` : "—"}</span>
                      </AdminCell>
                      <AdminCell title={row.reopenReason ?? undefined}>
                        <span className="admin-nowrap">
                          {row.reopenedAt ? `${formatDate(row.reopenedAt)} · ${row.reopenedByName ?? ""}` : "—"}
                        </span>
                      </AdminCell>
                    </AdminRow>
                  ))
                )}
              </AdminTable>
            </AdminDataState>
          </AdminPanel>
        </>
      ) : null}

      {tab === "profile" ? (
        <AdminPanel
          title="Datos fiscales de la empresa" icon="building"
          meta="los edita OWNER/ADMIN"
        >
          <form className="admin-form-grid" onSubmit={saveProfile} aria-busy={busy || undefined}>
            <TextField
              label="RUC"
              value={profileForm.ruc}
              onChange={(value) => setProfileForm({ ...profileForm, ruc: value })}
              maxLength={20}
              disabled={!canProfile}
              placeholder="80012345-6"
              hint="El RUC de la empresa emisora"
            />
            <TextField
              label="Razón social"
              value={profileForm.razonSocial}
              onChange={(value) => setProfileForm({ ...profileForm, razonSocial: value })}
              maxLength={160}
              disabled={!canProfile}
              placeholder="LedBox S.A."
            />
            <TextField
              label="Timbrado"
              value={profileForm.timbrado}
              onChange={(value) => setProfileForm({ ...profileForm, timbrado: value })}
              maxLength={30}
              disabled={!canProfile}
              placeholder="Nº de timbrado"
              hint="El del registro fiscal interno (no es un timbrado autorizado por la DNIT)"
            />
            <TextField
              label="Establecimiento"
              value={profileForm.establecimiento}
              onChange={(value) => setProfileForm({ ...profileForm, establecimiento: value })}
              maxLength={60}
              disabled={!canProfile}
              placeholder="Casa central"
            />
            <TextField
              label="Dirección"
              wide
              value={profileForm.direccion}
              onChange={(value) => setProfileForm({ ...profileForm, direccion: value })}
              maxLength={160}
              disabled={!canProfile}
              placeholder="Av. Mcal. López 1234, Asunción"
            />
            {profileError ? <AdminNote tone="error">{profileError}</AdminNote> : null}
            {canProfile ? (
              <div className="admin-form-actions admin-field--wide">
                <AdminButton type="submit" variant="primary" icon="check" busy={busy}>
                  Guardar datos fiscales
                </AdminButton>
              </div>
            ) : null}
          </form>
          <p className="admin-note">
            El comprobante imprimible de este registro interno aclara que <strong>no es una factura electrónica</strong> ni
            reemplaza al comprobante de SIFEN/DNIT. Ver el detalle de lo que falta en <span className="admin-code">docs/FISCAL-SIFEN.md</span>.
          </p>
        </AdminPanel>
      ) : null}

      {invoiceForm ? (
        <AdminDialog title="Nueva factura" size="wide" icon="receipt" onClose={() => setInvoiceForm(null)}>
          <form className="admin-form-grid" onSubmit={submitInvoice} aria-busy={busy || undefined}>
            <SegmentedField
              label="Origen"
              wide
              value={invoiceForm.source}
              onChange={(value) =>
                setInvoiceForm({
                  ...invoiceForm,
                  source: value === "budget" ? "budget" : "manual",
                  budgetId: "",
                  items: value === "budget" ? [] : invoiceForm.items.length > 0 ? invoiceForm.items : emptyInvoiceForm().items,
                })
              }
              options={[
                { value: "manual", label: "Carga manual" },
                { value: "budget", label: "Desde un presupuesto aprobado" },
              ]}
              hint="Desde un presupuesto, las líneas salen de sus ítems y el receptor, de su cliente."
            />

            {invoiceForm.source === "budget" ? (
              <SelectField
                label="Presupuesto aprobado"
                wide
                required
                value={invoiceForm.budgetId}
                onChange={(value) => setInvoiceForm({ ...invoiceForm, budgetId: value })}
                options={[
                  { value: "", label: approvedBudgets.length > 0 ? "Elegí el presupuesto…" : "No hay presupuestos aprobados" },
                  ...approvedBudgets.map((budget) => ({
                    value: budget.id,
                    label: `${budget.title} · ${budget.client.company || budget.client.name} · ${formatMoney(budget.total)}`,
                  })),
                ]}
                hint={selectedBudget ? "Las líneas del presupuesto entran como ítems de la factura (IVA 10 % por defecto, ajustable después)." : undefined}
              />
            ) : (
              <>
                <SelectField
                  label="Cliente"
                  value={invoiceForm.clientId}
                  onChange={(value) => {
                    const client = activeClients.find((candidate) => candidate.id === value);
                    setInvoiceForm({
                      ...invoiceForm,
                      clientId: value,
                      clientName: client ? client.company?.trim() || client.name : "",
                      clientRuc: client?.ruc ?? "",
                    });
                  }}
                  options={clientOptions}
                  hint="Elegí uno del panel o cargá el receptor a mano"
                />
                <TextField
                  label="Razón social del receptor"
                  required
                  value={invoiceForm.clientName}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, clientName: value })}
                  maxLength={160}
                  placeholder="Eventos del Sur S.A."
                />
                <TextField
                  label="RUC del receptor"
                  value={invoiceForm.clientRuc}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, clientRuc: value })}
                  maxLength={20}
                  placeholder="80098765-4 (opcional)"
                  hint="Sin RUC queda como consumidor final"
                />
              </>
            )}

            <SegmentedField
              label="Condición"
              value={invoiceForm.condition}
              onChange={(value) =>
                setInvoiceForm({ ...invoiceForm, condition: value === "CREDIT" ? "CREDIT" : "CASH", dueAt: value === "CREDIT" ? invoiceForm.dueAt : "" })
              }
              options={[
                { value: "CASH", label: "Contado" },
                { value: "CREDIT", label: "Crédito" },
              ]}
            />
            <DateField label="Emisión" required value={invoiceForm.issuedAt} onChange={(value) => setInvoiceForm({ ...invoiceForm, issuedAt: value })} />
            {invoiceForm.condition === "CREDIT" ? (
              <DateField
                label="Vencimiento"
                required
                value={invoiceForm.dueAt}
                onChange={(value) => setInvoiceForm({ ...invoiceForm, dueAt: value })}
                hint="No puede ser anterior a la emisión"
              />
            ) : null}
            <TextAreaField
              label="Notas"
              wide
              rows={2}
              maxLength={1000}
              value={invoiceForm.notes}
              onChange={(value) => setInvoiceForm({ ...invoiceForm, notes: value })}
              placeholder="Observaciones internas del comprobante (opcional)"
            />

            {invoiceForm.source === "manual" ? (
              <div className="admin-field admin-field--wide admin-fiscal-lines">
                <span className="admin-field-label">Ítems (importes brutos, IVA incluido)</span>
                {invoiceForm.items.map((item) => {
                  const line = draftLines.find((candidate) => candidate.key === item.key);
                  return (
                    <div className="admin-fiscal-line" key={item.key}>
                      <TextField
                        label="Producto o servicio"
                        required
                        value={item.name}
                        onChange={(value) => updateItem(item.key, { name: value })}
                        maxLength={160}
                        placeholder="Alquiler de pantalla LED"
                      />
                      <NumberField label="Cantidad" required value={item.quantity} onChange={(value) => updateItem(item.key, { quantity: value })} maxLength={6} />
                      <MoneyField label="Precio unitario" required value={item.unitPrice} onChange={(value) => updateItem(item.key, { unitPrice: value })} hint="IVA incluido" />
                      <SelectField label="IVA" value={item.taxType} onChange={(value) => updateItem(item.key, { taxType: value as InvoiceTaxTypeValue })} options={TAX_OPTIONS} />
                      <div className="admin-fiscal-line-sum">
                        <span className="admin-field-label">Importe</span>
                        <strong className="admin-nowrap">{formatMoney(line?.subtotal ?? 0)}</strong>
                        <small className="admin-cell-sub">
                          {formatMoney(line?.taxable ?? 0)} + IVA {formatMoney(line?.taxAmount ?? 0)}
                        </small>
                      </div>
                      <AdminButton
                        type="button"
                        icon="trash"
                        disabled={invoiceForm.items.length <= 1}
                        title="Quitar el ítem"
                        aria-label="Quitar el ítem"
                        onClick={() => setInvoiceForm({ ...invoiceForm, items: invoiceForm.items.filter((candidate) => candidate.key !== item.key) })}
                      />
                    </div>
                  );
                })}
                <AdminButton
                  type="button"
                  icon="plus"
                  onClick={() => setInvoiceForm({ ...invoiceForm, items: [...invoiceForm.items, { key: draftKey(), name: "", quantity: "1", unitPrice: "", taxType: "IVA10" }] })}
                  disabled={invoiceForm.items.length >= 50}
                >
                  Agregar ítem
                </AdminButton>
              </div>
            ) : null}

            <div className="admin-field admin-field--wide admin-fiscal-totals">
              <span className="admin-field-label">Totales de la factura</span>
              <div className="admin-fiscal-total-row">
                <span>Gravada 10 %</span>
                <span className="admin-nowrap">{formatMoney(draftTotals.taxable10)}</span>
                <span className="admin-nowrap">IVA {formatMoney(draftTotals.iva10)}</span>
              </div>
              <div className="admin-fiscal-total-row">
                <span>Gravada 5 %</span>
                <span className="admin-nowrap">{formatMoney(draftTotals.taxable5)}</span>
                <span className="admin-nowrap">IVA {formatMoney(draftTotals.iva5)}</span>
              </div>
              <div className="admin-fiscal-total-row">
                <span>Exenta</span>
                <span className="admin-nowrap">{formatMoney(draftTotals.exempt)}</span>
                <span />
              </div>
              <div className="admin-fiscal-total-row admin-fiscal-total-row--strong">
                <span>Total</span>
                <span className="admin-nowrap">{formatMoney(draftTotals.total)}</span>
                <span className="admin-cell-sub">{draftTotals.count} ítems</span>
              </div>
            </div>

            {formError ? <AdminNote tone="error">{formError}</AdminNote> : null}

            <div className="admin-dialog-foot admin-field--wide">
              <span className="admin-dialog-spacer" />
              <AdminButton icon="close" type="button" onClick={() => setInvoiceForm(null)} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="receipt" busy={busy}>
                Emitir factura
              </AdminButton>
            </div>
          </form>
        </AdminDialog>
      ) : null}

      {detail ? (
        <AdminDialog title={`Factura ${invoiceNumberLabel(detail.number)}`} size="wide" icon="receipt" onClose={() => setDetail(null)}>
          <div className="admin-detail">
            <dl className="admin-detail-grid">
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Receptor</dt>
                <dd className="admin-detail-value">{detail.clientName}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">RUC</dt>
                <dd className="admin-detail-value admin-nowrap">{detail.clientRuc || "—"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Emisión</dt>
                <dd className="admin-detail-value">{formatDate(detail.issuedAt)}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Vencimiento</dt>
                <dd className="admin-detail-value">{detail.dueAt ? formatDate(detail.dueAt) : "Contado"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Condición</dt>
                <dd className="admin-detail-value">{invoiceConditionLabel(detail.condition)}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Estado</dt>
                <dd className="admin-detail-value">
                  <AdminBadge tone={detail.status === "PAID" ? "ok" : detail.status === "VOID" ? "danger" : "info"}>{invoiceStatusLabel(detail.status)}</AdminBadge>
                  {detail.status === "PAID" && detail.paidAt ? <span className="admin-cell-sub"> · saldada el {formatDate(detail.paidAt)}</span> : null}
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Presupuesto</dt>
                <dd className="admin-detail-value">{detail.budget?.title || "Sin presupuesto"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Evento</dt>
                <dd className="admin-detail-value">{detail.event?.name || "Sin evento"}</dd>
              </div>
            </dl>

            <div className="admin-detail-section">
              <span className="admin-detail-section-title">
                <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                  <AdminIcon name="receipt" size={11} />
                </span>
                Detalle
              </span>
              <AdminTable
                view="factura-items"
                label={`Ítems de la factura ${invoiceNumberLabel(detail.number)}`}
                columns={[
                  { label: "Producto o servicio" },
                  { label: "Cantidad" },
                  { label: "Precio unitario" },
                  { label: "IVA" },
                  { label: "Importe" },
                ]}
              >
                {detail.items.map((item) => (
                  <AdminRow key={item.id}>
                    <AdminCell title={item.name}>{item.name}</AdminCell>
                    <AdminCell>{formatNumber(item.quantity)}</AdminCell>
                    <AdminCell>{formatMoney(item.unitPrice)}</AdminCell>
                    <AdminCell>
                      {invoiceTaxTypeLabel(item.taxType)}
                      <small className="admin-cell-sub"> · {formatMoney(item.taxAmount)}</small>
                    </AdminCell>
                    <AdminCell>
                      <strong>{formatMoney(item.subtotal)}</strong>
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            </div>

            <dl className="admin-detail-grid">
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Gravada 10 %</dt>
                <dd className="admin-detail-value admin-nowrap">
                  {formatMoney(detail.taxable10)} <small className="admin-cell-sub">· IVA {formatMoney(detail.iva10)}</small>
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Gravada 5 %</dt>
                <dd className="admin-detail-value admin-nowrap">
                  {formatMoney(detail.taxable5)} <small className="admin-cell-sub">· IVA {formatMoney(detail.iva5)}</small>
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Exenta</dt>
                <dd className="admin-detail-value admin-nowrap">{formatMoney(detail.exempt)}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Total</dt>
                <dd className="admin-detail-value admin-nowrap">
                  <strong>{formatMoney(detail.total)}</strong>
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Emitida por</dt>
                <dd className="admin-detail-value">
                  {detail.createdByName} <small className="admin-cell-sub">· {formatDateTime(detail.createdAt)}</small>
                </dd>
              </div>
            </dl>

            {detail.notes ? <p className="admin-detail-text">{detail.notes}</p> : null}
            {detail.status === "VOID" ? (
              <AdminNote tone="error">
                Anulada por {detail.voidedByName ?? "—"} el {formatDateTime(detail.voidedAt)}: {detail.voidReason || "sin motivo"}.
                El número {invoiceNumberLabel(detail.number)} queda en el registro y no se reutiliza.
              </AdminNote>
            ) : null}

            <div className="admin-detail-actions">
              <span className="admin-dialog-spacer" />
              <AdminButton icon="close" type="button" onClick={() => setDetail(null)}>
                Cerrar
              </AdminButton>
              <Link className="admin-btn" href={`/imprimir/factura/${detail.id}`} target="_blank" rel="noreferrer" title="Abrir el comprobante imprimible" aria-label="Abrir el comprobante imprimible">
                <span>Ver imprimible</span>
              </Link>
            </div>
          </div>
        </AdminDialog>
      ) : null}

      {purchaseForm ? (
        <AdminDialog title={purchaseForm.id ? "Editar compra" : "Registrar compra"} size="wide" icon="suppliers" onClose={() => setPurchaseForm(null)}>
          <form className="admin-form-grid" onSubmit={submitPurchase} aria-busy={busy || undefined}>
            <TextField
              label="Proveedor (razón social)"
              wide
              required
              value={purchaseForm.reason}
              onChange={(value) => setPurchaseForm({ ...purchaseForm, reason: value })}
              maxLength={160}
              placeholder="Gráfica del Sur S.A."
            />
            <TextField label="RUC" value={purchaseForm.ruc} onChange={(value) => setPurchaseForm({ ...purchaseForm, ruc: value })} maxLength={20} placeholder="80055555-1" />
            <TextField label="Timbrado" value={purchaseForm.timbrado} onChange={(value) => setPurchaseForm({ ...purchaseForm, timbrado: value })} maxLength={30} placeholder="99887766" />
            <TextField
              label="Nº de comprobante"
              value={purchaseForm.number}
              onChange={(value) => setPurchaseForm({ ...purchaseForm, number: value })}
              maxLength={40}
              placeholder="001-001-0000123"
            />
            <DateField label="Fecha del comprobante" required value={purchaseForm.date} onChange={(value) => setPurchaseForm({ ...purchaseForm, date: value })} />
            <SelectField
              label="Tipo de IVA"
              value={purchaseForm.taxType}
              onChange={(value) => setPurchaseForm({ ...purchaseForm, taxType: value as InvoiceTaxTypeValue })}
              options={TAX_OPTIONS}
              hint="Si el comprobante mezcla tasas, cargá una compra por cada tasa"
            />
            <MoneyField
              label="Total del comprobante"
              required
              value={purchaseForm.total}
              onChange={(value) => setPurchaseForm({ ...purchaseForm, total: value })}
              hint="IVA incluido: la base y el crédito se desagregan solos"
            />
            <SelectField
              label="Proveedor del directorio"
              value={purchaseForm.supplierId}
              onChange={(value) => {
                const supplier = (suppliers.data ?? []).find((candidate) => candidate.id === value);
                setPurchaseForm({
                  ...purchaseForm,
                  supplierId: value,
                  // El directorio completa el nombre; el comprobante conserva lo que dice el papel.
                  reason: supplier && !purchaseForm.reason.trim() ? supplier.company?.trim() || supplier.name : purchaseForm.reason,
                });
              }}
              options={[
                { value: "", label: "Sin vincular" },
                ...(suppliers.data ?? [])
                  .filter((supplier) => supplier.active)
                  .map((supplier) => ({ value: supplier.id, label: supplier.company?.trim() || supplier.name })),
              ]}
              hint="Vínculo opcional; el comprobante guarda el nombre tal como viene en el papel"
            />
            <TextAreaField
              label="Concepto"
              wide
              rows={2}
              maxLength={200}
              value={purchaseForm.concept}
              onChange={(value) => setPurchaseForm({ ...purchaseForm, concept: value })}
              placeholder="Impresión de lonas, flete, servicio…"
            />
            {formError ? <AdminNote tone="error">{formError}</AdminNote> : null}
            <div className="admin-dialog-foot admin-field--wide">
              <span className="admin-dialog-spacer" />
              <AdminButton icon="close" type="button" onClick={() => setPurchaseForm(null)} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" busy={busy}>
                {purchaseForm.id ? "Guardar cambios" : "Registrar compra"}
              </AdminButton>
            </div>
          </form>
        </AdminDialog>
      ) : null}

      {voidTarget ? (
        <AdminDialog title={`Anular factura ${invoiceNumberLabel(voidTarget.number)}`} icon="alert" onClose={() => setVoidTarget(null)}>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmVoid();
            }}
            aria-busy={busy || undefined}
          >
            <AdminNote tone="error">
              La factura no se borra: queda <strong>anulada</strong> con su número, su motivo y la auditoría. El número
              no se reutiliza.
            </AdminNote>
            <TextAreaField
              label="Motivo de la anulación"
              wide
              required
              rows={3}
              maxLength={300}
              value={voidReason}
              onChange={setVoidReason}
              placeholder="Ej.: error en el RUC del receptor; se emite de nuevo"
            />
            <div className="admin-dialog-foot admin-field--wide">
              <span className="admin-dialog-spacer" />
              <AdminButton icon="close" type="button" onClick={() => setVoidTarget(null)} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="close" busy={busy}>
                Anular factura
              </AdminButton>
            </div>
          </form>
        </AdminDialog>
      ) : null}

      {deleteTarget ? (
        <AdminDialog title={`Borrar compra de «${deleteTarget.reason}»`} icon="trash" onClose={() => setDeleteTarget(null)}>
          <AdminNote tone="error">
            Se borra el comprobante del libro de IVA de {monthKeyLabel(monthOf(new Date(deleteTarget.date)))}. Solo se puede
            con el mes abierto y queda auditado; si el comprobante ya está presentado, anulalo en tu contabilidad.
          </AdminNote>
          <div className="admin-dialog-foot">
            <span className="admin-dialog-spacer" />
            <AdminButton icon="close" type="button" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancelar
            </AdminButton>
            <AdminButton type="button" variant="primary" icon="trash" busy={busy} onClick={() => void confirmDeletePurchase()}>
              Borrar compra
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {confirmClose ? (
        <AdminDialog title={`Cerrar ${monthKeyLabel(month)}`} icon="lock" onClose={() => setConfirmClose(false)}>
          <AdminNote>
            El cierre congela el resumen (ventas {formatMoney(summary.sales.total)}, compras {formatMoney(summary.purchases.total)},
            saldo de IVA {formatMoney(summary.balance)}) y bloquea la emisión, la anulación, el saldado y las compras de {monthKeyLabel(month)}.
            Se reabre solo con el usuario propietario, con motivo y auditoría.
          </AdminNote>
          <div className="admin-dialog-foot">
            <span className="admin-dialog-spacer" />
            <AdminButton icon="close" type="button" onClick={() => setConfirmClose(false)} disabled={busy}>
              Cancelar
            </AdminButton>
            <AdminButton type="button" variant="primary" icon="check" busy={busy} onClick={() => void closeMonth()}>
              Cerrar mes
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {reopenOpen ? (
        <AdminDialog title={`Reabrir ${monthKeyLabel(month)}`} icon="refresh" onClose={() => setReopenOpen(false)}>
          <form className="admin-form-grid" onSubmit={reopenMonth} aria-busy={busy || undefined}>
            <AdminNote>
              Reabrir habilita de nuevo la emisión, la anulación y las compras del mes. Queda auditado con tu nombre, la
              fecha y el motivo.
            </AdminNote>
            <TextAreaField
              label="Motivo de la reapertura"
              wide
              required
              rows={3}
              maxLength={300}
              value={reopenReason}
              onChange={setReopenReason}
              placeholder="Ej.: corregir la fecha de emisión de la factura 0000004"
            />
            <div className="admin-dialog-foot admin-field--wide">
              <span className="admin-dialog-spacer" />
              <AdminButton icon="close" type="button" onClick={() => setReopenOpen(false)} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="refresh" busy={busy}>
                Reabrir mes
              </AdminButton>
            </div>
          </form>
        </AdminDialog>
      ) : null}
    </div>
  );
}
