"use client";

import { useMemo, useState } from "react";
import {
  eventStatusLabel,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatTime,
  statusTone,
} from "@/lib/admin-format";
import { canWrite, canWriteOperations, matchesQuery } from "@/lib/admin-policy";
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

export function EventosModule() {
  const { role } = useAdminSession();
  const operations = useAdminResource("/api/admin/event-ops", (payload) => payload.events ?? []);
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);

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

  const writable = canWrite(role);
  const checklistWritable = canWriteOperations(role);
  const events = useMemo(() => operations.data ?? [], [operations.data]);
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);

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
              </AdminRow>
            );
          })}
        </AdminTable>
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : null}
      </AdminDataState>

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
