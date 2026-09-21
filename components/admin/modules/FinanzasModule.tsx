"use client";

import { useMemo, useState } from "react";
import { dueTone, formatDateShort, formatDateTime, formatMoney, formatNumber, formatTime, jobStatusLabel, statusTone } from "@/lib/admin-format";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import { useAdminSession } from "../AdminShell";
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
  kind: "client",
  clientId: "",
  supplierId: "",
  eventId: "",
  amount: "",
  total: "",
  advance: "",
  description: "",
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
  const resources = useAdminResource("/api/admin/resources", (payload) => ({
    suppliers: payload.suppliers ?? [],
    inventory: payload.inventory ?? [],
    promoters: payload.promoters ?? [],
  }));
  const events = useAdminResource("/api/admin/events", (payload) => payload.events ?? []);

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
    const payable = jobs
      .filter((job) => job.status !== "PAID" && job.status !== "CANCELLED")
      .reduce((sum, job) => sum + Math.max(0, job.total - job.advance), 0);
    return { collected, advances, payable };
  }, [payments, jobs]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result =
      form.kind === "client"
        ? await adminSend("/api/admin/finance", {
            kind: "client",
            clientId: form.clientId,
            amount: Number(form.amount),
            method: form.method || undefined,
            reference: form.reference || undefined,
          })
        : await adminSend("/api/admin/finance", {
            kind: "supplier",
            supplierId: form.supplierId,
            eventId: form.eventId || undefined,
            description: form.description,
            total: Number(form.total),
            advance: Number(form.advance) || 0,
          });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice(form.kind === "client" ? "Cobro registrado." : "Trabajo de proveedor registrado.");
    setForm({ ...EMPTY_FORM, kind: form.kind });
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
            Registrar movimiento
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo movimiento"
          submitLabel="Registrar"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <AdminField label="Tipo de movimiento">
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="client">Cobro de cliente</option>
              <option value="supplier">Trabajo de proveedor</option>
            </select>
          </AdminField>
          {form.kind === "client" ? (
            <>
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
            </>
          ) : (
            <>
              <AdminField label="Proveedor">
                <select required value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}>
                  <option value="">Elegí un proveedor…</option>
                  {(resources.data?.suppliers ?? []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </AdminField>
              <AdminField label="Evento" hint="Opcional">
                <select value={form.eventId} onChange={(event) => setForm({ ...form, eventId: event.target.value })}>
                  <option value="">Sin evento asociado</option>
                  {(events.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </AdminField>
              <AdminField label="Trabajo / concepto" wide>
                <input
                  required
                  maxLength={160}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Ej.: Estructura y gráfica de stand"
                />
              </AdminField>
              <AdminField label="Costo total" hint="En guaraníes">
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.total}
                  onChange={(event) => setForm({ ...form, total: event.target.value })}
                  inputMode="numeric"
                />
              </AdminField>
              <AdminField label="Anticipo" hint="Opcional">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.advance}
                  onChange={(event) => setForm({ ...form, advance: event.target.value })}
                  inputMode="numeric"
                />
              </AdminField>
            </>
          )}
        </AdminFormPanel>
      ) : null}

      <AdminPanel
        title="Cobros de clientes"
        meta={`${formatNumber(filteredPayments.length)} movimientos`}
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

      <AdminPanel title="Cuentas por pagar" meta={`${formatNumber(filteredJobs.length)} trabajos`}>
        <AdminDataState
          loading={finance.loading}
          error={finance.error}
          onRetry={finance.reload}
          empty={filteredJobs.length === 0}
          emptyTitle="Sin trabajos de proveedor"
          emptyHint="Cargá el trabajo contratado para seguir costo, anticipo y saldo."
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
              const balance = job.total - job.advance;
              return (
                <AdminRow key={job.id}>
                  <AdminCell title={job.supplier.name}>
                    <strong>{job.supplier.name}</strong>
                  </AdminCell>
                  <AdminCell title={job.description}>{job.description}</AdminCell>
                  <AdminCell title={job.event?.name || "Sin evento asociado"}>{job.event?.name || "—"}</AdminCell>
                  <AdminCell title={job.dueAt ? `Vence el ${formatDateShort(job.dueAt)}` : "Sin fecha prevista"}>
                    <span className="admin-nowrap" data-tone={job.status === "PAID" ? undefined : dueTone(job.dueAt)}>
                      {job.dueAt ? formatDateShort(job.dueAt) : "—"}
                    </span>
                  </AdminCell>
                  <AdminCell end title={formatMoney(job.total)}>
                    {formatMoney(job.total)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(job.advance)}>
                    {formatMoney(job.advance)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(balance)}>
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
