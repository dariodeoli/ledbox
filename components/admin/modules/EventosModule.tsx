"use client";

import { useEffect, useMemo, useState } from "react";
import {
  damageSummary,
  eventStatusLabel,
  checklistProgress,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatSince,
  formatTime,
  inventoryAssignmentState,
  isOverdue,
  isUpcomingWithin,
  ITEM_CONDITIONS,
  promoterAvailabilityDetail,
  promoterAvailabilityLabel,
  promoterAvailabilityTone,
  statusTone,
} from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import {
  promoterIsAvailable,
  type AdminEventAssignment,
  type AdminEventRow,
  type AdminInventoryAvailability,
  type AdminInventoryItemRow,
  type AdminPromoterRow,
} from "@/lib/admin-types";
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
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import {
  DateField,
  DateTimeField,
  NumberField,
  SearchField,
  SelectField,
  TextAreaField,
  TextField,
} from "../AdminFields";
import { adminApiGet, adminSend, useAdminResource } from "@/lib/admin-api";
import { queuedActionForAssignment, type OfflineAction } from "@/lib/offline-queue";
import { useOfflineQueue } from "../AdminOffline";
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
const EMPTY_TASK_FORM = { eventId: "", title: "", type: "EVENT", dueAt: "", promoterId: "" };
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

/** Rango asignado en una línea: `09-oct. 08:00 → 12-oct. 20:00` (fin abierto si falta). */
function rangeStamp(start: string | null, end: string | null): string {
  if (!start && !end) return "Sin fechas";
  if (start && !end) return `${formatDateShort(start)} ${formatTime(start)} → sin fin`;
  if (!start && end) return `sin inicio → ${formatDateShort(end)} ${formatTime(end)}`;
  return `${formatDateShort(start)} ${formatTime(start)} → ${formatDateShort(end)} ${formatTime(end)}`;
}

const BLOCKED_INVENTORY_STATUSES = ["MAINTENANCE", "RETIRED"];

/** Motivo honesto del marcador de una acción de campo en cola (issue #23). */
function movementQueueTitle(action: OfflineAction): string {
  return action.status === "failed"
    ? `No se pudo subir: ${action.error ?? "sin motivo informado"}. Reintentá desde el indicador de sincronización.`
    : `Guardada en este equipo ${formatSince(action.createdAt)}: se sube al volver la señal.`;
}

/** Evento próximo (ventana de aviso de 7 días) sin tareas cumplidas: riesgo. */
function isUpcomingEvent(event: AdminEventRow): boolean {
  if (event.status === "CANCELLED" || event.status === "COMPLETED") return false;
  return isUpcomingWithin(event.startsAt);
}

/** Opciones de promotora para el checklist: el estado real viaja en la etiqueta. */
function promoterOptions(promoters: AdminPromoterRow[]): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "Sin promotora (equipo)" },
    ...promoters.map((promoter) => ({
      value: promoter.id,
      label:
        promoter.availability === "AVAILABLE"
          ? promoter.name
          : `${promoter.name} · ${promoterAvailabilityLabel(promoter.availability)}`,
    })),
  ];
}

