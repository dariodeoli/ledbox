"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { dueTone, formatDateShort, formatDateTime, formatMoney, formatNumber, formatTime, jobStatusLabel, statusTone } from "@/lib/admin-format";
import { csvDay, csvFilename, csvStamp, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import { supplierJobBalance } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminField,
  AdminFormPanel,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSearchField,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { adminSend, useAdminResource } from "../use-admin-data";

const METHOD_OPTIONS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"];

const EMPTY_FORM = {
  clientId: "",
  amount: "",
  method: "Transferencia",
  reference: "",
};

export function FinanzasModule() {
  const { role } = useAdminSession();
  const finance = useAdminResource("/api/admin/finance", (payload) => ({
    payments: payload.clientPayments ?? [],
    jobs: payload.supplierJobs ?? [],
  }));
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);

  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWriteFinance(role);
  const payments = useMemo(() => finance.data?.payments ?? [], [finance.data]);
  const jobs = useMemo(() => finance.data?.jobs ?? [], [finance.data]);

  const filteredPayments = useMemo(
    () => payments.filter((payment) => matchesQuery(query, [payment.client.company, payment.client.name, payment.budget?.title, payment.method, payment.reference])),
    [payments, query],
  );
  const filteredJobs = useMemo(
    () => jobs.filter((job) => matchesQuery(query, [job.supplier.name, job.event?.name, job.description, job.status])),
    [jobs, query],
  );

  const totals = useMemo(() => {
    const collected = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const advances = jobs.reduce((sum, job) => sum + job.advance, 0);
    const payable = jobs.reduce((sum, job) => sum + supplierJobBalance(job), 0);
    return { collected, advances, payable };
  }, [payments, jobs]);

  /** CSV de cobros con los mismos filtros de la lista (monto entero, fecha ISO). */
  function exportCollections() {
    const total = filteredPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const blocks: CsvBlock[] = [
      {
        title: "Cobros de clientes",
        header: ["Fecha", "Cliente", "Presupuesto", "Método", "Referencia", "Monto (PYG)"],
        rows: [
          ...filteredPayments.map((payment) => [
            csvStamp(payment.paidAt),
            payment.client.company || payment.client.name,
            payment.budget?.title ?? "",
            payment.method ?? "",
            payment.reference ?? "",
            payment.amount,
          ]),
          ["", "", "", "", "Total", total],
        ],
      },
    ];
    downloadCsv(csvFilename("cobros-clientes"), blocks);
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
    setNotice("");
    const result = await adminSend("/api/admin/finance", {
      kind: "client",
      clientId: form.clientId,
      amount: Number(form.amount),
      method: form.method || undefined,
      reference: form.reference || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice("Cobro registrado.");
    setForm({ ...EMPTY_FORM });
    finance.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de finanzas">
        <AdminKpi label="Cobrado a clientes" value={formatMoney(totals.collected)} note={`${formatNumber(payments.length)} cobros`} tone="ok" />
        <AdminKpi label="Anticipos pagados" value={formatMoney(totals.advances)} note="a proveedores" />
        <AdminKpi label="Saldo por pagar" value={formatMoney(totals.payable)} note="trabajos abiertos" tone="warn" />
        <AdminKpi label="Trabajos de proveedor" value={formatNumber(jobs.length)} note="registrados" />
      </section>

      <AdminToolbar>
        <AdminSearchField
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

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo cobro de cliente"
          submitLabel="Registrar cobro"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <AdminField label="Cliente">
            <select required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>
              <option value="">Elegí un cliente…</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company || client.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Monto cobrado" hint="En guaraníes">
            <input
              type="number"
              min="1"
              step="1"
              required
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              inputMode="numeric"
            />
          </AdminField>
          <AdminField label="Método">
            <select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
              {METHOD_OPTIONS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Referencia" hint="Nº de transferencia o recibo">
            <input
              maxLength={80}
              value={form.reference}
              onChange={(event) => setForm({ ...form, reference: event.target.value })}
              placeholder="Opcional"
            />
          </AdminField>
        </AdminFormPanel>
      ) : null}

      <AdminPanel
        title="Cobros de clientes"
        meta={`${formatNumber(filteredPayments.length)} movimientos`}
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
          empty={filteredPayments.length === 0}
          emptyTitle="Sin cobros registrados"
          emptyHint="Registrá el primer cobro para verlo acá con su presupuesto."
          rows={4}
        >
          <AdminTable
            view="cobros"
            label="Cobros de clientes"
            columns={[
              { label: "Fecha" },
              { label: "Cliente" },
              { label: "Presupuesto" },
              { label: "Monto", end: true },
              { label: "Método" },
              { label: "Referencia" },
            ]}
          >
            {filteredPayments.map((payment) => (
              <AdminRow key={payment.id}>
                <AdminCell title={formatDateTime(payment.paidAt)}>
                  {formatDateShort(payment.paidAt)} · {formatTime(payment.paidAt)}
                </AdminCell>
                <AdminCell title={payment.client.company || payment.client.name}>{payment.client.company || payment.client.name}</AdminCell>
                <AdminCell title={payment.budget?.title || "Sin presupuesto asociado"}>{payment.budget?.title || "—"}</AdminCell>
                <AdminCell end title={formatMoney(payment.amount)}>
                  <strong>{formatMoney(payment.amount)}</strong>
                </AdminCell>
                <AdminCell>{payment.method || "—"}</AdminCell>
                <AdminCell title={payment.reference || "Sin referencia"}>
                  <span className="admin-code">{payment.reference || "—"}</span>
                </AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
          {filteredPayments.length === 0 ? <AdminEmpty title="Sin resultados" hint="Ningún cobro coincide con la búsqueda." /> : null}
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
    </div>
  );
}
