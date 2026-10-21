"use client";
import { ClientIdentityView } from "../ClientIdentity";
import { Combobox } from "../AdminFields";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  budgetStatusLabel,
  damageSummary,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatSince,
  formatTime,
  inventoryAssignmentCountdown,
  inventoryAssignmentState,
  promoterAvailabilityDetail,
  promoterAvailabilityLabel,
  promoterAvailabilityTone,
  statusTone,
  whatsappHref,
} from "@/lib/admin-format";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import {
  promoterIsAvailable,
  type AdminBudgetRow,
  type AdminEventAssignment,
  type AdminEventPanelRow,
  type AdminInventoryAvailability,
  type AdminInventoryOption,
  type AdminPromoterOption,
} from "@/lib/admin-types";
import { adminApiGet, adminSend } from "@/lib/admin-api";
import { assignmentControls, type EventBudgetSummary, type EventDetailTab, type QueuedMovement } from "@/lib/event-readiness";
import { queuedActionForAssignment, type OfflineAction } from "@/lib/offline-queue";
import {
  AdminActionsMenu,
  AdminBadge,
  AdminButton,
  AdminCountdown,
  AdminDataState,
  AdminDialog,
  AdminEmpty,
  AdminNote,
  AdminSelect,
  AdminTimelineLoader,
  type AdminMenuItem,
  AdminTabs,
} from "../AdminUI";
import { AdminIcon } from "../AdminIcons";
import { DateField, DateTimeField, NumberField, TextField } from "../AdminFields";
import { RemitosPanel } from "./RemitosPanel";
import { StageTrail } from "../StageTrail";
import { stagesOfBudget } from "./BudgetDetailDialog";
import { ChecklistTable, type ChecklistEntry } from "./Checklist";
import { InventoryIncidentsPanel } from "./InventoryIncidents";
import { EventStateBadges, NextActionButton, type EventItem } from "./EventoLista";

/** Valor para `datetime-local` en hora local del navegador (es-PY, 24 h). */
export function inputDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const TASK_TYPE_OPTIONS = [
  { value: "SETUP", label: "Montaje" },
  { value: "EVENT", label: "Evento" },
  { value: "STRIKE", label: "Desmontaje" },
  { value: "PAYMENT", label: "Pago" },
  { value: "COLLECTION", label: "Cobro" },
];

const EMPTY_TASK_FORM = { title: "", type: "EVENT", dueAt: "", promoterId: "" };
const EMPTY_ASSIGN_FORM = { inventoryId: "", quantity: "1", startsAt: "", endsAt: "" };

const TABS: Array<{ key: EventDetailTab; label: string }> = [
  { key: "resumen", label: "Resumen" },
  { key: "checklist", label: "Checklist" },
  { key: "equipos", label: "Equipos" },
  { key: "personal", label: "Personal" },
  { key: "historial", label: "Historial" },
];

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

/** Motivo honesto del marcador de una acción de campo en cola (issue #23). */
function movementQueueTitle(action: OfflineAction): string {
  return action.status === "failed"
    ? `No se pudo subir: ${action.error ?? "sin motivo informado"}. Reintentá desde el indicador de sincronización.`
    : `Guardada en este equipo ${formatSince(action.createdAt)}: se sube al volver la señal.`;
}

