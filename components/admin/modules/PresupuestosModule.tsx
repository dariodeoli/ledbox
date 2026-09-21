"use client";

import { useMemo, useState } from "react";
import { budgetStatusLabel, dueTone, formatDateShort, formatMoney, formatNumber, statusTone } from "@/lib/admin-format";
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
  AdminIconLink,
  AdminKpi,
  AdminNote,
  AdminRow,
  AdminSearchField,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { adminSend, useAdminResource } from "../use-admin-data";

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "DRAFT", label: "Borrador" },
  { value: "SENT", label: "Enviado" },
  { value: "NEGOTIATING", label: "En negociación" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "LOST", label: "Perdido" },
  { value: "CANCELLED", label: "Cancelado" },
];

const EMPTY_FORM = { clientId: "", eventId: "", title: "", item: "", quantity: "1", days: "1", unitPrice: "", costPrice: "" };

export function PresupuestosModule() {
  const { role } = useAdminSession();
  const budgets = useAdminResource("/api/admin/budgets", (payload) => payload.budgets ?? []);
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  const events = useAdminResource("/api/admin/events", (payload) => payload.events ?? []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWriteFinance(role);
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  const eventOptions = useMemo(() => events.data ?? [], [events.data]);

  const rows = useMemo(() => {
    const list = budgets.data ?? [];
    return list
      .filter((budget) => (status === "ALL" ? true : budget.status === status))
      .filter((budget) => matchesQuery(query, [budget.title, budget.client.company, budget.client.name, budget.event?.name]));
  }, [budgets.data, query, status]);

  const totals = useMemo(() => {
    const list = budgets.data ?? [];
    return list.reduce(
      (accumulator, budget) => {
        const paid = budget.payments.reduce((sum, payment) => sum + payment.amount, 0);
        accumulator.quoted += budget.total;
        accumulator.paid += paid;
        accumulator.receivable += Math.max(0, budget.total - paid);
        accumulator.margin += budget.total - budget.costEstimate;
        return accumulator;
      },
      { quoted: 0, paid: 0, receivable: 0, margin: 0 },
    );
  }, [budgets.data]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/budgets", {
      clientId: form.clientId,
      eventId: form.eventId || undefined,
      title: form.title,
      items: [
        {
          name: form.item,
          quantity: Number(form.quantity) || 1,
          days: Number(form.days) || 1,
          unitPrice: Number(form.unitPrice) || 0,
          costPrice: Number(form.costPrice) || 0,
        },
      ],
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setForm(EMPTY_FORM);
    setNotice(`Presupuesto «${form.title}» creado.`);
    budgets.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de presupuestos">
        <AdminKpi label="Total cotizado" value={formatMoney(totals.quoted)} note="presupuestos vigentes" />
        <AdminKpi label="Cobrado" value={formatMoney(totals.paid)} note="pagos registrados" tone="ok" />
        <AdminKpi label="Por cobrar" value={formatMoney(totals.receivable)} note="saldo de clientes" tone="warn" />
        <AdminKpi label="Margen estimado" value={formatMoney(totals.margin)} note="venta menos costos" tone="accent" />
      </section>

      <AdminToolbar>
        <AdminSearchField
          value={query}
          onChange={setQuery}
          label="Buscar presupuestos"
          placeholder="Buscar por título, cliente o evento…"
        />
        <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado" options={STATUS_OPTIONS} />
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

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo presupuesto"
          submitLabel="Crear presupuesto"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <AdminField label="Cliente">
            <select required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>
              <option value="">Elegí un cliente…</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company || client.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Evento" hint="Opcional">
            <select value={form.eventId} onChange={(event) => setForm({ ...form, eventId: event.target.value })}>
              <option value="">Sin evento asociado</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Título" wide>
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Ej.: Alquiler pantalla LED 6×3"
            />
          </AdminField>
          <AdminField label="Producto / servicio" wide>
            <input
              required
              maxLength={160}
              value={form.item}
              onChange={(event) => setForm({ ...form, item: event.target.value })}
              placeholder="Ej.: Pantalla LED P3.9 interior"
            />
          </AdminField>
          <AdminField label="Cantidad">
            <input
              type="number"
              min="1"
              step="1"
              required
              value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
            />
          </AdminField>
          <AdminField label="Días">
            <input type="number" min="1" step="1" required value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </AdminField>
          <AdminField label="Precio unitario" hint="En guaraníes">
            <input
              type="number"
              min="0"
              step="1"
              required
              value={form.unitPrice}
              onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
              inputMode="numeric"
            />
          </AdminField>
          <AdminField label="Costo unitario" hint="Para el margen estimado">
            <input
              type="number"
              min="0"
              step="1"
              value={form.costPrice}
              onChange={(event) => setForm({ ...form, costPrice: event.target.value })}
              inputMode="numeric"
            />
          </AdminField>
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={budgets.loading}
        error={budgets.error}
        onRetry={budgets.reload}
        empty={(budgets.data ?? []).length === 0}
        emptyTitle="Todavía no hay presupuestos"
        emptyHint="Creá un presupuesto para seguir venta, costos, margen y cobros."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : (
          <AdminTable
            view="presupuestos"
            label="Presupuestos"
            columns={[
              { label: "Presupuesto" },
              { label: "Cliente" },
              { label: "Ítems", end: true },
              { label: "Total", end: true },
              { label: "Cobrado", end: true },
              { label: "Saldo", end: true },
              { label: "Margen", end: true },
              { label: "Estado" },
              { label: "Vence" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((budget) => {
              const paid = budget.payments.reduce((sum, payment) => sum + payment.amount, 0);
              const balance = budget.total - paid;
              const margin = budget.total - budget.costEstimate;
              return (
                <AdminRow key={budget.id}>
                  <AdminCell title={`${budget.title}${budget.event ? ` · ${budget.event.name}` : ""}`}>
                    <strong>{budget.title}</strong>
                    {budget.event ? <small className="admin-cell-sub"> · {budget.event.name}</small> : null}
                  </AdminCell>
                  <AdminCell title={budget.client.company || budget.client.name}>{budget.client.company || budget.client.name}</AdminCell>
                  <AdminCell end title={`${budget.items.length} ítems`}>
                    {formatNumber(budget.items.length)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(budget.total)}>
                    {formatMoney(budget.total)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(paid)}>
                    {formatMoney(paid)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(balance)}>
                    <strong>{formatMoney(balance)}</strong>
                  </AdminCell>
                  <AdminCell end title={`${formatMoney(budget.total - budget.costEstimate)} de margen estimado`}>
                    {formatMoney(margin)}
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={budget.validUntil ? `Vence el ${formatDateShort(budget.validUntil)}` : "Sin vencimiento"}>
                    <span className="admin-nowrap" data-tone={dueTone(budget.validUntil)}>
                      {budget.validUntil ? formatDateShort(budget.validUntil) : "—"}
                    </span>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      <AdminIconLink
                        href={`/imprimir/presupuesto/${budget.id}`}
                        icon="print"
                        label={`Imprimir presupuesto: ${budget.title}`}
                        external
                      />
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
