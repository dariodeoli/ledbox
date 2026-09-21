"use client";

import { useMemo, useState } from "react";
import { clientTypeLabel, formatMoney, formatNumber, isOverdue, whatsappHref } from "@/lib/admin-format";
import { canWrite, matchesQuery } from "@/lib/admin-policy";
import { overdueAmount, overdueCount, type AdminPaymentRow } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminFormPanel,
  AdminIconLink,
  AdminKpi,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
} from "../AdminUI";
import { EmailField, PhoneField, SearchField, SelectField, TextField } from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { normalizeEmail, normalizePhone } from "@/lib/field-rules";

const TYPE_OPTIONS = [
  { value: "ALL", label: "Todos los tipos" },
  { value: "FINAL", label: "Cliente final" },
  { value: "RESELLER", label: "Mayorista / revendedor" },
];

const DEBT_OPTIONS = [
  { value: "ALL", label: "Todos los clientes" },
  { value: "OVERDUE", label: "Con deuda vencida" },
];

const EMPTY_FORM = { name: "", company: "", type: "FINAL", phone: "", email: "", ruc: "" };

export function ClientesModule() {
  const { role } = useAdminSession();
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  // La deuda vencida sale del dato real de finanzas (cobros pendientes con
  // vencimiento pasado), no de un campo del cliente (issue #24).
  const finance = useAdminResource("/api/admin/finance", (payload) => payload.clientPayments ?? []);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [debtFilter, setDebtFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");

  const writable = canWrite(role);

  const debtByClient = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const payment of finance.data ?? []) {
      if (payment.status !== "PENDING" || !isOverdue(payment.dueAt)) continue;
      const current = map.get(payment.client.id) ?? { amount: 0, count: 0 };
      current.amount += payment.amount;
      current.count += 1;
      map.set(payment.client.id, current);
    }
    return map;
  }, [finance.data]);

  const rows = useMemo(() => {
    const list = (clients.data ?? [])
      .filter((client) => (type === "ALL" ? true : client.type === type))
      .filter((client) => (debtFilter === "OVERDUE" ? (debtByClient.get(client.id)?.amount ?? 0) > 0 : true))
      .filter((client) => matchesQuery(query, [client.name, client.company, client.ruc, client.email, client.phone]));
    // Con el filtro de mora, primero quien más debe: el orden lo pide el caso.
    if (debtFilter === "OVERDUE") {
      return list.sort((a, b) => (debtByClient.get(b.id)?.amount ?? 0) - (debtByClient.get(a.id)?.amount ?? 0));
    }
    return list;
  }, [clients.data, query, type, debtFilter, debtByClient]);

  const totals = useMemo(() => {
    const list = clients.data ?? [];
    const payments = (finance.data ?? []) as AdminPaymentRow[];
    return {
      total: list.length,
      active: list.filter((client) => client.active).length,
      resellers: list.filter((client) => client.type === "RESELLER").length,
      overdue: list.filter((client) => (debtByClient.get(client.id)?.amount ?? 0) > 0).length,
      overdueAmount: overdueAmount(payments),
      overdueCount: overdueCount(payments),
    };
  }, [clients.data, finance.data, debtByClient]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setStatus("");
    const result = await adminSend("/api/admin/clients", {
      name: form.name,
      company: form.company || undefined,
      type: form.type,
      phone: normalizePhone(form.phone) || undefined,
      email: normalizeEmail(form.email) || undefined,
      ruc: form.ruc || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setForm(EMPTY_FORM);
    setStatus(`Cliente «${form.name}» registrado.`);
    clients.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de clientes">
        <AdminKpi label="Clientes" value={formatNumber(totals.total)} note="en cartera" />
        <AdminKpi label="Activos" value={formatNumber(totals.active)} note="habilitados" tone="ok" />
        <AdminKpi
          label="Con deuda vencida"
          value={formatNumber(totals.overdue)}
          note={`${formatNumber(totals.overdueCount)} cobro${totals.overdueCount === 1 ? "" : "s"} vencido${totals.overdueCount === 1 ? "" : "s"}`}
          tone={totals.overdue > 0 ? "danger" : undefined}
        />
        <AdminKpi
          label="Deuda vencida"
          value={finance.data ? formatMoney(totals.overdueAmount) : "—"}
          note="cobros pendientes con vencimiento pasado"
          tone={totals.overdueAmount > 0 ? "danger" : undefined}
        />
        <AdminKpi label="Revendedores" value={formatNumber(totals.resellers)} note="mayoristas" tone="accent" />
      </section>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar clientes"
          placeholder="Buscar por nombre, empresa, RUC o contacto…"
        />
        <AdminSelect value={type} onChange={setType} label="Filtrar por tipo" options={TYPE_OPTIONS} />
        <AdminSelect value={debtFilter} onChange={setDebtFilter} label="Filtrar por deuda vencida" options={DEBT_OPTIONS} />
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
            Nuevo cliente
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {status ? <AdminNote tone="ok">{status}</AdminNote> : null}
      {finance.error ? <AdminNote tone="error">No pudimos leer los cobros vencidos: {finance.error}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo cliente"
          submitLabel="Registrar cliente"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <TextField
            label="Nombre / responsable"
            required
            maxLength={120}
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
            placeholder="Ej.: María González"
          />
          <TextField
            label="Empresa"
            maxLength={120}
            value={form.company}
            onChange={(value) => setForm({ ...form, company: value })}
            placeholder="Ej.: Samsung Paraguay"
          />
          <SelectField
            label="Tipo"
            value={form.type}
            onChange={(value) => setForm({ ...form, type: value })}
            options={[
              { value: "FINAL", label: "Cliente final" },
              { value: "RESELLER", label: "Mayorista / revendedor" },
            ]}
          />
          <PhoneField
            label="Teléfono"
            hint="Con código de país"
            value={form.phone}
            onChange={(value) => setForm({ ...form, phone: value })}
          />
          <EmailField
            label="Correo"
            value={form.email}
            onChange={(value) => setForm({ ...form, email: value })}
            placeholder="contacto@empresa.com"
          />
          <TextField
            label="RUC / CI"
            maxLength={30}
            value={form.ruc}
            onChange={(value) => setForm({ ...form, ruc: value })}
            placeholder="80012345-6"
            inputMode="numeric"
          />
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={clients.loading}
        error={clients.error}
        onRetry={clients.reload}
        empty={(clients.data ?? []).length === 0}
        emptyTitle="Todavía no hay clientes"
        emptyHint="Registrá el primer cliente para asociarle eventos y presupuestos."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro." />
        ) : (
          <AdminTable
            view="clientes"
            label="Clientes"
            columns={[
              { label: "Cliente" },
              { label: "Contacto" },
              { label: "RUC" },
              { label: "Tipo" },
              { label: "Eventos", end: true },
              { label: "Presupuestos", end: true },
              { label: "Deuda vencida", end: true },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((client) => {
              const name = client.company || client.name;
              const debt = debtByClient.get(client.id);
              return (
                <AdminRow key={client.id}>
                  <AdminCell title={`${client.name}${client.company ? ` · ${client.company}` : ""}`}>
                    <strong>{name}</strong>
                    {client.company ? <small className="admin-cell-sub"> · {client.name}</small> : null}
                  </AdminCell>
                  <AdminCell title={[client.phone, client.email].filter(Boolean).join(" · ") || "Sin contacto cargado"}>
                    {[client.phone, client.email].filter(Boolean).join(" · ") || "—"}
                  </AdminCell>
                  <AdminCell title={client.ruc || "Sin RUC"}>
                    <span className="admin-code">{client.ruc || "—"}</span>
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={client.type === "RESELLER" ? "accent" : "neutral"}>{clientTypeLabel(client.type)}</AdminBadge>
                  </AdminCell>
                  <AdminCell end title={`${client._count.events} eventos`}>
                    {formatNumber(client._count.events)}
                  </AdminCell>
                  <AdminCell end title={`${client._count.budgets} presupuestos`}>
                    {formatNumber(client._count.budgets)}
                  </AdminCell>
                  <AdminCell
                    end
                    title={
                      debt
                        ? `${formatMoney(debt.amount)} en ${formatNumber(debt.count)} cobro${debt.count === 1 ? "" : "s"} vencido${debt.count === 1 ? "" : "s"}`
                        : "Sin cobros vencidos"
                    }
                  >
                    {debt ? (
                      <span className="admin-nowrap" data-tone="danger">
                        {formatMoney(debt.amount)}
                      </span>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={client.active ? "ok" : "neutral"}>{client.active ? "Activo" : "Inactivo"}</AdminBadge>
                  </AdminCell>
                  <AdminCell end>
                    <span className="admin-actions">
                      <AdminWhatsappLink phone={client.phone} name={name} />
                      {client.email ? <AdminIconLink href={`mailto:${client.email}`} icon="mail" label={`Enviar correo a ${name}`} /> : null}
                      {!whatsappHref(client.phone) && !client.email ? <span className="admin-muted">—</span> : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>
    </div>
  );
}
