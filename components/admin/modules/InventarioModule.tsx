"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatNumber, inventoryKindLabel, inventoryStatusLabel, statusTone } from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
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
  AdminRow,
  AdminSearchField,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { adminSend, useAdminResource } from "../use-admin-data";

const KIND_OPTIONS = [
  { value: "ALL", label: "Todos los tipos" },
  { value: "REUSABLE", label: "Reutilizable" },
  { value: "CONSUMABLE", label: "Consumible" },
  { value: "DISPOSABLE", label: "Descartable" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "AVAILABLE", label: "Disponible" },
  { value: "RESERVED", label: "Reservado" },
  { value: "IN_USE", label: "En uso" },
  { value: "MAINTENANCE", label: "Mantenimiento" },
  { value: "RETIRED", label: "Retirado" },
];

const EMPTY_FORM = { name: "", category: "", inventoryKind: "REUSABLE", quantity: "1" };

export function InventarioModule() {
  const { role } = useAdminSession();
  const resources = useAdminResource("/api/admin/resources", (payload) => ({
    suppliers: payload.suppliers ?? [],
    inventory: payload.inventory ?? [],
    promoters: payload.promoters ?? [],
  }));

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWriteOperations(role);
  const inventory = useMemo(() => resources.data?.inventory ?? [], [resources.data]);

  const rows = useMemo(
    () =>
      inventory
        .filter((item) => (kind === "ALL" ? true : item.kind === kind))
        .filter((item) => (status === "ALL" ? true : item.status === status))
        .filter((item) => matchesQuery(query, [item.name, item.category, item.sku, item.status])),
    [inventory, kind, status, query],
  );

  const totals = useMemo(
    () =>
      inventory.reduce(
        (accumulator, item) => {
          accumulator.units += item.quantity;
          accumulator.value += item.quantity * item.replacementCost;
          if (item.status === "IN_USE" || item.status === "MAINTENANCE") accumulator.out += item.quantity;
          return accumulator;
        },
        { units: 0, value: 0, out: 0 },
      ),
    [inventory],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/resources", {
      kind: "inventory",
      name: form.name,
      category: form.category || "General",
      inventoryKind: form.inventoryKind,
      quantity: Number(form.quantity) || 1,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice(`Ítem «${form.name}» cargado.`);
    setForm(EMPTY_FORM);
    resources.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de inventario">
        <AdminKpi label="Ítems" value={formatNumber(inventory.length)} note="controlados" />
        <AdminKpi label="Unidades" value={formatNumber(totals.units)} note="en total" />
        <AdminKpi label="Valor de reposición" value={formatMoney(totals.value)} note="a costo de reposición" tone="accent" />
        <AdminKpi label="En uso o mantenimiento" value={formatNumber(totals.out)} note="fuera de disponible" tone={totals.out > 0 ? "warn" : "ok"} />
      </section>

      <AdminToolbar>
        <AdminSearchField value={query} onChange={setQuery} label="Buscar inventario" placeholder="Buscar por artículo, categoría o SKU…" />
        <AdminSelect value={kind} onChange={setKind} label="Filtrar por tipo" options={KIND_OPTIONS} />
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
            Nuevo ítem
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo ítem de inventario"
          submitLabel="Cargar ítem"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <AdminField label="Artículo">
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ej.: Pantalla LED P3.9 500×500"
            />
          </AdminField>
          <AdminField label="Categoría">
            <input
              maxLength={80}
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              placeholder="Ej.: Pantallas"
            />
          </AdminField>
          <AdminField label="Tipo">
            <select value={form.inventoryKind} onChange={(event) => setForm({ ...form, inventoryKind: event.target.value })}>
              <option value="REUSABLE">Reutilizable</option>
              <option value="CONSUMABLE">Consumible</option>
              <option value="DISPOSABLE">Descartable</option>
            </select>
          </AdminField>
          <AdminField label="Cantidad">
            <input
              type="number"
              min="1"
              step="1"
              required
              value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              inputMode="numeric"
            />
          </AdminField>
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={resources.loading}
        error={resources.error}
        onRetry={resources.reload}
        empty={inventory.length === 0}
        emptyTitle="Inventario vacío"
        emptyHint="Cargá los equipos y materiales para asignarlos a los eventos."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá los filtros." />
        ) : (
          <AdminTable
            view="inventario"
            label="Inventario"
            columns={[
              { label: "Artículo" },
              { label: "Categoría" },
              { label: "Tipo" },
              { label: "Cantidad", end: true },
              { label: "Reposición", end: true },
              { label: "Costo diario", end: true },
              { label: "Estado" },
            ]}
          >
            {rows.map((item) => (
              <AdminRow key={item.id}>
                <AdminCell title={item.name}>
                  <strong>{item.name}</strong>
                  {item.sku ? <span className="admin-code"> · {item.sku}</span> : null}
                </AdminCell>
                <AdminCell title={item.category}>{item.category}</AdminCell>
                <AdminCell>
                  <AdminBadge tone={statusTone(item.kind)}>{inventoryKindLabel(item.kind)}</AdminBadge>
                </AdminCell>
                <AdminCell end title={`${formatNumber(item.quantity)} unidades`}>
                  {formatNumber(item.quantity)}
                </AdminCell>
                <AdminCell end title={formatMoney(item.replacementCost)}>
                  {formatMoney(item.replacementCost)}
                </AdminCell>
                <AdminCell end title={formatMoney(item.dailyCost)}>
                  {formatMoney(item.dailyCost)}
                </AdminCell>
                <AdminCell>
                  <AdminBadge tone={statusTone(item.status)}>{inventoryStatusLabel(item.status)}</AdminBadge>
                </AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        )}
      </AdminDataState>
    </div>
  );
}