/** Opciones de promotora para el checklist: el estado real viaja en la etiqueta. */
function promoterOptions(promoters: AdminPromoterOption[]): Array<{ value: string; label: string }> {
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

export function queuedKind(actions: readonly OfflineAction[], assignmentId: string): QueuedMovement {
  const action = queuedActionForAssignment(actions, assignmentId);
  return action?.kind === "inventory-checkout" ? "out" : action?.kind === "inventory-checkin" ? "back" : null;
}

export type EventoFichaProps = {
  item: EventItem;
  tab: EventDetailTab;
  onTab: (tab: EventDetailTab) => void;
  onClose: () => void;
  writable: boolean;
  /** Seña y presupuesto vinculado (lectura liviana). */
  budget: EventBudgetSummary | null;
  /** Presupuesto completo, solo para las etapas; `null` si no llegó. */
  stageBudget: AdminBudgetRow | null;
  budgetState: "loading" | "error" | "ready";
  promoters: AdminPromoterOption[];
  inventoryItems: AdminInventoryOption[];
  onSearchInventory: (query: string) => void;
  queuedActions: readonly OfflineAction[];
  /** Aviso del último despacho/devolución (también cuando quedó en cola). */
  flash: string;
  incidentsKey: number;
  closeBusy: boolean;
  closeError: string;
  menuItems: AdminMenuItem[];
  onRunNext: (item: EventItem) => void;
  onEditDates: () => void;
  onMovement: (mode: "checkout" | "checkin", assignment: AdminEventAssignment) => void;
  onReload: () => void;
  onReloadInventory: () => void;
  onIncidentsChanged: () => void;
};

/**
 * Detalle del evento como panel lateral: arriba lo que falta, abajo las
 * pestañas Resumen, Checklist, Equipos, Personal e Historial. Cada acción de
 * siempre vive en su pestaña; el pie lleva la siguiente acción lógica y «•••».
 */
export function EventoFicha(props: EventoFichaProps) {
  const { item, tab, onTab, onClose, writable, budget, stageBudget, budgetState, closeBusy, closeError, menuItems, onRunNext } = props;
  const { event, readiness } = item;
  const tablistId = useId();

  const counts: Record<EventDetailTab, string | null> = {
    resumen: null,
    checklist: readiness.tasks.total > 0 ? `${readiness.tasks.done}/${readiness.tasks.total}` : null,
    equipos: readiness.equipment.lines > 0 ? formatNumber(readiness.equipment.lines) : null,
    personal: readiness.promoters.count > 0 ? formatNumber(readiness.promoters.count) : null,
    historial: null,
  };

  const when = event.startsAt ? `${formatDateTime(event.startsAt)}` : "Fecha a confirmar";

  return (
    <AdminDialog
      title={event.name}
      size="ficha"
      icon="events"
      description={`${clientDisplayName(event.client)} · ${when}`}
      onClose={onClose}
      error={closeError || null}
      footer={({ requestClose }) => (
        <>
          {menuItems.length > 0 ? <AdminActionsMenu label={`Más acciones del evento ${event.name}`} items={menuItems} /> : null}
          <span className="admin-dialog-spacer" />
          <AdminButton icon="close" type="button" onClick={requestClose}>
            Cerrar
          </AdminButton>
          {writable ? <NextActionButton item={item} onRun={onRunNext} busy={closeBusy} /> : null}
        </>
      )}
    >
      <div className="admin-ficha-evento-head">
        <EventStateBadges item={item} />
        {event.archivedAt || event.status === "IN_PROGRESS" || readiness.phase === "closed" || readiness.phase === "ended" || !event.startsAt ? null : (
          <AdminCountdown value={event.startsAt} title={`Cuánto falta para el inicio: ${event.name}`} />
        )}
      </div>

      <section className="admin-evento-gaps" aria-label="Qué falta para este evento" data-state={readiness.gaps.length > 0 ? "gaps" : "clear"}>
        <h3 className="admin-evento-gaps-title">Qué falta</h3>
        {readiness.phase === "closed" ? (
          <p className="admin-evento-gaps-ok">
            <AdminIcon name="check" size={14} /> Evento {event.status === "CANCELLED" ? "cancelado" : "finalizado"}: no hay nada pendiente de operar.
          </p>
        ) : readiness.gaps.length === 0 ? (
          <p className="admin-evento-gaps-ok">
            <AdminIcon name="check" size={14} /> Todo en orden: checklist, equipos y personal no tienen pendientes.
            {readiness.deposit === "unknown" ? " La seña no se pudo verificar." : ""}
          </p>
        ) : (
          <ul className="admin-evento-gaps-list">
            {readiness.gaps.map((gap) => (
              <li key={gap.key}>
                <button type="button" className="admin-evento-gap" data-tone={gap.tone} onClick={() => gap.key === "dates" && writable ? props.onEditDates() : onTab(gap.tab)} aria-label={gap.key === "dates" && writable ? "Completar fechas del evento" : `${gap.label}. Ir a ${TABS.find((entry) => entry.key === gap.tab)?.label ?? gap.tab}`}>
                  <AdminIcon name="alert" size={13} />
                  <span>{gap.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AdminTabs
        className="admin-evento-tabs"
        label={`Secciones del evento ${event.name}`}
        value={tab}
        onChange={(key) => onTab(key as EventDetailTab)}
        tabId={(key) => `${tablistId}-${key}`}
        panelId={() => `${tablistId}-panel`}
        items={TABS.map((entry) => ({ key: entry.key, label: entry.label, count: counts[entry.key] }))}
      />

      <div id={`${tablistId}-panel`} role="tabpanel" aria-labelledby={`${tablistId}-${tab}`} className="admin-evento-panel">
        {tab === "resumen" ? <ResumenTab event={event} budget={budget} stageBudget={stageBudget} budgetState={budgetState} item={item} /> : null}
        {tab === "checklist" ? (
          <ChecklistTab event={event} writable={writable} promoters={props.promoters} onReload={props.onReload} />
        ) : null}
        {tab === "equipos" ? <EquiposTab {...props} /> : null}
        {tab === "personal" ? (
          <PersonalTab event={event} writable={writable} promoters={props.promoters} onReload={props.onReload} />
        ) : null}
        {tab === "historial" ? <AdminTimelineLoader path={`/api/admin/timeline?eventId=${encodeURIComponent(event.id)}`} /> : null}
      </div>
    </AdminDialog>
  );
}

function ResumenTab({ event, budget, stageBudget, budgetState, item }: { event: AdminEventPanelRow; budget: EventBudgetSummary | null; stageBudget: AdminBudgetRow | null; budgetState: "loading" | "error" | "ready"; item: EventItem }) {
  const where = [event.location, event.city, event.department].filter(Boolean).join(" · ");
  const legal = clientLegalName(event.client);
  const phone = whatsappHref(event.client.phone);
  const collected = budget?.collected ?? 0;
  return (
    <>
      <dl className="admin-dialog-facts">
        <div><dt>Inicio</dt><dd>{event.startsAt ? formatDateTime(event.startsAt) : "A confirmar"}</dd></div>
        {event.endsAt ? <div><dt>Fin</dt><dd>{formatDateTime(event.endsAt)}</dd></div> : null}
        {event.setupAt ? <div><dt>Montaje</dt><dd>{formatDateTime(event.setupAt)}</dd></div> : null}
        {event.strikeAt ? <div><dt>Desmontaje</dt><dd>{formatDateTime(event.strikeAt)}</dd></div> : null}
        <div>
          <dt>Lugar</dt>
          <dd>
            {where || "Sin lugar definido"}
            {event.address ? <small className="admin-cell-sub"> · {event.address}{event.addressReference ? ` (${event.addressReference})` : ""}</small> : null}
            {event.locationUrl ? (
              <>
                {" "}
                <a href={event.locationUrl} target="_blank" rel="noreferrer">Abrir mapa</a>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Cliente</dt>
          <dd>
            <ClientIdentityView client={event.client} />
            {legal ? <small className="admin-cell-sub"> · {legal}</small> : null}
            {event.client.phone ? <small className="admin-cell-sub"> · {phone ? <a href={phone} target="_blank" rel="noreferrer">{event.client.phone}</a> : event.client.phone}</small> : null}
            {" "}
            <Link href={`/clientes/${event.client.id}`}>Ver ficha</Link>
          </dd>
        </div>
        <div>
          <dt>Responsable</dt>
          <dd>
            {event.responsibleName || event.responsiblePhone || event.responsibleEmail
              ? [event.responsibleName, event.responsiblePhone, event.responsibleEmail].filter(Boolean).join(" · ")
              : "Sin responsable cargado"}
          </dd>
        </div>
        {event.venueContactName || event.venueContactPhone || event.venueContactEmail ? (
          <div><dt>Contacto del lugar</dt><dd>{[event.venueContactName, event.venueContactPhone, event.venueContactEmail].filter(Boolean).join(" · ")}</dd></div>
        ) : null}
        {event.modality || event.attendees != null ? (
          <div><dt>Modalidad</dt><dd>{[event.modality, event.attendees != null ? `${formatNumber(event.attendees)} asistentes` : null].filter(Boolean).join(" · ")}</dd></div>
        ) : null}
        {event.notes ? <div><dt>Notas</dt><dd>{event.notes}</dd></div> : null}
      </dl>

      <section className="admin-evento-budget" aria-label="Presupuesto vinculado">
        <h3 className="admin-dialog-section-title">Presupuesto vinculado</h3>
        {budgetState === "loading" ? (
          <p className="admin-muted" role="status">Cargando el presupuesto…</p>
        ) : budgetState === "error" ? (
          <AdminNote tone="warn">No pudimos leer el presupuesto vinculado. Recargá para reintentar; la seña figura como «sin verificar».</AdminNote>
        ) : !budget ? (
          <p className="admin-muted">Este evento no tiene un presupuesto vinculado.</p>
        ) : (
          <>
            {stageBudget ? <StageTrail stages={stagesOfBudget(stageBudget)} label={`Etapas de ${budget.title ?? "el presupuesto"}`} /> : null}
            <dl className="admin-dialog-facts">
              <div>
                <dt>Presupuesto</dt>
                <dd>
                  <Link href={`/presupuestos?detalle=${encodeURIComponent(budget.budgetId ?? "")}`}>{budget.title ?? "Ver presupuesto"}</Link>{" "}
                  {budget.status ? <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge> : null}
                </dd>
              </div>
              <div><dt>Total</dt><dd>{budget.total != null ? formatMoney(budget.total) : "—"}</dd></div>
              <div><dt>Cobrado</dt><dd>{formatMoney(collected)}{budget.total != null ? ` · saldo ${formatMoney(Math.max(0, budget.total - collected))}` : ""}</dd></div>
              <div>
                <dt>Seña</dt>
                <dd>
                  {budget.advanceAmount > 0
                    ? `${formatMoney(budget.advanceAmount)} · ${item.readiness.deposit === "paid" ? "cobrada" : "pendiente de cobro"}`
                    : "Sin seña pactada"}
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>
    </>
  );
}

function TaskAddForm({
  eventId,
  promoters,
  requirePromoter,
  onReload,
}: {
  eventId: string;
  promoters: AdminPromoterOption[];
  /** En la pestaña Personal la tarea nace asignada a una promotora. */
  requirePromoter?: boolean;
  onReload: () => void;
}) {
  const [form, setForm] = useState(EMPTY_TASK_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = useMemo(() => promoters.find((promoter) => promoter.id === form.promoterId) ?? null, [promoters, form.promoterId]);

  async function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (requirePromoter && !form.promoterId) {
      setError("Elegí la promotora que va a cubrir la tarea.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const promoter = promoters.find((candidate) => candidate.id === form.promoterId) ?? null;
    const result = await adminSend("/api/admin/event-ops", {
      kind: "task",
      eventId,
      title: form.title,
      type: form.type,
      dueAt: form.dueAt || undefined,
      promoterId: form.promoterId || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      promoter && !promoterIsAvailable(promoter)
        ? `Tarea creada con «${promoter.name}» (${promoterAvailabilityLabel(promoter.availability).toLowerCase()}${
            promoterAvailabilityDetail(promoter) ? `: ${promoterAvailabilityDetail(promoter)}` : ""
          }). Revisá la asignación o cubrila con otra persona.`
        : "",
    );
    setForm(EMPTY_TASK_FORM);
    onReload();
  }

  return (
    <>
      <form className="admin-inline-form" onSubmit={submit}>
        <TextField
          ariaLabel="Título de la tarea"
          required
          maxLength={120}
          value={form.title}
          onChange={(value) => setForm({ ...form, title: value })}
          placeholder={requirePromoter ? "Tarea para la promotora" : "Nueva tarea operativa"}
        />
        <AdminSelect
          className=""
          value={form.type}
          onChange={(value) => setForm({ ...form, type: value })}
          label="Tipo de tarea"
          options={TASK_TYPE_OPTIONS}
        />
        <AdminSelect
          className=""
          required={requirePromoter}
          value={form.promoterId}
          onChange={(value) => setForm({ ...form, promoterId: value })}
          label="Promotora de la tarea"
          title="Promotora asignada"
          options={requirePromoter ? promoterOptions(promoters).map((option) => (option.value === "" ? { value: "", label: "Elegí la promotora…" } : option)) : promoterOptions(promoters)}
        />
        <DateField ariaLabel="Vencimiento de la tarea" title="Vencimiento (opcional)" value={form.dueAt} onChange={(value) => setForm({ ...form, dueAt: value })} />
        <AdminButton type="submit" icon="plus" busy={busy}>
          {requirePromoter ? "Asignar promotora" : "Agregar tarea"}
        </AdminButton>
      </form>
      {selected && !promoterIsAvailable(selected) ? (
        <AdminNote>
          <AdminBadge tone={promoterAvailabilityTone(selected.availability)}>{promoterAvailabilityLabel(selected.availability)}</AdminBadge>
          <span>
            <strong>{selected.name}</strong>
            {promoterAvailabilityDetail(selected) ? `: ${promoterAvailabilityDetail(selected)}.` : "."} Podés asignarla igual: la tarea queda y el conflicto se ve en el checklist.
          </span>
        </AdminNote>
      ) : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
    </>
  );
}

function ChecklistTab({ event, writable, promoters, onReload }: { event: AdminEventPanelRow; writable: boolean; promoters: AdminPromoterOption[]; onReload: () => void }) {
  const [filter, setFilter] = useState("PENDING");
  const [error, setError] = useState("");
  const entries = useMemo<ChecklistEntry[]>(() => {
    const all = event.tasks.map((task) => ({ task, eventName: event.name }));
    const filtered = filter === "ALL" ? all : all.filter(({ task }) => !task.completedAt);
    return filtered.sort((a, b) => (a.task.dueAt ?? "9999").localeCompare(b.task.dueAt ?? "9999"));
  }, [event, filter]);
  const pending = event.tasks.filter((task) => !task.completedAt).length;
  return (
    <>
      <div className="admin-evento-tab-head">
        <p className="admin-muted">
          {event.tasks.length === 0 ? "Sin tareas cargadas." : `${formatNumber(event.tasks.length - pending)} de ${formatNumber(event.tasks.length)} tareas cumplidas.`}
        </p>
        <AdminSelect
          value={filter}
          onChange={setFilter}
          label="Filtrar tareas"
          options={[
            { value: "PENDING", label: "Solo pendientes" },
            { value: "ALL", label: "Todas las tareas" },
          ]}
        />
      </div>
      {writable ? <TaskAddForm eventId={event.id} promoters={promoters} onReload={onReload} /> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <ChecklistTable
        entries={entries}
        single
        canToggle={writable}
        onChanged={onReload}
        onError={setError}
        emptyHint={filter === "PENDING" ? "Checklist al día: no quedan tareas pendientes." : "Las tareas base se generan al crear un evento y se pueden sumar a mano."}
      />
    </>
  );
}

function PersonalTab({ event, writable, promoters, onReload }: { event: AdminEventPanelRow; writable: boolean; promoters: AdminPromoterOption[]; onReload: () => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { promoter: NonNullable<AdminEventPanelRow["tasks"][number]["promoter"]>; tasks: AdminEventPanelRow["tasks"] }>();
    for (const task of event.tasks) {
      if (!task.promoter) continue;
      const group = map.get(task.promoter.id) ?? { promoter: task.promoter, tasks: [] };
      group.tasks.push(task);
      map.set(task.promoter.id, group);
    }
    return [...map.values()];
  }, [event.tasks]);
  const teamTasks = event.tasks.filter((task) => !task.promoter).length;
  return (
    <>
      {groups.length === 0 ? (
        <AdminEmpty icon="promoters" title="Sin promotoras asignadas" hint="Asigná una promotora creando una tarea para ella: queda en el checklist del evento." />
      ) : (
        <ul className="admin-evento-people">
          {groups.map(({ promoter, tasks }) => (
            <li key={promoter.id} className="admin-evento-person">
              <div className="admin-evento-person-head">
                <strong>{promoter.name}</strong>
                <AdminBadge tone={promoterAvailabilityTone(promoter.availability)}>{promoterAvailabilityLabel(promoter.availability)}</AdminBadge>
              </div>
              {!promoterIsAvailable(promoter) ? (
                <AdminNote tone="warn">
                  {promoterAvailabilityDetail(promoter) || "Sin detalle cargado"}. Revisá la asignación o cubrila con otra persona.
                </AdminNote>
              ) : null}
              <ul className="admin-evento-person-tasks">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <AdminBadge tone={task.completedAt ? "ok" : "neutral"}>{task.completedAt ? "Listo" : "Pendiente"}</AdminBadge>
                    <span>{task.title}</span>
                    {task.dueAt ? <small className="admin-muted">vence {formatDateShort(task.dueAt)}</small> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {teamTasks > 0 ? <p className="admin-muted">{formatNumber(teamTasks)} tarea{teamTasks === 1 ? "" : "s"} del checklist {teamTasks === 1 ? "es" : "son"} del equipo (sin promotora).</p> : null}
      {writable ? <TaskAddForm eventId={event.id} promoters={promoters} requirePromoter onReload={onReload} /> : null}
    </>
  );
}

function EquiposTab(props: EventoFichaProps) {
  const { item, writable, inventoryItems, onSearchInventory, queuedActions, flash, incidentsKey, onMovement, onReload, onReloadInventory, onIncidentsChanged } = props;
  const event = item.event;
  const assignments = event.assignments;
  const assignedUnits = assignments.reduce((sum, assignment) => sum + assignment.quantity, 0);

  const defaultForm = useMemo(
    () => ({
      ...EMPTY_ASSIGN_FORM,
      startsAt: inputDateTime(event.setupAt ?? event.startsAt),
      endsAt: inputDateTime(event.strikeAt ?? event.endsAt ?? event.startsAt),
    }),
    [event.setupAt, event.startsAt, event.strikeAt, event.endsAt],
  );
  const [assignForm, setAssignForm] = useState(defaultForm);
  const [selectedInventory, setSelectedInventory] = useState<{ value: string; label: string } | null>(null);
  const inventoryChoices = inventoryItems.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.sku ? ` · ${entry.sku}` : ""} · ${formatNumber(entry.availability.availableNow)} libres` }));
  if (assignForm.inventoryId && !inventoryChoices.some((choice) => choice.value === assignForm.inventoryId)) {
    const existing = assignments.find((row) => row.inventory.id === assignForm.inventoryId)?.inventory;
    const chosen = selectedInventory?.value === assignForm.inventoryId ? selectedInventory : existing ? { value: existing.id, label: existing.name } : null;
    if (chosen) inventoryChoices.push(chosen);
  }
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [equipmentError, setEquipmentError] = useState("");
  const [availability, setAvailability] = useState<AdminInventoryAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");

  const requestedQuantity = Number(assignForm.quantity) || 0;
  const availabilityBlocked = Boolean(availability?.blocked);
  const exceedsAvailability = Boolean(availability && requestedQuantity > availability.available);
  // La propia asignación del evento no se cuenta como conflicto: el alta es upsert
  // por (evento, ítem) y el API excluye esa fila al validar.
  const existingAssignmentId = assignments.find((assignment) => assignment.inventory.id === assignForm.inventoryId)?.id ?? "";

  // Disponibilidad del ítem en el rango elegido: la calcula el API y la UI solo la muestra.
  useEffect(() => {
    if (!assignForm.inventoryId || !assignForm.startsAt || !assignForm.endsAt) {
      setAvailability(null);
      setAvailabilityError("");
      setAvailabilityLoading(false);
      return;
    }
    const params = new URLSearchParams({ inventoryId: assignForm.inventoryId, startsAt: assignForm.startsAt, endsAt: assignForm.endsAt });
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
  }, [assignForm.inventoryId, assignForm.startsAt, assignForm.endsAt, existingAssignmentId]);

  function resetForm() {
    setEditingId("");
    setError("");
    setAssignForm(defaultForm);
  }

  function startEdit(assignment: AdminEventAssignment) {
    setEditingId(assignment.id);
    setError("");
    setNotice("");
    setAssignForm({
      inventoryId: assignment.inventory.id,
      quantity: String(assignment.quantity),
      startsAt: inputDateTime(assignment.startsAt),
      endsAt: inputDateTime(assignment.endsAt),
    });
  }

  async function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const result = await adminSend("/api/admin/inventory", {
      kind: "assignment",
      eventId: event.id,
      inventoryId: assignForm.inventoryId,
      quantity: Number(assignForm.quantity) || 1,
      startsAt: assignForm.startsAt || undefined,
      endsAt: assignForm.endsAt || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(editingId ? "Asignación actualizada." : "Equipo asignado al evento.");
    setAssignForm({ ...EMPTY_ASSIGN_FORM, startsAt: assignForm.startsAt, endsAt: assignForm.endsAt });
    setEditingId("");
    onReload();
    onReloadInventory();
  }

  async function remove(assignment: AdminEventAssignment) {
    setEquipmentError("");
    setNotice("");
    const result = await adminSend("/api/admin/inventory", { kind: "assignment-delete", id: assignment.id });
    if (!result.ok) {
      setEquipmentError(result.error);
      return;
    }
    setNotice(`Asignación quitada: ${assignment.inventory.name}.`);
    onReload();
    onReloadInventory();
  }

  return (
    <>
      <p className="admin-muted">
        {assignments.length === 0
          ? "Sin equipos asignados."
          : `${formatNumber(assignedUnits)} unidades · ${formatNumber(assignments.length)} asignaciones`}
      </p>

      {writable ? (
        <form className="admin-inline-form" onSubmit={submit}>
          <Combobox
            onSearch={onSearchInventory}
            required
            value={assignForm.inventoryId}
            onChange={(value) => { setSelectedInventory(inventoryChoices.find((choice) => choice.value === value) ?? null); setAssignForm({ ...assignForm, inventoryId: value }); }}
            label="Ítem de inventario"
            disabled={Boolean(editingId)}
            options={inventoryChoices}
          />
          <NumberField strictInteger
            ariaLabel="Cantidad de unidades"
            title="Cantidad de unidades"
            className="admin-qty-input"
            required
            value={assignForm.quantity}
            onChange={(value) => setAssignForm({ ...assignForm, quantity: value })}
          />
          <DateTimeField ariaLabel="Inicio del rango asignado" title="Inicio del rango asignado" required value={assignForm.startsAt} onChange={(value) => setAssignForm({ ...assignForm, startsAt: value })} />
          <DateTimeField ariaLabel="Fin del rango asignado" title="Fin del rango asignado" required value={assignForm.endsAt} onChange={(value) => setAssignForm({ ...assignForm, endsAt: value })} />
          <AdminButton type="submit" icon={editingId ? "check" : "plus"} busy={busy} disabled={availabilityBlocked || exceedsAvailability}>
            {editingId ? "Guardar" : "Asignar"}
          </AdminButton>
          {editingId ? (
            <AdminButton icon="close" type="button" onClick={resetForm} disabled={busy}>
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
                ? ` Ocupadas: ${availability.conflicts.map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`).join(", ")}.`
                : ""}
              {exceedsAvailability ? ` Pediste ${formatNumber(requestedQuantity)}.` : ""}
            </AdminNote>
          ) : null
        ) : (
          <AdminNote>Elegí el ítem y el rango de fechas para ver la disponibilidad.</AdminNote>
        )
      ) : null}

      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {flash ? <AdminNote tone="ok">{flash}</AdminNote> : null}
      {equipmentError ? <AdminNote tone="error">{equipmentError}</AdminNote> : null}

      <AdminDataState
        loading={false}
        error=""
        empty={assignments.length === 0}
        emptyTitle="Sin equipos asignados"
        emptyIcon="inventory"
        emptyHint="Asigná equipos con cantidad y rango de fechas: el sistema valida la disponibilidad real."
      >
        <ul className="admin-evento-assign-list" aria-label={`Equipos asignados a ${event.name}`}>
          {assignments.map((assignment) => {
            // Acción de campo en cola (issue #23): el estado mostrado refleja la
            // intención local y el badge «Sin subir» avisa que falta confirmación.
            const queuedMovement = queuedActionForAssignment(queuedActions, assignment.id);
            const queued = queuedKind(queuedActions, assignment.id);
            const queuedOut = queued === "out" ? queuedMovement : null;
            const queuedBack = queued === "back" ? queuedMovement : null;
            const state = inventoryAssignmentState(
              queuedMovement
                ? queuedOut
                  ? { ...assignment, checkedOut: true, checkedOutAt: assignment.checkedOutAt ?? queuedMovement.createdAt }
                  : { ...assignment, checkedIn: true, checkedInAt: assignment.checkedInAt ?? queuedMovement.createdAt }
                : assignment,
            );
            const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
            const countdown = inventoryAssignmentCountdown(assignment);
            const controls = assignmentControls(assignment, queued);
            const cleaning = assignment.cleaningUntil ? new Date(assignment.cleaningUntil) : null;
            const startsAt = assignment.startsAt ?? event.setupAt ?? event.startsAt;
            const endsAt = assignment.endsAt ?? event.strikeAt ?? event.endsAt ?? startsAt;
            const anyAction = writable && (controls.canDispatch || controls.canReturn || controls.canEdit);
            return (
              <li key={assignment.id} className="admin-evento-assign">
                <div className="admin-evento-assign-head">
                  <strong title={assignment.inventory.name}>{assignment.inventory.name}</strong>
                  {assignment.inventory.sku ? <span className="admin-code">{assignment.inventory.sku}</span> : null}
                  {controls.isCombo ? <AdminBadge tone="info" title="Los movimientos se registran sobre sus componentes">Combo</AdminBadge> : null}
                  <span className="admin-evento-assign-qty" title={`${formatNumber(assignment.quantity)} unidades`}>×{formatNumber(assignment.quantity)}</span>
                </div>
                <p className="admin-evento-assign-range" title={startsAt && endsAt ? rangeStamp(startsAt, endsAt) : "Sin fechas"}>{rangeStamp(startsAt, endsAt)}</p>
                <div className="admin-evento-assign-state" title={countdown ? countdown.title : "Asignación cerrada"}>
                  <AdminBadge tone={state.tone}>{state.label}</AdminBadge>
                  {cleaning && cleaning.getTime() > Date.now() ? (
                    <AdminBadge tone="warn" title={`En limpieza o revisión hasta ${stamp(assignment.cleaningUntil ?? null)}`}>
                      En limpieza o revisión
                    </AdminBadge>
                  ) : null}
                  {countdown ? <AdminCountdown value={countdown.at} short className="admin-countdown--inline" title={`${countdown.title}: ${assignment.inventory.name}`} /> : null}
                </div>
                <dl className="admin-evento-assign-moves">
                  <div title={queuedOut ? movementQueueTitle(queuedOut) : assignment.checkedOutAt ? `Salida: ${stamp(assignment.checkedOutAt)}` : undefined}>
                    <dt>Salida</dt>
                    <dd>
                      {queuedOut ? (
                        <AdminBadge tone={queuedOut.status === "failed" ? "danger" : "warn"} title={movementQueueTitle(queuedOut)}>
                          {queuedOut.status === "failed" ? "Falló" : "Sin subir"}
                        </AdminBadge>
                      ) : (
                        stamp(assignment.checkedOutAt)
                      )}
                    </dd>
                  </div>
                  <div title={queuedBack ? movementQueueTitle(queuedBack) : assignment.checkedInAt ? `Devolución: ${stamp(assignment.checkedInAt)}` : undefined}>
                    <dt>Devolución</dt>
                    <dd>
                      {queuedBack ? (
                        <AdminBadge tone={queuedBack.status === "failed" ? "danger" : "warn"} title={movementQueueTitle(queuedBack)}>
                          {queuedBack.status === "failed" ? "Falló" : "Sin subir"}
                        </AdminBadge>
                      ) : (
                        stamp(assignment.checkedInAt)
                      )}
                    </dd>
                  </div>
                  <div title={damages ? `${damages}${assignment.damageNotes ? ` · ${assignment.damageNotes}` : ""}` : "Sin daños ni faltantes"}>
                    <dt>Daños</dt>
                    <dd>{damages ?? "—"}</dd>
                  </div>
                </dl>
                <div className="admin-evento-assign-actions admin-actions">
                  {writable && controls.canDispatch ? (
                    <AdminButton icon="arrow-right" title={`Despachar: ${assignment.inventory.name}`} aria-label={`Despachar: ${assignment.inventory.name}`} onClick={() => onMovement("checkout", assignment)}>
                      Despachar
                    </AdminButton>
                  ) : null}
                  {writable && controls.canReturn ? (
                    <AdminButton icon="checkin" title={`Registrar devolución: ${assignment.inventory.name}`} aria-label={`Registrar devolución: ${assignment.inventory.name}`} onClick={() => onMovement("checkin", assignment)}>
                      Registrar devolución
                    </AdminButton>
                  ) : null}
                  {writable && controls.canEdit ? (
                    <>
                      <AdminButton icon="edit" title={`Editar asignación: ${assignment.inventory.name}`} aria-label={`Editar asignación: ${assignment.inventory.name}`} onClick={() => startEdit(assignment)}>
                        Editar
                      </AdminButton>
                      <AdminButton icon="close" title={`Quitar asignación: ${assignment.inventory.name}`} aria-label={`Quitar asignación: ${assignment.inventory.name}`} onClick={() => void remove(assignment)} />
                    </>
                  ) : null}
                  {!anyAction ? <span className="admin-muted">Sin acciones</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </AdminDataState>

      <ExternalNeedsPanel
        eventId={event.id}
        startsAt={event.setupAt ?? event.startsAt}
        endsAt={event.strikeAt ?? event.endsAt}
        inventoryItems={inventoryItems}
        onSearchInventory={onSearchInventory}
        writable={writable}
      />

      <h3 className="admin-subtitle">Remitos</h3>
      <RemitosPanel eventId={event.id} writable={writable} reloadKey={incidentsKey} />

      <h3 className="admin-subtitle">Incidentes de inventario</h3>
      <InventoryIncidentsPanel eventId={event.id} writable={writable} reloadKey={incidentsKey} onChanged={onIncidentsChanged} />
    </>
  );
}

type ExternalNeed = {
  id: string;
  inventoryId: string;
  requestedQuantity: number;
  startsAt: string;
  endsAt: string;
  status: "OPEN" | "CONFIRMED" | "CANCELLED";
  revision: number;
  notes: string | null;
  inventory: { id: string; name: string; sku: string | null };
  preferredSupplier: { id: string; name: string } | null;
};

type ExternalNeedForm = { inventoryId: string; quantity: string; startsAt: string; endsAt: string; notes: string };

export function ExternalNeedsPanel({
  eventId,
  startsAt,
  endsAt,
  inventoryItems,
  onSearchInventory,
  writable,
}: {
  eventId: string;
  startsAt: string | null;
  endsAt: string | null;
  inventoryItems: AdminInventoryOption[];
  onSearchInventory: (query: string) => void;
  writable: boolean;
}) {
  const [needs, setNeeds] = useState<ExternalNeed[]>([]);
  const [form, setForm] = useState<ExternalNeedForm>({ inventoryId: "", quantity: "1", startsAt: inputDateTime(startsAt), endsAt: inputDateTime(endsAt), notes: "" });
  const [editing, setEditing] = useState<ExternalNeed | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<{ value: string; label: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setLoading(true);
    const result = await adminApiGet<{ needs?: ExternalNeed[] }>(`/api/admin/events/${encodeURIComponent(eventId)}/external-needs`, { fresh: true });
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setNeeds(result.data.needs ?? []);
    setError("");
  }

  useEffect(() => {
    setForm({ inventoryId: "", quantity: "1", startsAt: inputDateTime(startsAt), endsAt: inputDateTime(endsAt), notes: "" });
    setEditing(null);
    void reload();
    // `reload` intentionally follows the event identity; dates only seed a new form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const choices = inventoryItems.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.sku ? ` · ${entry.sku}` : ""}` }));
  if (form.inventoryId && !choices.some((choice) => choice.value === form.inventoryId)) {
    const existing = needs.find((need) => need.inventoryId === form.inventoryId)?.inventory;
    const chosen = selectedInventory?.value === form.inventoryId ? selectedInventory : existing ? { value: existing.id, label: `${existing.name}${existing.sku ? ` · ${existing.sku}` : ""}` } : null;
    if (chosen) choices.push(chosen);
  }

  function reset() {
    setEditing(null);
    setSelectedInventory(null);
    setForm({ inventoryId: "", quantity: "1", startsAt: inputDateTime(startsAt), endsAt: inputDateTime(endsAt), notes: "" });
    setError("");
  }

  function edit(need: ExternalNeed) {
    setEditing(need);
    setSelectedInventory({ value: need.inventory.id, label: `${need.inventory.name}${need.inventory.sku ? ` · ${need.inventory.sku}` : ""}` });
    setForm({ inventoryId: need.inventoryId, quantity: String(need.requestedQuantity), startsAt: inputDateTime(need.startsAt), endsAt: inputDateTime(need.endsAt), notes: need.notes ?? "" });
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const body = {
      inventoryId: form.inventoryId,
      requestedQuantity: Number(form.quantity),
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : "",
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : "",
      notes: form.notes.trim() || null,
    };
    const result = editing
      ? await adminSend<{ need: ExternalNeed }>(`/api/admin/events/${encodeURIComponent(eventId)}/external-needs`, {
          id: editing.id,
          expectedRevision: editing.revision,
          changes: body,
        }, "PATCH", { idempotencyKey: true })
      : await adminSend<{ need: ExternalNeed }>(`/api/admin/events/${encodeURIComponent(eventId)}/external-needs`, body, "POST", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setNotice(editing ? "Necesidad externa actualizada; sigue pendiente y no reservada." : "Necesidad externa registrada; queda pendiente y no reservada.");
    reset();
    await reload();
  }

  async function cancelNeed(need: ExternalNeed) {
    setBusy(true); setError(""); setNotice("");
    const result = await adminSend<{ need: ExternalNeed }>(`/api/admin/events/${encodeURIComponent(eventId)}/external-needs`, {
      id: need.id,
      expectedRevision: need.revision,
      changes: { status: "CANCELLED" },
    }, "PATCH", { idempotencyKey: true });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setNotice("Necesidad cancelada. No se modificó el stock ni la disponibilidad.");
    await reload();
  }

  return (
    <section className="admin-evento-external-needs" aria-label="Necesidades de suministro externo">
      <div className="admin-evento-tab-head">
        <div>
          <h3 className="admin-dialog-section-title">Suministro externo</h3>
          <p className="admin-muted">Solicitudes por evento, separadas del stock propio y consignado.</p>
        </div>
        <AdminBadge tone="warn">No reservado</AdminBadge>
      </div>
      <AdminNote tone="warn">Registrar una necesidad no confirma proveedor, cantidad recibida ni disponibilidad. Tampoco crea unidades, reservas o costos.</AdminNote>
      {writable ? (
        <form className="admin-inline-form" onSubmit={submit}>
          <Combobox
            onSearch={onSearchInventory}
            required
            value={form.inventoryId}
            onChange={(value) => { setSelectedInventory(choices.find((choice) => choice.value === value) ?? null); setForm({ ...form, inventoryId: value }); }}
            label="Producto o equipo solicitado"
            options={choices}
          />
          <NumberField strictInteger ariaLabel="Cantidad externa solicitada" title="Cantidad solicitada" className="admin-qty-input" maxLength={6} required value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
          <DateTimeField ariaLabel="Inicio de necesidad externa" title="Inicio" required value={form.startsAt} onChange={(value) => setForm({ ...form, startsAt: value })} />
          <DateTimeField ariaLabel="Fin de necesidad externa" title="Fin" required value={form.endsAt} onChange={(value) => setForm({ ...form, endsAt: value })} />
          <TextField ariaLabel="Nota de necesidad externa" title="Nota (opcional)" maxLength={1000} value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} placeholder="Nota operativa" />
          <AdminButton type="submit" icon={editing ? "check" : "plus"} busy={busy}>{editing ? "Guardar necesidad" : "Registrar necesidad"}</AdminButton>
          {editing ? <AdminButton type="button" icon="close" onClick={reset} disabled={busy}>Cancelar edición</AdminButton> : null}
        </form>
      ) : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {loading ? <p className="admin-muted" role="status">Cargando necesidades externas…</p> : needs.length === 0 ? <p className="admin-muted">No hay necesidades externas registradas para este evento.</p> : (
        <ul className="admin-evento-external-needs-list">
          {needs.map((need) => (
            <li key={need.id}>
              <div>
                <strong>{need.inventory.name}</strong>{need.inventory.sku ? <span className="admin-code">{need.inventory.sku}</span> : null}
                <span>×{formatNumber(need.requestedQuantity)} · {rangeStamp(need.startsAt, need.endsAt)}</span>
                {need.preferredSupplier ? <small className="admin-muted">Tercero sugerido: {need.preferredSupplier.name}</small> : null}
                {need.notes ? <small className="admin-muted">{need.notes}</small> : null}
              </div>
              <AdminBadge tone={need.status === "CANCELLED" ? "neutral" : need.status === "CONFIRMED" ? "ok" : "warn"}>
                {need.status === "CANCELLED" ? "Cancelada" : need.status === "CONFIRMED" ? "Confirmada · sin cobertura" : "Pendiente"}
              </AdminBadge>
              {writable && need.status === "OPEN" ? (
                <div className="admin-evento-external-needs-actions">
                  <AdminButton type="button" icon="edit" onClick={() => edit(need)} disabled={busy}>Editar</AdminButton>
                  <AdminButton type="button" icon="close" onClick={() => void cancelNeed(need)} busy={busy}>Cancelar necesidad</AdminButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
