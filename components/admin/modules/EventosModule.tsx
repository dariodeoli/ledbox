"use client";

import { useEffect, useMemo, useState } from "react";
import {
  damageSummary,
  eventStatusLabel,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatTime,
  inventoryAssignmentState,
  ITEM_CONDITIONS,
  statusTone,
} from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import type { AdminEventAssignment, AdminInventoryAvailability, AdminInventoryItemRow } from "@/lib/admin-types";
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
  AdminPanel,
  AdminRow,
  AdminSearchField,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { adminSend, redirectToLogin, useAdminResource } from "../use-admin-data";
import { ChecklistTable, type ChecklistEntry } from "./Checklist";

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "DRAFT", label: "Borrador" },
  { value: "CONFIRMED", label: "Confirmado" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "COMPLETED", label: "Finalizado" },
  { value: "CANCELLED", label: "Cancelado" },
];

const TASK_TYPE_OPTIONS = [
  { value: "SETUP", label: "Montaje" },
  { value: "EVENT", label: "Evento" },
  { value: "STRIKE", label: "Desmontaje" },
  { value: "PAYMENT", label: "Pago" },
  { value: "COLLECTION", label: "Cobro" },
];

const EMPTY_EVENT_FORM = { clientId: "", name: "", location: "", startsAt: "" };
const EMPTY_TASK_FORM = { eventId: "", title: "", type: "EVENT", dueAt: "" };
const EMPTY_ASSIGN_FORM = { inventoryId: "", quantity: "1", startsAt: "", endsAt: "" };
const EMPTY_MOVEMENT_FORM = { at: "", condition: ITEM_CONDITIONS[0] as string, damaged: "0", missing: "0", notes: "" };

type MovementRequest = { mode: "checkout" | "checkin"; assignment: AdminEventAssignment };

/** Valor para `datetime-local` en hora local del navegador (es-PY, 24 h). */
function inputDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stamp(value: string | null): string {
  return value ? `${formatDateShort(value)} · ${formatTime(value)}` : "—";
}

/** Rango asignado en una línea: `09-oct. 08:00 → 12-oct. 20:00`. */
function rangeStamp(start: string | null, end: string | null): string {
  if (!start || !end) return "Sin fechas";
  return `${formatDateShort(start)} ${formatTime(start)} → ${formatDateShort(end)} ${formatTime(end)}`;
}

const BLOCKED_INVENTORY_STATUSES = ["MAINTENANCE", "RETIRED"];