export function EventosModule() {
  const { role } = useAdminSession();
  const { actions: queuedActions, fieldAction } = useOfflineQueue();
  const operations = useAdminResource("/api/admin/event-ops", (payload) => payload.events ?? []);
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  const inventoryResource = useAdminResource(
    "/api/admin/inventory",
    (payload) => (payload.inventory ?? []) as AdminInventoryItemRow[],
  );
  // Promotoras con su disponibilidad real: la asignación avisa, no bloquea (issue #24).
  const promotersResource = useAdminResource("/api/admin/resources", (payload) => payload.promoters ?? []);

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
  const [taskNotice, setTaskNotice] = useState("");
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
  const promoters = useMemo(() => promotersResource.data ?? [], [promotersResource.data]);
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
  /** Tareas pendientes con vencimiento pasado: el checklist real, no el ideal. */
  const overdueTasks = useMemo(
    () => events.flatMap((event) => event.tasks).filter((task) => !task.completedAt && isOverdue(task.dueAt)).length,
    [events],
  );
  /** Eventos próximos con checklist cargado y 0 tareas cumplidas (riesgo operativo). */
  const atRiskEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          isUpcomingEvent(event) && event.tasks.length > 0 && event.tasks.every((task) => !task.completedAt),
      ),
    [events],
  );
  /** Tareas con promotora no disponible o a definir: se avisan, no se bloquean. */
  const promoterConflicts = useMemo(
    () =>
      events
        .flatMap((event) => event.tasks.map((task) => ({ task, event })))
        .filter(({ task }) => task.promoter && !promoterIsAvailable(task.promoter))
        .sort((a, b) => (a.task.dueAt ?? "9999").localeCompare(b.task.dueAt ?? "9999")),
    [events],
  );

  const selectedPromoter = useMemo(
    () => promoters.find((promoter) => promoter.id === taskForm.promoterId) ?? null,
    [promoters, taskForm.promoterId],
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
    void adminApiGet<{ availability?: AdminInventoryAvailability }>(`/api/admin/inventory?${params.toString()}`, {
      fresh: true,
      signal: controller.signal,
      fallbackError: "No pudimos calcular la disponibilidad.",
    })
      .then((result) => {
        if (!result.ok) {
          if (result.aborted) return;
          setAvailability(null);
          setAvailabilityError(result.error);
          return;
        }
        setAvailability(result.data.availability ?? null);
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
    setTaskNotice("");
    const promoter = promoters.find((candidate) => candidate.id === taskForm.promoterId) ?? null;
    const result = await adminSend("/api/admin/event-ops", {
      kind: "task",
      eventId: taskForm.eventId,
      title: taskForm.title,
      type: taskForm.type,
      dueAt: taskForm.dueAt || undefined,
      promoterId: taskForm.promoterId || undefined,
    });
    setTaskBusy(false);
    if (!result.ok) {
      setTaskError(result.error);
      return;
    }
    setTaskNotice(
      promoter && !promoterIsAvailable(promoter)
        ? `Tarea creada con «${promoter.name}» (${promoterAvailabilityLabel(promoter.availability).toLowerCase()}${
            promoterAvailabilityDetail(promoter) ? `: ${promoterAvailabilityDetail(promoter)}` : ""
          }). Revisá la asignación o cubrila con otra persona.`
        : "",
    );
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
    const checkout = movement.mode === "checkout";
    const damages = damageSummary(damagedQuantity, missingQuantity);
    // Mismo contrato que el panel online; sin conexión el provider lo guarda en la cola local.
    const result = await fieldAction({
      kind: checkout ? "inventory-checkout" : "inventory-checkin",
      path: "/api/admin/inventory",
      body: checkout
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
      summary: `${checkout ? "Salida" : "Devolución"} de «${movement.assignment.inventory.name}» (${formatNumber(
        movement.assignment.quantity,
      )} u.)${!checkout && damages ? ` · ${damages}` : ""}`,
      detail: `Evento: ${equipmentEvent?.name ?? "sin evento"}`,
    });
    setMovementBusy(false);
    if (!result.ok) {
      setMovementError(result.error);
      return;
    }
    const label = checkout ? "Salida" : "Devolución";
    setAssignNotice(
      result.queued
        ? `Sin conexión: la ${label.toLowerCase()} quedó guardada en este equipo y se sube al volver la señal.`
        : `${label} registrada: ${movement.assignment.inventory.name} (${formatNumber(movement.assignment.quantity)} u.).`,
    );
    setMovement(null);
    if (!result.queued) {
      operations.reload();
      inventoryResource.reload();
    }
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
          note={
            overdueTasks > 0
              ? `${formatNumber(overdueTasks)} vencida${overdueTasks === 1 ? "" : "s"}`
              : "checklist operativo"
          }
          tone={overdueTasks > 0 ? "warn" : "ok"}
        />
        <AdminKpi
          label="Checklist en riesgo"
          value={formatNumber(atRiskEvents.length)}
          note="próximos sin tareas cumplidas"
          tone={atRiskEvents.length > 0 ? "danger" : "ok"}
        />
      </section>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar eventos" placeholder="Buscar por evento, cliente o lugar…" />
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
          <SelectField
            label="Cliente"
            required
            value={form.clientId}
            onChange={(value) => setForm({ ...form, clientId: value })}
            options={[
              { value: "", label: "Elegí un cliente…" },
              ...clientOptions.map((client) => ({ value: client.id, label: client.company || client.name })),
            ]}
          />
          <TextField
            label="Nombre del evento"
            required
            maxLength={120}
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
            placeholder="Ej.: Lanzamiento Samsung"
          />
          <TextField
            label="Lugar"
            maxLength={160}
            value={form.location}
            onChange={(value) => setForm({ ...form, location: value })}
            placeholder="Ej.: Centro de Convenciones"
          />
          <DateTimeField
            label="Inicio"
            hint="Fecha y hora del evento"
            value={form.startsAt}
            onChange={(value) => setForm({ ...form, startsAt: value })}
          />
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
            const progress = checklistProgress(event.tasks, { risk: isUpcomingEvent(event) });
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
                <AdminCell end title={progress.title}>
                  {event.tasks.length === 0 ? (
                    <span className="admin-muted">—</span>
                  ) : (
                    <AdminBadge tone={progress.tone}>{progress.label}</AdminBadge>
                  )}
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
                <AdminSelect
                  className=""
                  required
                  value={assignForm.inventoryId}
                  onChange={(value) => setAssignForm({ ...assignForm, inventoryId: value })}
                  label="Ítem de inventario"
                  title="Ítem de inventario"
                  disabled={Boolean(assignEditingId)}
                  options={[
                    { value: "", label: "Ítem de inventario…" },
                    ...inventoryItems.map((item) => ({
                      value: item.id,
                      label: `${item.name}${item.sku ? ` · ${item.sku}` : ""} · ${formatNumber(item.availability.availableNow)} libres`,
                    })),
                  ]}
                />
                <NumberField
                  ariaLabel="Cantidad de unidades"
                  title="Cantidad de unidades"
                  className="admin-qty-input"
                  required
                  value={assignForm.quantity}
                  onChange={(value) => setAssignForm({ ...assignForm, quantity: value })}
                />
                <DateTimeField
                  ariaLabel="Inicio del rango asignado"
                  title="Inicio del rango asignado"
                  required
                  value={assignForm.startsAt}
                  onChange={(value) => setAssignForm({ ...assignForm, startsAt: value })}
                />
                <DateTimeField
                  ariaLabel="Fin del rango asignado"
                  title="Fin del rango asignado"
                  required
                  value={assignForm.endsAt}
                  onChange={(value) => setAssignForm({ ...assignForm, endsAt: value })}
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
                <DateTimeField
                  label={movement.mode === "checkout" ? "Fecha y hora de salida" : "Fecha y hora de devolución"}
                  hint={`${formatNumber(movement.assignment.quantity)} unidades asignadas`}
                  required
                  value={movementForm.at}
                  onChange={(value) => setMovementForm({ ...movementForm, at: value })}
                />
                <SelectField
                  label={movement.mode === "checkout" ? "Estado al retirar" : "Estado al devolver"}
                  value={movementForm.condition}
                  onChange={(value) => setMovementForm({ ...movementForm, condition: value })}
                  options={ITEM_CONDITIONS.map((condition) => ({ value: condition, label: condition }))}
                />
                {movement.mode === "checkin" ? (
                  <>
                    <NumberField
                      label="Unidades dañadas"
                      maxLength={6}
                      value={movementForm.damaged}
                      onChange={(value) => setMovementForm({ ...movementForm, damaged: value })}
                    />
                    <NumberField
                      label="Unidades faltantes"
                      maxLength={6}
                      value={movementForm.missing}
                      onChange={(value) => setMovementForm({ ...movementForm, missing: value })}
                    />
                    <TextAreaField
                      label="Notas"
                      hint="Detalle de daños o faltantes (opcional)"
                      wide
                      rows={2}
                      maxLength={400}
                      value={movementForm.notes}
                      onChange={(value) => setMovementForm({ ...movementForm, notes: value })}
                    />
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
                  // Acción de campo en cola (issue #23): el estado mostrado refleja la
                  // intención local y el badge "Sin subir" avisa que falta confirmación.
                  const queuedMovement = queuedActionForAssignment(queuedActions, assignment.id);
                  const queuedOut = queuedMovement?.kind === "inventory-checkout" ? queuedMovement : null;
                  const queuedBack = queuedMovement?.kind === "inventory-checkin" ? queuedMovement : null;
                  const state = inventoryAssignmentState(
                    queuedMovement
                      ? queuedOut
                        ? { ...assignment, checkedOut: true, checkedOutAt: assignment.checkedOutAt ?? queuedMovement.createdAt }
                        : { ...assignment, checkedIn: true, checkedInAt: assignment.checkedInAt ?? queuedMovement.createdAt }
                      : assignment,
                  );
                  const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
                  const isOut = Boolean(assignment.checkedOutAt || assignment.checkedOut || queuedOut);
                  const isBack = Boolean(assignment.checkedInAt || assignment.checkedIn || queuedBack);
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
                      <AdminCell title={queuedOut ? movementQueueTitle(queuedOut) : assignment.checkedOutAt ? `Salida: ${stamp(assignment.checkedOutAt)}` : undefined}>
                        {queuedOut ? (
                          <AdminBadge tone={queuedOut.status === "failed" ? "danger" : "warn"} title={movementQueueTitle(queuedOut)}>
                            {queuedOut.status === "failed" ? "Falló" : "Sin subir"}
                          </AdminBadge>
                        ) : (
                          stamp(assignment.checkedOutAt)
                        )}
                      </AdminCell>
                      <AdminCell title={queuedBack ? movementQueueTitle(queuedBack) : assignment.checkedInAt ? `Devolución: ${stamp(assignment.checkedInAt)}` : undefined}>
                        {queuedBack ? (
                          <AdminBadge tone={queuedBack.status === "failed" ? "danger" : "warn"} title={movementQueueTitle(queuedBack)}>
                            {queuedBack.status === "failed" ? "Falló" : "Sin subir"}
                          </AdminBadge>
                        ) : (
                          stamp(assignment.checkedInAt)
                        )}
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
            <AdminSelect
              className=""
              required
              value={taskForm.eventId}
              onChange={(value) => setTaskForm({ ...taskForm, eventId: value })}
              label="Evento de la tarea"
              options={[{ value: "", label: "Evento…" }, ...events.map((event) => ({ value: event.id, label: event.name }))]}
            />
            <TextField
              ariaLabel="Título de la tarea"
              required
              maxLength={120}
              value={taskForm.title}
              onChange={(value) => setTaskForm({ ...taskForm, title: value })}
              placeholder="Nueva tarea operativa"
            />
            <AdminSelect
              className=""
              value={taskForm.type}
              onChange={(value) => setTaskForm({ ...taskForm, type: value })}
              label="Tipo de tarea"
              options={TASK_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <AdminSelect
              className=""
              value={taskForm.promoterId}
              onChange={(value) => setTaskForm({ ...taskForm, promoterId: value })}
              label="Promotora de la tarea"
              title="Promotora asignada (opcional)"
              options={promoterOptions(promoters)}
            />
            <DateField
              ariaLabel="Vencimiento de la tarea"
              title="Vencimiento (opcional)"
              value={taskForm.dueAt}
              onChange={(value) => setTaskForm({ ...taskForm, dueAt: value })}
            />
            <AdminButton type="submit" variant="primary" icon="plus" busy={taskBusy}>
              Agregar tarea
            </AdminButton>
          </form>
        ) : null}

        {selectedPromoter && !promoterIsAvailable(selectedPromoter) ? (
          <AdminNote>
            <AdminBadge tone={promoterAvailabilityTone(selectedPromoter.availability)}>
              {promoterAvailabilityLabel(selectedPromoter.availability)}
            </AdminBadge>
            <span>
              <strong>{selectedPromoter.name}</strong>
              {promoterAvailabilityDetail(selectedPromoter) ? `: ${promoterAvailabilityDetail(selectedPromoter)}.` : "."} Podés
              asignarla igual: la tarea queda y el conflicto se ve en el checklist.
            </span>
          </AdminNote>
        ) : null}

        {promoterConflicts.length > 0 ? (
          <>
            {promoterConflicts.slice(0, 3).map(({ task, event }) => (
              <AdminNote key={task.id}>
                <AdminBadge tone={promoterAvailabilityTone(task.promoter?.availability)}>
                  {promoterAvailabilityLabel(task.promoter?.availability)}
                </AdminBadge>
                <span>
                  <strong>{task.promoter?.name}</strong> está asignada a «{task.title}» ({event.name}) —{" "}
                  {promoterAvailabilityDetail(task.promoter) || "sin detalle cargado"}. Revisá la asignación o cubrila con otra
                  persona.
                </span>
              </AdminNote>
            ))}
            {promoterConflicts.length > 3 ? (
              <AdminNote>
                Hay {formatNumber(promoterConflicts.length - 3)} asignación{promoterConflicts.length - 3 === 1 ? "" : "es"} más
                con la promotora no disponible.
              </AdminNote>
            ) : null}
          </>
        ) : null}

        {taskError ? <AdminNote tone="error">{taskError}</AdminNote> : null}
        {taskNotice ? <AdminNote tone="ok">{taskNotice}</AdminNote> : null}
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
