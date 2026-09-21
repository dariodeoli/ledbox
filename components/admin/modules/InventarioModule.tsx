"use client";

import { useMemo, useState } from "react";
import {
  damageSummary,
  formatDateShort,
  formatMoney,
  formatNumber,
  formatTime,
  inventoryAssignmentState,
  inventoryKindLabel,
  inventoryStatusLabel,
  statusTone,
} from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import type { AdminInventoryItemRow } from "@/lib/admin-types";
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

const STATUS_PICK_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== "ALL");

const EMPTY_FORM = { name: "", category: "", inventoryKind: "REUSABLE", quantity: "1" };

/** Horas de salida/devolución en formato de tabla (es-PY, 24 h). */
function stamp(value: string | null): string {
  return value ? `${formatDateShort(value)} · ${formatTime(value)}` : "—";
}

/** Rango asignado en una línea: `09-oct. 08:00 → 12-oct. 20:00`. */
function rangeStamp(start: string | null, end: string | null): string {
  if (!start || !end) return "Sin fechas";
  return `${formatDateShort(start)} ${formatTime(start)} → ${formatDateShort(end)} ${formatTime(end)}`;
}

export function InventarioModule() {
  const { role } = useAdminSession();
  const resources = useAdminResource(
    "/api/admin/inventory",
    (payload) => (payload.inventory ?? []) as AdminInventoryItemRow[],
  );

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const [statusError, setStatusError] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const writable = canWriteOperations(role);
  const inventory = useMemo(() => resources.data ?? [], [resources.data]);
  const selected = useMemo(() => inventory.find((item) => item.id === selectedId) ?? null, [inventory, selectedId]);

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
          accumulator.committed += item.availability.committedNow;
          accumulator.available += item.availability.availableNow;
          if (item.availability.overcommittedNow) accumulator.conflicts += 1;
          return accumulator;
        },
        { units: 0, committed: 0, available: 0, conflicts: 0 },
      ),
    [inventory],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    // El alta de ítems vive en `/api/admin/resources` (contrato existente del panel).
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

  async function changeStatus(item: AdminInventoryItemRow, next: string) {
    setStatusBusyId(item.id);
    setStatusError("");
    setNotice("");
    const result = await adminSend("/api/admin/inventory", { kind: "status", id: item.id, status: next });
    setStatusBusyId("");
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    setNotice(`«${item.name}» pasó a ${inventoryStatusLabel(next)}.`);
    resources.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de inventario">
        <AdminKpi label="Ítems" value={formatNumber(inventory.length)} note="controlados" />
        <AdminKpi label="Unidades" value={formatNumber(totals.units)} note="en total" />
        <AdminKpi
          label="En eventos ahora"
          value={formatNumber(totals.committed)}
          note="unidades comprometidas"
          tone={totals.committed > 0 ? "accent" : undefined}
        />
        <AdminKpi
          label="Disponibles ahora"
          value={formatNumber(totals.available)}
          note={totals.conflicts > 0 ? `${formatNumber(totals.conflicts)} ítems en conflicto` : "libres para asignar"}
          tone={totals.available === 0 || totals.conflicts > 0 ? "warn" : "ok"}
        />
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
      {statusError ? <AdminNote tone="error">{statusError}</AdminNote> : null}

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
              { label: "Libres ahora", end: true },
              { label: "Reposición", end: true },
              { label: "Costo diario", end: true },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((item) => {
              const { availableNow, committedNow, overcommittedNow } = item.availability;
              return (
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
                  <AdminCell
                    end
                    title={`${formatNumber(availableNow)} libres de ${formatNumber(item.quantity)} · ${formatNumber(committedNow)} comprometidas ahora`}
                  >
                    <span className="admin-nowrap" data-tone={availableNow === 0 ? "warn" : undefined}>
                      {formatNumber(availableNow)}
                    </span>
                    {overcommittedNow ? (
                      <AdminBadge
                        tone="danger"
                        title="Hay más unidades asignadas a eventos vigentes que las que tiene el ítem."
                      >
                        Conflicto
                      </AdminBadge>
                    ) : null}
                  </AdminCell>
                  <AdminCell end title={formatMoney(item.replacementCost)}>
                    {formatMoney(item.replacementCost)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(item.dailyCost)}>
                    {formatMoney(item.dailyCost)}
                  </AdminCell>
                  <AdminCell title={writable ? `Cambiar estado: ${item.name}` : `Estado: ${inventoryStatusLabel(item.status)}`}>
                    {writable ? (
                      <select
                        className="admin-filter admin-filter--cell"
                        value={item.status}
                        disabled={statusBusyId === item.id}
                        onChange={(event) => void changeStatus(item, event.target.value)}
                        aria-label={`Cambiar estado: ${item.name}`}
                        title={`Cambiar estado: ${item.name}`}
                      >
                        {STATUS_PICK_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <AdminBadge tone={statusTone(item.status)}>{inventoryStatusLabel(item.status)}</AdminBadge>
                    )}
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      <AdminButton
                        icon="info"
                        title={`Ver asignaciones: ${item.name}`}
                        aria-label={`Ver asignaciones: ${item.name}`}
                        onClick={() => setSelectedId((current) => (current === item.id ? "" : item.id))}
                      />
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {selected ? (
        <AdminPanel
          title={`Asignaciones · ${selected.name}`}
          meta={`${formatNumber(selected.availability.availableNow)} de ${formatNumber(selected.quantity)} libres ahora`}
          action={
            <AdminButton
              icon="close"
              title="Cerrar asignaciones"
              aria-label="Cerrar asignaciones"
              onClick={() => setSelectedId("")}
            />
          }
        >
          {selected.assignments.length === 0 ? (
            <AdminEmpty
              icon="inventory"
              title="Sin asignaciones"
              hint="Los equipos se asignan a los eventos con cantidad y rango de fechas desde el módulo Eventos."
            />
          ) : (
            <AdminTable
              view="inventario-asignaciones"
              label={`Asignaciones de ${selected.name}`}
              columns={[
                { label: "Evento" },
                { label: "Rango" },
                { label: "Cantidad", end: true },
                { label: "Salida" },
                { label: "Devolución" },
                { label: "Estado" },
                { label: "Daños" },
              ]}
            >
              {selected.assignments.map((assignment) => {
                const state = inventoryAssignmentState(assignment);
                const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
                const startsAt = assignment.startsAt ?? assignment.event.startsAt;
                const endsAt = assignment.endsAt ?? assignment.event.endsAt ?? startsAt;
                return (
                  <AdminRow key={assignment.id}>
                    <AdminCell title={assignment.event.name}>{assignment.event.name}</AdminCell>
                    <AdminCell title={startsAt && endsAt ? rangeStamp(startsAt, endsAt) : "Sin fechas"}>
                      {rangeStamp(startsAt, endsAt)}
                    </AdminCell>
                    <AdminCell end title={`${formatNumber(assignment.quantity)} unidades`}>
                      {formatNumber(assignment.quantity)}
                    </AdminCell>
                    <AdminCell title={assignment.checkedOutAt ? `Salida: ${stamp(assignment.checkedOutAt)}` : undefined}>
                      {stamp(assignment.checkedOutAt)}
                    </AdminCell>
                    <AdminCell title={assignment.checkedInAt ? `Devolución: ${stamp(assignment.checkedInAt)}` : undefined}>
                      {stamp(assignment.checkedInAt)}
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={state.tone}>{state.label}</AdminBadge>
                    </AdminCell>
                    <AdminCell
                      title={damages ? `${damages}${assignment.damageNotes ? ` · ${assignment.damageNotes}` : ""}` : "Sin daños ni faltantes"}
                    >
                      {damages ?? "—"}
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminPanel>
      ) : null}
    </div>
  );
}