export function EventosModule() {
  const { role } = useAdminSession();
  const operations = useAdminResource("/api/admin/event-ops", (payload) => payload.events ?? []);
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  const inventoryResource = useAdminResource(
    "/api/admin/inventory",
    (payload) => (payload.inventory ?? []) as AdminInventoryItemRow[],
  );

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [taskFilter, setTaskFilter] = useState("PENDING");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_EVENT_FORM);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [busy, setBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [checklistError, setChecklistError] = useState("");

  const [equipmentEventId, setEquipmentEventId] = useState("");
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGN_FORM);
  const [assignEditingId, setAssignEditingId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignNotice, setAssignNotice] = useState("");
  const [equipmentError, setEquipmentError] = useState("");
  const [availability, setAvailability] = useState<AdminInventoryAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [movement, setMovement] = useState<MovementRequest | null>(null);
  const [movementForm, setMovementForm] = useState(EMPTY_MOVEMENT_FORM);
  const [movementBusy, setMovementBusy] = useState(false);
  const [movementError, setMovementError] = useState("");

  const writable = canWriteOperations(role);
  const checklistWritable = canWriteOperations(role);
  const events = useMemo(() => operations.data ?? [], [operations.data]);
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  const inventoryItems = useMemo(() => inventoryResource.data ?? [], [inventoryResource.data]);
  const equipmentEvent = useMemo(() => events.find((event) => event.id === equipmentEventId) ?? null, [events, equipmentEventId]);
  const assignments = equipmentEvent?.assignments ?? [];
  const assignedUnits = assignments.reduce((sum, assignment) => sum + assignment.quantity, 0);

  const rows = useMemo(() => {
    const now = Date.now();
    return events
      .filter((event) => (status === "ALL" ? true : event.status === status))
      .filter((event) => matchesQuery(query, [event.name, event.location, event.client.company, event.client.name, event.status]))
      .sort((a, b) => {
        const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Number.POSITIVE_INFINITY;
        const aUpcoming = aTime >= now;
        const bUpcoming = bTime >= now;
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        return aUpcoming ? aTime - bTime : bTime - aTime;
      });
  }, [events, query, status]);

  const checklistEntries = useMemo<ChecklistEntry[]>(() => {
    const all = events.flatMap((event) => event.tasks.map((task) => ({ task, eventName: event.name })));
    const filtered = taskFilter === "ALL" ? all : all.filter(({ task }) => !task.completedAt);
    return filtered.sort((a, b) => (a.task.dueAt ?? "9999").localeCompare(b.task.dueAt ?? "9999")).slice(0, 50);
  }, [events, taskFilter]);

  const upcoming = useMemo(
    () =>
      events.filter(
        (event) => event.startsAt && new Date(event.startsAt).getTime() >= Date.now() && event.status !== "CANCELLED",
      ).length,
    [events],
  );
  const inProgress = useMemo(() => events.filter((event) => event.status === "IN_PROGRESS").length, [events]);
  const pendingTasks = useMemo(
    () => events.flatMap((event) => event.tasks).filter((task) => !task.completedAt).length,
    [events],
  );

  const requestedQuantity = Number(assignForm.quantity) || 0;
  const availabilityBlocked = Boolean(availability?.blocked);
  const exceedsAvailability = Boolean(availability && requestedQuantity > availability.available);
  // La propia asignación del evento no se cuenta como conflicto: el alta es upsert
  // por (evento, ítem) y el API excluye esa fila al validar.
  const existingAssignmentId =
    assignments.find((assignment) => assignment.inventory.id === assignForm.inventoryId)?.id ?? "";

  // Disponibilidad del ítem en el rango elegido: la calcula el API y la UI solo la muestra.
  useEffect(() => {
    if (!equipmentEvent || !assignForm.inventoryId || !assignForm.startsAt || !assignForm.endsAt) {
      setAvailability(null);
      setAvailabilityError("");
      setAvailabilityLoading(false);
      return;
    }
    const params = new URLSearchParams({
      inventoryId: assignForm.inventoryId,
      startsAt: assignForm.startsAt,
      endsAt: assignForm.endsAt,
    });
    if (existingAssignmentId) params.set("excludeId", existingAssignmentId);
    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailabilityError("");
    fetch(`/api/admin/inventory?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as { error?: string; availability?: AdminInventoryAvailability };
        if (!response.ok) throw new Error(payload.error || "No pudimos calcular la disponibilidad.");
        setAvailability(payload.availability ?? null);
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setAvailability(null);
        setAvailabilityError(error instanceof Error ? error.message : "No pudimos calcular la disponibilidad.");
      })
      .finally(() => setAvailabilityLoading(false));
    return () => controller.abort();
  }, [equipmentEvent, assignForm.inventoryId, assignForm.startsAt, assignForm.endsAt, existingAssignmentId]);

  async function submitEvent(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setFormError("");
    const result = await adminSend("/api/admin/events", {
      clientId: form.clientId,
      name: form.name,
      location: form.location || undefined,
      startsAt: form.startsAt || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setForm(EMPTY_EVENT_FORM);
    setShowForm(false);
    operations.reload();
  }

  async function submitTask(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setTaskBusy(true);
    setTaskError("");
    const result = await adminSend("/api/admin/event-ops", {
      kind: "task",
      eventId: taskForm.eventId,
      title: taskForm.title,
      type: taskForm.type,
      dueAt: taskForm.dueAt || undefined,
    });
    setTaskBusy(false);
    if (!result.ok) {
      setTaskError(result.error);
      return;
    }
    setTaskForm(EMPTY_TASK_FORM);
    operations.reload();
  }

  function selectEquipmentEvent(eventId: string) {
    const event = events.find((item) => item.id === eventId) ?? null;
    setEquipmentEventId(eventId);
    setAssignEditingId("");
    setAssignError("");
    setAssignNotice("");
    setEquipmentError("");
    setMovement(null);
    setAssignForm({
      ...EMPTY_ASSIGN_FORM,
      startsAt: inputDateTime(event?.setupAt ?? event?.startsAt),
      endsAt: inputDateTime(event?.strikeAt ?? event?.endsAt ?? event?.startsAt),
    });
  }

  function resetAssignForm() {
    setAssignEditingId("");
    setAssignError("");
    setAssignForm({
      ...EMPTY_ASSIGN_FORM,
      startsAt: inputDateTime(equipmentEvent?.setupAt ?? equipmentEvent?.startsAt),
      endsAt: inputDateTime(equipmentEvent?.strikeAt ?? equipmentEvent?.endsAt ?? equipmentEvent?.startsAt),
    });
  }

  function startEditAssignment(assignment: AdminEventAssignment) {
    setAssignEditingId(assignment.id);
    setAssignError("");
    setAssignNotice("");
    setMovement(null);
    setAssignForm({
      inventoryId: assignment.inventory.id,
      quantity: String(assignment.quantity),
      startsAt: inputDateTime(assignment.startsAt),
      endsAt: inputDateTime(assignment.endsAt),
    });
  }

  async function submitAssignment(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!equipmentEvent) return;
    setAssignBusy(true);
    setAssignError("");
    setAssignNotice("");
    const result = await adminSend("/api/admin/inventory", {
      kind: "assignment",
      eventId: equipmentEvent.id,
      inventoryId: assignForm.inventoryId,
      quantity: Number(assignForm.quantity) || 1,
      startsAt: assignForm.startsAt || undefined,
      endsAt: assignForm.endsAt || undefined,
    });
    setAssignBusy(false);
    if (!result.ok) {
      setAssignError(result.error);
      return;
    }
    setAssignNotice(assignEditingId ? "Asignación actualizada." : "Equipo asignado al evento.");
    setAssignForm({ ...EMPTY_ASSIGN_FORM, startsAt: assignForm.startsAt, endsAt: assignForm.endsAt });
    setAssignEditingId("");
    operations.reload();
    inventoryResource.reload();
  }

  function openMovement(mode: "checkout" | "checkin", assignment: AdminEventAssignment) {
    setMovement({ mode, assignment });
    setMovementError("");
    setMovementForm({
      ...EMPTY_MOVEMENT_FORM,
      at: inputDateTime(new Date()),
      condition: ITEM_CONDITIONS[0],
    });
  }

  async function submitMovement(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!movement) return;
    const damagedQuantity = Number(movementForm.damaged) || 0;
    const missingQuantity = Number(movementForm.missing) || 0;
    if (movement.mode === "checkin" && damagedQuantity + missingQuantity > movement.assignment.quantity) {
      setMovementError(`Dañadas y faltantes no pueden superar las ${movement.assignment.quantity} unidades asignadas.`);
      return;
    }
    setMovementBusy(true);
    setMovementError("");
    const result = await adminSend("/api/admin/inventory",
      movement.mode === "checkout"
        ? {
            kind: "checkout",
            id: movement.assignment.id,
            at: movementForm.at || undefined,
            conditionOut: movementForm.condition,
          }
        : {
            kind: "checkin",
            id: movement.assignment.id,
            at: movementForm.at || undefined,
            conditionIn: movementForm.condition,
            damagedQuantity,
            missingQuantity,
            damageNotes: movementForm.notes || undefined,
          },
    );
    setMovementBusy(false);
    if (!result.ok) {
      setMovementError(result.error);
      return;
    }
    setAssignNotice(
      movement.mode === "checkout"
        ? `Salida registrada: ${movement.assignment.inventory.name} (${formatNumber(movement.assignment.quantity)} u.).`
        : `Devolución registrada: ${movement.assignment.inventory.name} (${formatNumber(movement.assignment.quantity)} u.).`,
    );
    setMovement(null);
    operations.reload();
    inventoryResource.reload();
  }

  async function removeAssignment(assignment: AdminEventAssignment) {
    setEquipmentError("");
    setAssignNotice("");
    const result = await adminSend("/api/admin/inventory", { kind: "assignment-delete", id: assignment.id });
    if (!result.ok) {
      setEquipmentError(result.error);
      return;
    }
    setAssignNotice(`Asignación quitada: ${assignment.inventory.name}.`);
    operations.reload();
    inventoryResource.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de eventos">
        <AdminKpi label="Eventos" value={formatNumber(events.length)} note="cargados" />
        <AdminKpi label="Próximos" value={formatNumber(upcoming)} note="con fecha futura" tone="accent" />
        <AdminKpi label="En curso" value={formatNumber(inProgress)} note="operación activa" />
        <AdminKpi
          label="Tareas pendientes"
          value={formatNumber(pendingTasks)}
          note="checklist operativo"
          tone={pendingTasks > 0 ? "warn" : "ok"}
        />
      </section>

      <AdminToolbar>
        <AdminSearchField value={query} onChange={setQuery} label="Buscar eventos" placeholder="Buscar por evento, cliente o lugar…" />
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
            Nuevo evento
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo evento"
          submitLabel="Crear evento"
          onSubmit={submitEvent}
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
          <AdminField label="Nombre del evento">
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ej.: Lanzamiento Samsung"
            />
          </AdminField>
          <AdminField label="Lugar">
            <input
              maxLength={160}
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              placeholder="Ej.: Centro de Convenciones"
            />
          </AdminField>
          <AdminField label="Inicio" hint="Fecha y hora del evento">
            <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
          </AdminField>
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={operations.loading}
        error={operations.error}
        onRetry={operations.reload}
        empty={events.length === 0}
        emptyTitle="Todavía no hay eventos"
        emptyHint="Creá un evento para activar su checklist de montaje, evento, desmontaje y cobro."
      >
        <AdminTable
          view="eventos"
          label="Eventos"
          columns={[
            { label: "Fecha" },
            { label: "Evento" },
            { label: "Cliente" },
            { label: "Lugar" },
            { label: "Equipos", end: true },
            { label: "Checklist", end: true },
            { label: "Estado" },
            { label: "Acciones", end: true },
          ]}
        >
          {rows.map((event) => {
            const units = event.assignments.reduce((sum, assignment) => sum + assignment.quantity, 0);
            const done = event.tasks.filter((task) => task.completedAt).length;
            const equipmentNames = event.assignments.map((assignment) => assignment.inventory.name).join(", ");
            return (
              <AdminRow key={event.id}>
                <AdminCell title={event.startsAt ? formatDateTime(event.startsAt) : "Fecha a confirmar"}>
                  {event.startsAt ? `${formatDateShort(event.startsAt)} · ${formatTime(event.startsAt)}` : "A confirmar"}
                </AdminCell>
                <AdminCell title={event.name}>
                  <strong>{event.name}</strong>
                </AdminCell>
                <AdminCell title={event.client.company || event.client.name}>{event.client.company || event.client.name}</AdminCell>
                <AdminCell title={event.location || "Sin lugar definido"}>{event.location || "—"}</AdminCell>
                <AdminCell end title={equipmentNames || "Sin equipos asignados"}>
                  {formatNumber(units)}
                </AdminCell>
                <AdminCell end title={`${done} de ${event.tasks.length} tareas cumplidas`}>
                  {done}/{event.tasks.length}
                </AdminCell>
                <AdminCell>
                  <AdminBadge tone={statusTone(event.status)}>{eventStatusLabel(event.status)}</AdminBadge>
                </AdminCell>
                <AdminCell end className="admin-cell--actions">
                  <span className="admin-actions">
                    <AdminIconLink
                      href={`/imprimir/evento/${event.id}`}
                      icon="print"
                      label={`Imprimir orden de trabajo: ${event.name}`}
                      external
                    />
                  </span>
                </AdminCell>
              </AdminRow>
            );
          })}
        </AdminTable>
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : null}
      </AdminDataState>

      <AdminPanel
        title="Equipos asignados"
        meta={
          equipmentEvent
            ? `${formatNumber(assignedUnits)} unidades · ${formatNumber(assignments.length)} asignaciones`
            : "elegí un evento"
        }
        action={
          <AdminSelect
            value={equipmentEventId}
            onChange={selectEquipmentEvent}
            label="Evento para asignar equipos"
            options={[{ value: "", label: "Elegí un evento…" }, ...events.map((event) => ({ value: event.id, label: event.name }))]}
          />
        }
      >
        {!equipmentEvent ? (
          <AdminEmpty
            icon="inventory"
            title="Elegí un evento"
            hint="Seleccioná el evento para ver sus equipos, asignar con fechas y registrar salida o devolución."
          />
        ) : (
          <>
            {writable ? (
              <form className="admin-inline-form" onSubmit={submitAssignment}>
                <select
                  required
                  value={assignForm.inventoryId}
                  onChange={(event) => setAssignForm({ ...assignForm, inventoryId: event.target.value })}
                  aria-label="Ítem de inventario"
                  title="Ítem de inventario"
                  disabled={Boolean(assignEditingId)}
                >
                  <option value="">Ítem de inventario…</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.sku ? ` · ${item.sku}` : ""} · {formatNumber(item.availability.availableNow)} libres
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  className="admin-qty-input"
                  value={assignForm.quantity}
                  onChange={(event) => setAssignForm({ ...assignForm, quantity: event.target.value })}
                  aria-label="Cantidad de unidades"
                  title="Cantidad de unidades"
                  inputMode="numeric"
                />
                <input
                  type="datetime-local"
                  required
                  value={assignForm.startsAt}
                  onChange={(event) => setAssignForm({ ...assignForm, startsAt: event.target.value })}
                  aria-label="Inicio del rango asignado"
                  title="Inicio del rango asignado"
                />
                <input
                  type="datetime-local"
                  required
                  value={assignForm.endsAt}
                  onChange={(event) => setAssignForm({ ...assignForm, endsAt: event.target.value })}
                  aria-label="Fin del rango asignado"
                  title="Fin del rango asignado"
                />
                <AdminButton
                  type="submit"
                  variant="primary"
                  icon={assignEditingId ? "check" : "plus"}
                  busy={assignBusy}
                  disabled={availabilityBlocked || exceedsAvailability}
                >
                  {assignEditingId ? "Guardar" : "Asignar"}
                </AdminButton>
                {assignEditingId ? (
                  <AdminButton type="button" onClick={resetAssignForm} disabled={assignBusy}>
                    Cancelar
                  </AdminButton>
                ) : null}
              </form>
            ) : null}

            {writable ? (
              assignForm.inventoryId && assignForm.startsAt && assignForm.endsAt ? (
                availabilityLoading ? (
                  <AdminNote>Calculando disponibilidad…</AdminNote>
                ) : availabilityError ? (
                  <AdminNote tone="error">{availabilityError}</AdminNote>
                ) : availability ? (
                  <AdminNote tone={availabilityBlocked || exceedsAvailability ? "error" : undefined}>
                    {availabilityBlocked
                      ? `«${availability.name}» está ${availability.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`
                      : `${formatNumber(availability.available)} de ${formatNumber(availability.total)} unidades disponibles en el rango.`}
                    {availability.conflicts.length > 0
                      ? ` Ocupadas: ${availability.conflicts
                          .map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`)
                          .join(", ")}.`
                      : ""}
                    {exceedsAvailability ? ` Pediste ${formatNumber(requestedQuantity)}.` : ""}
                  </AdminNote>
                ) : null
              ) : (
                <AdminNote>Elegí el ítem y el rango de fechas para ver la disponibilidad.</AdminNote>
              )
            ) : null}

            {assignError ? <AdminNote tone="error">{assignError}</AdminNote> : null}
            {assignNotice ? <AdminNote tone="ok">{assignNotice}</AdminNote> : null}
            {equipmentError ? <AdminNote tone="error">{equipmentError}</AdminNote> : null}

            {movement ? (
              <AdminFormPanel
                title={
                  movement.mode === "checkout"
                    ? `Registrar salida · ${movement.assignment.inventory.name}`
                    : `Registrar devolución · ${movement.assignment.inventory.name}`
                }
                submitLabel={movement.mode === "checkout" ? "Registrar salida" : "Registrar devolución"}
                onSubmit={submitMovement}
                onCancel={() => setMovement(null)}
                busy={movementBusy}
                status={movementError}
              >
                <AdminField
                  label={movement.mode === "checkout" ? "Fecha y hora de salida" : "Fecha y hora de devolución"}
                  hint={`${formatNumber(movement.assignment.quantity)} unidades asignadas`}
                >
                  <input
                    type="datetime-local"
                    required
                    value={movementForm.at}
                    onChange={(event) => setMovementForm({ ...movementForm, at: event.target.value })}
                  />
                </AdminField>
                <AdminField label={movement.mode === "checkout" ? "Estado al retirar" : "Estado al devolver"}>
                  <select
                    value={movementForm.condition}
                    onChange={(event) => setMovementForm({ ...movementForm, condition: event.target.value })}
                  >
                    {ITEM_CONDITIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {condition}
                      </option>
                    ))}
                  </select>
                </AdminField>
                {movement.mode === "checkin" ? (
                  <>
                    <AdminField label="Unidades dañadas">
                      <input
                        type="number"
                        min="0"
                        max={movement.assignment.quantity}
                        step="1"
                        value={movementForm.damaged}
                        onChange={(event) => setMovementForm({ ...movementForm, damaged: event.target.value })}
                        inputMode="numeric"
                      />
                    </AdminField>
                    <AdminField label="Unidades faltantes">
                      <input
                        type="number"
                        min="0"
                        max={movement.assignment.quantity}
                        step="1"
                        value={movementForm.missing}
                        onChange={(event) => setMovementForm({ ...movementForm, missing: event.target.value })}
                        inputMode="numeric"
                      />
                    </AdminField>
                    <AdminField label="Notas" hint="Detalle de daños o faltantes (opcional)" wide>
                      <textarea
                        rows={2}
                        maxLength={400}
                        value={movementForm.notes}
                        onChange={(event) => setMovementForm({ ...movementForm, notes: event.target.value })}
                      />
                    </AdminField>
                  </>
                ) : null}
              </AdminFormPanel>
            ) : null}

            <AdminDataState
              loading={operations.loading}
              error={operations.error}
              onRetry={operations.reload}
              empty={assignments.length === 0}
              emptyTitle="Sin equipos asignados"
              emptyHint="Asigná equipos con cantidad y rango de fechas: el sistema valida la disponibilidad real."
              rows={4}
            >
              <AdminTable
                view="evento-equipos"
                label={`Equipos asignados a ${equipmentEvent.name}`}
                columns={[
                  { label: "Artículo" },
                  { label: "Cantidad", end: true },
                  { label: "Rango" },
                  { label: "Salida" },
                  { label: "Devolución" },
                  { label: "Estado" },
                  { label: "Daños" },
                  { label: "Acciones", end: true },
                ]}
              >
                {assignments.map((assignment) => {
                  const state = inventoryAssignmentState(assignment);
                  const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
                  const isOut = Boolean(assignment.checkedOutAt || assignment.checkedOut);
                  const isBack = Boolean(assignment.checkedInAt || assignment.checkedIn);
                  const startsAt = assignment.startsAt ?? equipmentEvent.setupAt ?? equipmentEvent.startsAt;
                  const endsAt = assignment.endsAt ?? equipmentEvent.strikeAt ?? equipmentEvent.endsAt ?? startsAt;
                  return (
                    <AdminRow key={assignment.id}>
                      <AdminCell title={assignment.inventory.name}>
                        <strong>{assignment.inventory.name}</strong>
                        {assignment.inventory.sku ? <span className="admin-code"> · {assignment.inventory.sku}</span> : null}
                      </AdminCell>
                      <AdminCell end title={`${formatNumber(assignment.quantity)} unidades`}>
                        {formatNumber(assignment.quantity)}
                      </AdminCell>
                      <AdminCell title={startsAt && endsAt ? rangeStamp(startsAt, endsAt) : "Sin fechas"}>
                        {rangeStamp(startsAt, endsAt)}
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
                      <AdminCell end className="admin-cell--actions">
                        <span className="admin-actions">
                          {writable && !isOut && !isBack ? (
                            <>
                              <AdminButton
                                title={`Registrar salida: ${assignment.inventory.name}`}
                                aria-label={`Registrar salida: ${assignment.inventory.name}`}
                                onClick={() => openMovement("checkout", assignment)}
                              >
                                Salida
                              </AdminButton>
                              <AdminButton
                                title={`Editar asignación: ${assignment.inventory.name}`}
                                aria-label={`Editar asignación: ${assignment.inventory.name}`}
                                onClick={() => startEditAssignment(assignment)}
                              >
                                Editar
                              </AdminButton>
                              <AdminButton
                                icon="close"
                                title={`Quitar asignación: ${assignment.inventory.name}`}
                                aria-label={`Quitar asignación: ${assignment.inventory.name}`}
                                onClick={() => void removeAssignment(assignment)}
                              />
                            </>
                          ) : writable && isOut && !isBack ? (
                            <AdminButton
                              title={`Registrar devolución: ${assignment.inventory.name}`}
                              aria-label={`Registrar devolución: ${assignment.inventory.name}`}
                              onClick={() => openMovement("checkin", assignment)}
                            >
                              Devolución
                            </AdminButton>
                          ) : (
                            <span className="admin-muted">—</span>
                          )}
                        </span>
                      </AdminCell>
                    </AdminRow>
                  );
                })}
              </AdminTable>
            </AdminDataState>
          </>
        )}
      </AdminPanel>

      <AdminPanel
        title="Checklist operativo"
        meta={`${formatNumber(pendingTasks)} pendientes`}
        action={
          <AdminSelect
            value={taskFilter}
            onChange={setTaskFilter}
            label="Filtrar tareas"
            options={[
              { value: "PENDING", label: "Solo pendientes" },
              { value: "ALL", label: "Todas las tareas" },
            ]}
          />
        }
      >
        {checklistWritable ? (
          <form className="admin-inline-form" onSubmit={submitTask}>
            <select
              required
              value={taskForm.eventId}
              onChange={(event) => setTaskForm({ ...taskForm, eventId: event.target.value })}
              aria-label="Evento de la tarea"
            >
              <option value="">Evento…</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
            <input
              required
              maxLength={120}
              value={taskForm.title}
              onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
              placeholder="Nueva tarea operativa"
              aria-label="Título de la tarea"
            />
            <select value={taskForm.type} onChange={(event) => setTaskForm({ ...taskForm, type: event.target.value })} aria-label="Tipo de tarea">
              {TASK_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={taskForm.dueAt}
              onChange={(event) => setTaskForm({ ...taskForm, dueAt: event.target.value })}
              aria-label="Vencimiento de la tarea"
              title="Vencimiento (opcional)"
            />
            <AdminButton type="submit" variant="primary" icon="plus" busy={taskBusy}>
              Agregar tarea
            </AdminButton>
          </form>
        ) : null}

        {taskError ? <AdminNote tone="error">{taskError}</AdminNote> : null}
        {checklistError ? <AdminNote tone="error">{checklistError}</AdminNote> : null}

        <AdminDataState
          loading={operations.loading}
          error={operations.error}
          onRetry={operations.reload}
          empty={checklistEntries.length === 0}
          emptyTitle={taskFilter === "PENDING" ? "Checklist al día" : "Sin tareas cargadas"}
          emptyHint="Las tareas base se generan al crear un evento y se pueden sumar a mano."
          rows={4}
        >
          <ChecklistTable
            entries={checklistEntries}
            canToggle={checklistWritable}
            onChanged={() => operations.reload()}
            onError={setChecklistError}
            emptyHint="No hay tareas en este filtro."
          />
        </AdminDataState>

        {checklistEntries.length === 50 ? <AdminNote>Mostrando las primeras 50 tareas del filtro.</AdminNote> : null}
      </AdminPanel>
    </div>
  );
}
