"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  daysUntilDue,
  eventStatusLabel,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatTime,
  whatsappReachable,
} from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import {
  type AdminBudgetRow,
  type AdminClientOption,
  type AdminEventAssignment,
  type AdminEventPanelRow,
  type AdminInventoryOption,
  type AdminPromoterOption,
} from "@/lib/admin-types";
import {
  assignmentControls,
  depositState,
  eventReadiness,
  isEventClosed,
  matchesFocus,
  startsWithinDays,
  type EventBudgetPrep,
  type EventBudgetSummary,
  type EventDetailTab,
  type EventFocus,
  type TaskScope,
  pendingTaskEntries,
  taskInScope,
} from "@/lib/event-readiness";
import { useAdminSession } from "../AdminShell";
import { AdminViewSwitch, useAdminModuleView, useAdminNarrowViewport, type AdminModuleView } from "../AdminBoard";
import { CalendarioModule } from "./CalendarioModule";
import { EventosTareas } from "./EventosTareas";
import { OverdueReturnsPanel } from "./OverdueReturns";
import {
  AdminActionsMenu,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminDialog,
  AdminDialogSection,
  AdminEmpty,
  AdminKpi,
  AdminKpis,
  AdminModuleContext,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  type AdminMenuItem,
  AdminPlanLimitNote,
  AdminTabs,
} from "../AdminUI";
import { MessageTemplateSendDialog, type MessageTemplateTarget } from "../AdminMessageTemplateDialog";
import { ClientQuickDialog } from "./ClientQuickForm";
import { EMPTY_EVENT_QUICK, EventQuickFields, eventQuickError, eventQuickPayload } from "./EventQuickForm";
import { Combobox, SearchField, TextAreaField } from "../AdminFields";
import { kpiState } from "@/components/admin/kpi-state";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { eventArchiveBlockedReason } from "@/lib/trash-shared";
import { TrashDialog, runTrashAction, trashMenuItems } from "../TrashDialogs";
import { useOfflineQueue } from "../AdminOffline";
import { InventoryMovementDialog } from "./InventoryMovementDialog";
import { EventCards, EventStateBadges, NextActionButton, PrepChips, itemTone, type EventItem } from "./EventoLista";
import { EventoFicha, inputDateTime, queuedKind } from "./EventoFicha";

/** Fila del panel de eventos (issue #68): cliente mínimo y operación completa. */
type EventRow = AdminEventPanelRow;

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "DRAFT", label: "Borrador" },
  { value: "CONFIRMED", label: "Confirmado" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "COMPLETED", label: "Finalizado" },
  { value: "CANCELLED", label: "Cancelado" },
  { value: "ARCHIVED", label: "Archivados" },
];

/** El selector y la URL comparten las vistas canónicas de Eventos. */
const EVENTOS_VIEWS = ["list", "grid", "calendar"] as const;

const FOCUS_LABEL: Record<EventFocus, string> = {
  next7: "Próximos 7 días",
  live: "En curso",
  gaps: "Con pendientes · 14 días",
  close: "Por cerrar",
};

const EMPTY_EVENT_FORM = { ...EMPTY_EVENT_QUICK, clientId: "" };

type MovementRequest = { mode: "checkout" | "checkin"; assignment: AdminEventAssignment; eventName: string };

/**
 * Urgencia operativa del evento, el orden por defecto de la lista y de las
 * tarjetas (día de Asunción, como el resto de las fechas):
 *
 * 0 · en juego con checklist abierto: en curso, arrancando hoy o mañana, o
 *     próximo sin ninguna tarea cumplida (lo que hay que resolver ya).
 * 1 · en juego con el checklist cerrado.
 * 2 · próximo (7 días) con el checklist todavía abierto.
 * 3 · el resto de lo que viene.
 * 4 · ya pasado o cancelado (del más reciente al más viejo).
 */
function eventUrgency(item: EventItem): number {
  const { event, readiness } = item;
  if (readiness.phase === "closed") return 4;
  const pending = readiness.tasks.pending > 0;
  const days = daysUntilDue(event.startsAt);
  const imminent = days !== null && days >= 0 && days <= 1;
  if (readiness.phase === "live" || imminent) return pending ? 0 : 1;
  if (pending && startsWithinDays(event)) return 2;
  return 3;
}

function compareEventUrgency(a: EventItem, b: EventItem): number {
  const rank = eventUrgency(a) - eventUrgency(b);
  if (rank !== 0) return rank;
  const timeA = a.event.startsAt ? new Date(a.event.startsAt).getTime() : Number.POSITIVE_INFINITY;
  const timeB = b.event.startsAt ? new Date(b.event.startsAt).getTime() : Number.POSITIVE_INFINITY;
  // Lo pasado se lee al revés: primero lo más reciente.
  return eventUrgency(a) >= 4 ? timeB - timeA : timeA - timeB;
}

export function EventosModule() {
  const { role } = useAdminSession();
  const { actions: queuedActions } = useOfflineQueue();
  const operations = useAdminResource(
    "/api/admin/event-ops?fields=panel",
    (payload) => (payload as { events?: AdminEventPanelRow[] }).events ?? [],
  );
  // Clientes e inventario alimentan solo los selectores del formulario y de la
  // asignación de equipos (issue #62): campos mínimos, sin métricas ni historial.
  const clients = useAdminResource(
    "/api/admin/clients?fields=selector",
    (payload) => (payload as { clients?: AdminClientOption[] }).clients ?? [],
  );
  const inventoryResource = useAdminResource(
    "/api/admin/inventory?fields=selector",
    (payload) => (payload as { inventory?: AdminInventoryOption[] }).inventory ?? [],
  );
  // Promotoras con su disponibilidad real: la asignación avisa, no bloquea (issue #24).
  const promotersResource = useAdminResource(
    "/api/admin/resources?only=promoters&fields=selector",
    (payload) => (payload as { promoters?: AdminPromoterOption[] }).promoters ?? [],
  );
  // Seña por evento: lectura liviana agregada en la base (sin bajar todos los presupuestos).
  const readinessResource = useAdminResource(
    "/api/admin/events/readiness",
    (payload) => (payload as { readiness?: EventBudgetSummary[] }).readiness ?? [],
  );

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [focus, setFocus] = useState<EventFocus | null>(null);
  // Vistas recordadas por usuario; la URL explícita prevalece al entrar.
  const [view, setView] = useAdminModuleView("eventos", EVENTOS_VIEWS);
  const searchParams = useSearchParams();
  // Enlaces del Resumen y del menú: `?estado=CONFIRMED` abre la lista filtrada.
  const estadoParam = (searchParams.get("estado") ?? "").trim().toUpperCase();
  useEffect(() => {
    if (STATUS_OPTIONS.some((option) => option.value === estadoParam)) setStatus(estadoParam);
  }, [estadoParam]);
  const calendarRequested = ["calendario", "calendar"].includes((searchParams.get("vista") ?? "").trim().toLowerCase());
  const [calendarOpen, setCalendarOpen] = useState(calendarRequested);
  useEffect(() => {
    setCalendarOpen(calendarRequested);
  }, [calendarRequested]);
  // Vista transversal «Tareas» (`?vista=tareas`): pestaña propia, no entra en el selector de vista.
  const tasksRequested = (searchParams.get("vista") ?? "").trim().toLowerCase() === "tareas";
  const [section, setSection] = useState<"eventos" | "tareas">(tasksRequested ? "tareas" : "eventos");
  const [taskScope, setTaskScope] = useState<TaskScope>("pending");
  useEffect(() => {
    setSection(tasksRequested ? "tareas" : "eventos");
  }, [tasksRequested]);
  function changeSection(next: "eventos" | "tareas") {
    setSection(next);
    if (next === "tareas") setCalendarOpen(false);
    const url = new URL(window.location.href);
    if (next === "tareas") url.searchParams.set("vista", "tareas");
    else if (url.searchParams.get("vista") === "tareas") url.searchParams.delete("vista");
    window.history.replaceState(null, "", url.toString());
  }
  const activeView: AdminModuleView = calendarOpen ? "calendar" : view;
  // En ancho compacto la lista también se lee como tarjetas (issue #139): es la
  // única forma de que el nombre del evento entre en 390 sin scroll horizontal.
  const narrow = useAdminNarrowViewport();
  const cardView = narrow || activeView === "grid";
  function changeView(next: AdminModuleView) {
    setCalendarOpen(next === "calendar");
    setView(next);
  }

  const [showForm, setShowForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_EVENT_FORM);
  const eventFormId = useId();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [formLimit, setFormLimit] = useState("");
  const [formNotice, setFormNotice] = useState("");
  /** «+ Nuevo cliente» del evento (issue #106, patrón de #88); `null` = cerrado. */
  const [newClientName, setNewClientName] = useState<string | null>(null);

  /** Detalle del evento (panel lateral) y su pestaña; `?evento=<id>` lo abre por link. */
  const eventoParam = (searchParams.get("evento") ?? "").trim();
  const [fichaId, setFichaId] = useState<string | null>(eventoParam || null);
  const [fichaTab, setFichaTab] = useState<EventDetailTab>("resumen");
  const [linkNote, setLinkNote] = useState("");
  useEffect(() => {
    if (!eventoParam) return;
    setFichaId(eventoParam);
    setFichaTab("resumen");
  }, [eventoParam]);

  const [movement, setMovement] = useState<MovementRequest | null>(null);
  const [flash, setFlash] = useState("");
  const [incidentsKey, setIncidentsKey] = useState(0);
  /** Envío por WhatsApp con plantilla (issue #35) para el cliente del evento. */
  const [templateTarget, setTemplateTarget] = useState<MessageTemplateTarget | null>(null);
  /** Cierre del evento (alquileres fase 4): estado, bloqueo 409 y cierre forzado con nota. */
  const [closeBusyId, setCloseBusyId] = useState("");
  /** Papelera: archivar/desarchivar en curso y el diálogo de eliminar abierto. */
  const [archiveBusyId, setArchiveBusyId] = useState("");
  const [trashTarget, setTrashTarget] = useState<{ id: string; name: string } | null>(null);
  const [closeError, setCloseError] = useState("");
  const [closeBlock, setCloseBlock] = useState<{ event: EventRow; message: string } | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceNote, setForceNote] = useState("");
  const [forceBusy, setForceBusy] = useState(false);
  const [forceError, setForceError] = useState("");
  const forceFormId = useId();

  const writable = canWriteOperations(role);
  const allEvents = useMemo(() => operations.data ?? [], [operations.data]);
  // Lo archivado sale de las listas activas, del calendario y de los indicadores: solo se ve con el filtro «Archivados».
  const events = useMemo(() => allEvents.filter((event) => !event.archivedAt), [allEvents]);
  const editingEvent = editingEventId ? allEvents.find((event) => event.id === editingEventId) ?? null : null;
  const eventFormDirty = JSON.stringify(form) !== JSON.stringify(editingEvent ? eventFormFrom(editingEvent) : EMPTY_EVENT_FORM);
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  /** Opciones del selector de cliente (issue #106): empresa manda, el nombre va de detalle. */
  const clientChoices = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: client.id,
        label: clientDisplayName(client),
        description: clientLegalName(client) ?? undefined,
      })),
    [clientOptions],
  );
  const inventoryItems = useMemo(() => inventoryResource.data ?? [], [inventoryResource.data]);
  const promoters = useMemo(() => promotersResource.data ?? [], [promotersResource.data]);

  // Seña por evento: sin dato (cargando o error) queda «—», nunca «sin presupuesto».
  const budgetsKnown = !readinessResource.loading && !readinessResource.error && readinessResource.data !== null;
  const budgetByEvent = useMemo(() => {
    const map = new Map<string, EventBudgetSummary>();
    for (const row of readinessResource.data ?? []) if (row.hasBudget) map.set(row.eventId, row);
    return map;
  }, [readinessResource.data]);
  // El detalle completo (etapas) solo se pide al abrir la ficha; si el presupuesto no entra en esa lista, no se dibujan las etapas.
  const fullBudgets = useAdminResource(
    "/api/admin/budgets",
    (payload) => (payload as { budgets?: AdminBudgetRow[] }).budgets ?? [],
    { enabled: Boolean(fichaId) },
  );

  const queued = useCallback((assignmentId: string) => queuedKind(queuedActions, assignmentId), [queuedActions]);

  const items = useMemo<EventItem[]>(
    () =>
      allEvents.map((event) => {
        const budget = budgetByEvent.get(event.id) ?? null;
        const prep: EventBudgetPrep | null = budget ? { advanceAmount: budget.advanceAmount, collected: budget.collected } : null;
        return { event, readiness: eventReadiness(event, { deposit: depositState(prep, budgetsKnown), queued }) };
      }),
    [allEvents, budgetByEvent, budgetsKnown, queued],
  );

  /** Búsqueda compartida por lista y tarjetas; el estado y el indicador tocado aplican a las dos. */
  const rows = useMemo(
    () =>
      items
        .filter(({ event }) => matchesQuery(query, [event.name, event.location, event.city, clientDisplayName(event.client), clientLegalName(event.client), event.client.company, event.client.name, event.status]))
        .filter(({ event }) => (status === "ARCHIVED" ? Boolean(event.archivedAt) : !event.archivedAt && (status === "ALL" || event.status === status)))
        .filter((item) => (focus ? matchesFocus(item.event, focus, item.readiness) : true))
        .sort(compareEventUrgency),
    [items, query, status, focus],
  );

  const taskEntries = useMemo(() => pendingTaskEntries(events), [events]);
  const overdueTaskCount = useMemo(() => taskEntries.filter(({ task }) => taskInScope(task, "overdue")).length, [taskEntries]);

  const counts = useMemo(() => {
    const total = (key: EventFocus) => items.filter((item) => !item.event.archivedAt && matchesFocus(item.event, key, item.readiness)).length;
    return { next7: total("next7"), live: total("live"), gaps: total("gaps"), close: total("close") };
  }, [items]);

  const ficha = fichaId ? items.find((item) => item.event.id === fichaId) ?? null : null;
  // Un `?evento=` que no es de esta empresa (o ya no existe) se avisa, no abre nada.
  useEffect(() => {
    if (!fichaId || operations.data === null || operations.loading) return;
    if (items.some((item) => item.event.id === fichaId)) return;
    setFichaId(null);
    setLinkNote("No encontramos ese evento en esta empresa.");
    syncUrl(null);
  }, [fichaId, items, operations.data, operations.loading]);

  function syncUrl(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("evento", id);
    else url.searchParams.delete("evento");
    window.history.replaceState(null, "", url.toString());
  }

  function openFicha(eventId: string, tab: EventDetailTab = "resumen") {
    setFlash("");
    setLinkNote("");
    setCloseError("");
    setFichaTab(tab);
    setFichaId(eventId);
    syncUrl(eventId);
  }

  function closeFicha() {
    setFichaId(null);
    syncUrl(null);
  }

  function toggleFocus(next: EventFocus) {
    setFocus((current) => (current === next ? null : next));
    // El calendario y las tareas no filtran eventos: tocar un indicador lleva a la lista.
    if (section === "tareas") changeSection("eventos");
    if (activeView === "calendar") changeView("list");
  }

  async function closeEvent(event: EventRow) {
    if (closeBusyId) return;
    setCloseError("");
    setCloseBusyId(event.id);
    const result = await adminSend("/api/admin/events", { id: event.id, status: "COMPLETED" }, "PATCH");
    setCloseBusyId("");
    if (result.ok) {
      operations.reload();
      return;
    }
    if (result.code === "closure_blocked") {
      setCloseBlock({ event, message: result.error });
      return;
    }
    setCloseError(result.error);
  }

  async function submitForceClose(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!closeBlock || forceBusy) return;
    const note = forceNote.trim();
    if (note.length < 5 || note.length > 400) {
      setForceError("Escribí el motivo del cierre (entre 5 y 400 caracteres).");
      return;
    }
    setForceError("");
    setForceBusy(true);
    const result = await adminSend("/api/admin/events", { id: closeBlock.event.id, status: "COMPLETED", forceClose: true, forceCloseNote: note }, "PATCH");
    setForceBusy(false);
    if (!result.ok) {
      setForceError(result.error);
      return;
    }
    setForceOpen(false);
    setCloseBlock(null);
    setForceNote("");
    operations.reload();
  }

  function startNewEvent() {
    setFormError("");
    setFormLimit("");
    setEditingEventId(null);
    setForm(EMPTY_EVENT_FORM);
    setFormNotice("");
    setShowForm(true);
  }

  async function submitEvent(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) return;
    setFormError("");
    setFormLimit("");
    setFormNotice("");
    // Check del front en es-PY (issue #131): faltaba y el alta caía en el error
    // en inglés del API.
    if (!form.clientId.trim()) {
      setFormError("Elegí el cliente del evento.");
      return;
    }
    const invalid = eventQuickError(form);
    if (invalid) { setFormError(invalid); return; }
    const fields: Partial<ReturnType<typeof eventQuickPayload>> = eventQuickPayload(form);
    const original = editingEventId ? events.find((event) => event.id === editingEventId) : null;
    // La edición de otros datos conserva las fechas originales, incluso segundos.
    if (original && form.startsAt === inputDateTime(original.startsAt)) delete fields.startsAt;
    if (original && form.endsAt === inputDateTime(original.endsAt)) delete fields.endsAt;
    setBusy(true);
    const result = await adminSend("/api/admin/events", {
      ...fields,
      ...(editingEventId ? { id: editingEventId } : { clientId: form.clientId }),
    }, editingEventId ? "PATCH" : "POST");
    setBusy(false);
    if (!result.ok) {
      // Tope del plan (issue #42): el cupo es de altas del mes; se explica con
      // el acceso a la página de Plan.
      if (result.code === "plan_limit") setFormLimit(result.error);
      else setFormError(result.error);
      return;
    }
    setForm(EMPTY_EVENT_FORM);
    setEditingEventId(null);
    setShowForm(false);
    operations.reload();
  }

  function eventFormFrom(event: EventRow) {
    return {
      ...EMPTY_EVENT_FORM,
      clientId: event.client.id, name: event.name, location: event.location ?? "", city: event.city ?? "",
      department: event.department ?? "", address: event.address ?? "", addressReference: event.addressReference ?? "", locationUrl: event.locationUrl ?? "",
      venueContactName: event.venueContactName ?? "", venueContactPhone: event.venueContactPhone ?? "", venueContactEmail: event.venueContactEmail ?? "",
      responsibleName: event.responsibleName ?? "", responsiblePhone: event.responsiblePhone ?? "", responsibleEmail: event.responsibleEmail ?? "",
      modality: event.modality ?? "", attendees: event.attendees == null ? "" : String(event.attendees),
      startsAt: inputDateTime(event.startsAt), endsAt: inputDateTime(event.endsAt),
    };
  }

  function openEventEdit(event: EventRow) {
    setEditingEventId(event.id);
    setForm(eventFormFrom(event));
    setFormError(""); setFormLimit(""); setFormNotice("");
    setShowForm(true);
  }

  /**
   * Alta rápida de cliente desde el evento (issue #106, patrón de #88): queda
   * elegido en el formulario y el catálogo del selector se refresca.
   */
  function selectCreatedClient(client: AdminClientOption) {
    setNewClientName(null);
    setForm((current) => ({ ...current, clientId: client.id }));
    setFormNotice(`Cliente «${clientDisplayName(client)}» creado y elegido.`);
    clients.reload();
  }


  /** La siguiente acción lógica del evento: abre el movimiento, el detalle o cierra. */
  function runNext(item: EventItem) {
    const next = item.readiness.next;
    if (!next || !writable) return;
    if (next.key === "finalize") {
      void closeEvent(item.event);
      return;
    }
    if (next.key === "dispatch" || next.key === "return") {
      const candidates = item.event.assignments.filter((assignment) => {
        const controls = assignmentControls(assignment, queued(assignment.id));
        return next.key === "dispatch" ? controls.canDispatch : controls.canReturn;
      });
      // Con un único equipo pendiente el movimiento se abre directo; con varios, en la pestaña Equipos.
      if (candidates.length === 1) {
        setFlash("");
        setMovement({ mode: next.key === "dispatch" ? "checkout" : "checkin", assignment: candidates[0], eventName: item.event.name });
        return;
      }
    }
    openFicha(item.event.id, next.tab);
  }

  /** «•••» de la fila, la tarjeta y la ficha: lo secundario, con los mismos permisos de siempre. */
  function menuItemsFor(item: EventItem, inFicha: boolean): AdminMenuItem[] {
    const { event, readiness } = item;
    const closable = writable && !isEventClosed(event);
    const entries: AdminMenuItem[] = [];
    if (!inFicha) entries.push({ label: "Abrir detalle", icon: "eye", onClick: () => openFicha(event.id) });
    if (writable) entries.push({ label: "Editar evento", icon: "edit", onClick: () => openEventEdit(event) });
    if (!inFicha) entries.push({ label: "Ver cronología", icon: "audit", onClick: () => openFicha(event.id, "historial") });
    entries.push({ label: "Imprimir orden de trabajo", icon: "print", href: `/imprimir/evento/${event.id}`, external: true });
    if (writable && whatsappReachable(event.client.phone)) {
      entries.push({
        label: "Enviar por WhatsApp con plantilla",
        icon: "mail",
        title: `Enviar por WhatsApp con plantilla a ${clientDisplayName(event.client)}`,
        onClick: () =>
          setTemplateTarget({ kind: "event", id: event.id, label: clientDisplayName(event.client), phone: event.client.phone }),
      });
    }
    if (closable && readiness.next?.key !== "finalize") {
      entries.push({ label: "Finalizar evento", icon: "check", title: `Finalizar el evento: ${event.name}`, onClick: () => void closeEvent(event) });
    }
    entries.push(
      ...trashMenuItems({
        type: "Event",
        name: event.name,
        archived: Boolean(event.archivedAt),
        canWrite: writable,
        archiveBlockedReason: eventArchiveBlockedReason(event.status),
        busy: Boolean(archiveBusyId),
        onArchive: () => void archiveEvent(event, false),
        onUnarchive: () => void archiveEvent(event, true),
        onTrash: () => setTrashTarget({ id: event.id, name: event.name }),
      }),
    );
    return entries;
  }

  /** Archivar / desarchivar (`events.write`); el servidor revalida estado y permisos. */
  async function archiveEvent(event: EventRow, restore: boolean) {
    if (archiveBusyId) return;
    setArchiveBusyId(event.id);
    setFlash("");
    setLinkNote("");
    const result = await runTrashAction("Event", event.id, restore ? "unarchive" : "archive");
    setArchiveBusyId("");
    if (!result.ok) {
      setCloseError(result.error);
      setFlash("");
      return;
    }
    setCloseError("");
    setFlash(restore ? `Evento «${event.name}» desarchivado.` : `Evento «${event.name}» archivado. Lo ves con el filtro «Archivados».`);
    operations.reload();
  }

  /** Pie de una fila o tarjeta: una sola acción visible (la siguiente) y «•••». */
  function rowActions(item: EventItem) {
    return (
      <span className="admin-actions admin-events-actions">
        {writable ? <NextActionButton item={item} onRun={runNext} busy={closeBusyId === item.event.id} /> : null}
        <AdminActionsMenu label={`Más acciones del evento ${item.event.name}`} items={menuItemsFor(item, false)} />
      </span>
    );
  }

  const kpiFor = (key: EventFocus) => ({
    onSelect: () => toggleFocus(key),
    active: focus === key,
    actionLabel: `Filtrar por ${FOCUS_LABEL[key].toLowerCase()}`,
  });

  return (
    <div className="admin-module-page">
      <AdminModuleContext
        breadcrumb="Ventas / Eventos"
        hint="Qué falta de cada evento: checklist, equipos, seña y personal."
        meta={`${formatNumber(events.length)} eventos`}
      />
      <AdminKpis state={kpiState(operations)} label="Indicadores de eventos" className="admin-kpis--2up admin-kpis--eventos">
        <AdminKpi label="Próximos 7 días" icon="calendar" value={formatNumber(counts.next7)} note="por empezar" tone="accent" {...kpiFor("next7")} />
        <AdminKpi label="En curso" icon="checkin" value={formatNumber(counts.live)} note="operación activa" {...kpiFor("live")} />
        <AdminKpi
          label="Con pendientes · 14 días"
          icon="alert"
          value={formatNumber(counts.gaps)}
          note="abiertos o en curso, próximos 14 días"
          tone={counts.gaps > 0 ? "warn" : "ok"}
          {...kpiFor("gaps")}
        />
        <AdminKpi
          label="Por cerrar"
          icon="audit"
          value={formatNumber(counts.close)}
          note="pasaron sin finalizar"
          tone={counts.close > 0 ? "danger" : "ok"}
          {...kpiFor("close")}
        />
        <AdminKpi
          label="Tareas vencidas"
          icon="clock"
          value={formatNumber(overdueTaskCount)}
          note="de eventos abiertos"
          tone={overdueTaskCount > 0 ? "danger" : "ok"}
          onSelect={() => {
            const off = section === "tareas" && taskScope === "overdue";
            setTaskScope(off ? "pending" : "overdue");
            changeSection("tareas");
          }}
          active={section === "tareas" && taskScope === "overdue"}
          actionLabel="Ver las tareas vencidas"
        />
      </AdminKpis>

      <OverdueReturnsPanel />

      <AdminTabs
        filters
        className="admin-eventos-sections"
        label="Secciones de Eventos"
        value={section}
        onChange={(key) => changeSection(key as typeof section)}
        items={[
          { key: "eventos", label: "Eventos" },
          { key: "tareas", label: "Tareas", count: operations.data ? taskEntries.length : null },
        ]}
      />

      {section === "tareas" ? null : (
      <AdminToolbar>
        {/* Primero en la barra: el conmutador queda FIJO en las tres vistas (en calendario no hay búsqueda ni filtro). */}
        {/* Calendario también debe ser alcanzable en móvil, aunque lista use tarjetas. */}
        <div className="admin-cal-view-switch">
          <AdminViewSwitch view={calendarOpen ? "calendar" : view} onChange={changeView} views={EVENTOS_VIEWS} labels={{ grid: "Tarjetas" }} label="Vista de eventos" />
        </div>
        {activeView === "calendar" ? null : (
          <SearchField value={query} onChange={setQuery} label="Buscar eventos" placeholder="Buscar por evento, cliente o lugar…" />
        )}
        {/* El filtro de estado vive en el mismo lugar en lista y cuadrícula: el
            conmutador no salta al alternar (issue #119). */}
        {activeView === "calendar" ? null : (
          <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado" options={STATUS_OPTIONS} />
        )}
        {writable ? (
          <AdminButton variant="primary" icon="plus" onClick={startNewEvent} aria-haspopup="dialog">
            Nuevo evento
          </AdminButton>
        ) : null}
      </AdminToolbar>
      )}

      {focus && activeView !== "calendar" && section === "eventos" ? (
        <div className="admin-focus-bar" role="status">
          <span>
            Mostrando: <strong>{FOCUS_LABEL[focus]}</strong> · {formatNumber(rows.length)} evento{rows.length === 1 ? "" : "s"}
          </span>
          <AdminButton icon="close" type="button" onClick={() => setFocus(null)}>
            Quitar filtro
          </AdminButton>
        </div>
      ) : null}

      {closeError && !ficha ? <AdminNote tone="error">{closeError}</AdminNote> : null}
      {linkNote ? <AdminNote tone="warn">{linkNote}</AdminNote> : null}
      {flash && !ficha ? <AdminNote tone="ok">{flash}</AdminNote> : null}

      {writable && closeBlock ? (
        <AdminDialog
          title="No se puede cerrar el evento"
          icon="events"
          description={`«${closeBlock.event.name}» tiene pendientes de inventario.`}
          onClose={() => setCloseBlock(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose}>
                Volver
              </AdminButton>
              <AdminButton
                variant="primary"
                icon="check"
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setForceNote("");
                  setForceError("");
                  setForceOpen(true);
                }}
              >
                Cerrar igual
              </AdminButton>
            </>
          )}
        >
          <AdminNote tone="warn">{closeBlock.message}</AdminNote>
          <p className="admin-muted">Lo recomendado es registrar las devoluciones o resolver los faltantes. Si son datos anteriores, podés cerrar igual dejando el motivo.</p>
        </AdminDialog>
      ) : null}

      {writable && trashTarget ? (
        <TrashDialog
          mode="trash"
          type="Event"
          id={trashTarget.id}
          name={trashTarget.name}
          onClose={() => setTrashTarget(null)}
          onDone={(message) => {
            setTrashTarget(null);
            if (fichaId === trashTarget.id) closeFicha();
            setFlash(message);
            operations.reload();
          }}
        />
      ) : null}

      {writable && closeBlock && forceOpen ? (
        <AdminDialog
          title="Cerrar igual"
          icon="events"
          description={`El motivo queda en la auditoría de «${closeBlock.event.name}».`}
          size="sm"
          dirty={forceNote.trim().length > 0}
          error={forceError}
          onClose={() => setForceOpen(false)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={forceBusy}>
                Cancelar
              </AdminButton>
              <AdminButton variant="primary" icon="check" type="submit" form={forceFormId} busy={forceBusy} busyLabel="Guardando…">
                Cerrar el evento
              </AdminButton>
            </>
          )}
        >
          <form id={forceFormId} className="admin-form" onSubmit={(formEvent) => void submitForceClose(formEvent)} aria-busy={forceBusy || undefined}>
            <TextAreaField
              label="Motivo del cierre"
              required
              value={forceNote}
              onChange={setForceNote}
              maxLength={400}
              hint="Entre 5 y 400 caracteres."
            />
          </form>
        </AdminDialog>
      ) : null}

      {writable && showForm ? (
        <AdminDialog
          title={editingEventId ? "Editar evento" : "Nuevo evento"}
          icon="events"
          description={editingEventId ? "El cliente del evento no se puede cambiar." : "Los datos de operación son opcionales."}
          size="lg"
          dirty={eventFormDirty}
          error={formError || (formLimit ? <AdminPlanLimitNote message={formLimit} /> : null)}
          onClose={() => setShowForm(false)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton variant="primary" icon="check" type="submit" form={eventFormId} busy={busy} busyLabel="Guardando…">
                {editingEventId ? "Guardar cambios" : "Crear evento"}
              </AdminButton>
            </>
          )}
        >
          <form id={eventFormId} className="admin-form" onSubmit={(formEvent) => void submitEvent(formEvent)} aria-busy={busy || undefined}>
              {formNotice ? <AdminNote tone="ok">{formNotice}</AdminNote> : null}
              <EventQuickFields key={editingEventId ?? "nuevo"} layout="sections" values={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} autoFocus
                moreOpen={Boolean(editingEventId)}
                locationOptions={[...new Set(events.flatMap((event) => event.location ? [event.location] : []))]}>
              <div className="admin-field-action">
                <Combobox
                  label="Cliente"
                  required
                  disabled={Boolean(editingEventId)}
                  value={form.clientId}
                  onChange={(value) => setForm({ ...form, clientId: value })}
                  options={clientChoices}
                  placeholder="Buscá por nombre o empresa…"
                  emptyLabel={clients.loading ? "Cargando clientes…" : "No hay clientes cargados."}
                  onCreate={editingEventId ? undefined : (name) => setNewClientName(name)}
                  createLabel={(query) => (query ? `Crear cliente «${query}»` : "Crear cliente")}
                />
                <AdminButton
                  type="button"
                  icon="plus"
                  disabled={Boolean(editingEventId)}
                  title="Crear un cliente nuevo y dejarlo elegido"
                  aria-label="Crear un cliente nuevo y dejarlo elegido"
                  onClick={() => {
                    setFormNotice("");
                    setNewClientName("");
                  }}
                >
                  Nuevo cliente
                </AdminButton>
              </div>
              </EventQuickFields>
          </form>
        </AdminDialog>
      ) : null}

      {section === "tareas" ? (
        <EventosTareas
          events={events}
          loading={operations.loading}
          error={operations.error}
          onRetry={operations.reload}
          writable={writable}
          scope={taskScope}
          onScope={setTaskScope}
          onOpenEvent={(id) => openFicha(id)}
        />
      ) : activeView === "calendar" ? (
        /* Una sola vista de calendario, también accesible por la URL histórica. */
        <div className="admin-events-calendar">
          <CalendarioModule hideKpis events={events} eventsLoading={operations.loading} eventsError={operations.error} onRetryEvents={operations.reload} />
        </div>
      ) : (
      <AdminDataState
        loading={operations.loading}
        error={operations.error}
        onRetry={operations.reload}
        empty={allEvents.length === 0}
        emptyTitle="Todavía no hay eventos" emptyIcon="events"
        emptyHint="Creá un evento para activar su checklist de montaje, evento, desmontaje y cobro."
        emptyAction={writable ? <AdminButton type="button" variant="link" onClick={startNewEvent}>Crear evento →</AdminButton> : undefined}
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : cardView ? (
          <EventCards items={rows} onOpen={(item) => openFicha(item.event.id)} renderActions={rowActions} />
        ) : (
          <AdminTable
            view="eventos"
            label="Eventos"
            columns={[
              { label: "Fecha y hora" },
              { label: "Evento" },
              { label: "Cliente" },
              { label: "Lugar" },
              { label: "Preparación" },
              { label: "Estado" },
              { label: "Siguiente paso", end: true },
            ]}
          >
            {rows.map((item) => {
              const { event, readiness } = item;
              const where = [event.location, event.city].filter(Boolean).join(" · ");
              return (
                <AdminRow key={event.id} tone={itemTone(item)}>
                  <AdminCell title={event.startsAt ? formatDateTime(event.startsAt) : "Fecha a confirmar"}>
                    <strong>{event.startsAt ? `${formatDateShort(event.startsAt)} · ${formatTime(event.startsAt)}` : "A confirmar"}</strong>
                    {event.archivedAt || readiness.phase === "closed" || readiness.phase === "ended" || event.status === "IN_PROGRESS" || !event.startsAt ? null : (
                      <AdminCountdown value={event.startsAt} short className="admin-countdown--inline" title={`Cuánto falta para el inicio: ${event.name}`} />
                    )}
                  </AdminCell>
                  <AdminCell title={event.name}>
                    <AdminButton type="button" variant="link" onClick={() => openFicha(event.id)} aria-haspopup="dialog" aria-label={`Abrir el evento ${event.name}`}>
                      {event.name}
                    </AdminButton>
                  </AdminCell>
                  <AdminCell title={clientDisplayName(event.client)}>{clientDisplayName(event.client)}</AdminCell>
                  <AdminCell title={where || "Sin lugar definido"}>{where || "—"}</AdminCell>
                  <AdminCell>
                    <PrepChips item={item} />
                  </AdminCell>
                  <AdminCell title={readiness.gaps.map((gap) => gap.label).join(" · ") || eventStatusLabel(event.status)}>
                    <EventStateBadges item={item} />
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    {rowActions(item)}
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>
      )}

      {ficha ? (
        <EventoFicha
          item={ficha}
          tab={fichaTab}
          onTab={setFichaTab}
          onClose={closeFicha}
          writable={writable}
          budget={budgetByEvent.get(ficha.event.id) ?? null}
          stageBudget={fullBudgets.data?.find((row) => row.id === budgetByEvent.get(ficha.event.id)?.budgetId) ?? null}
          budgetState={readinessResource.loading ? "loading" : readinessResource.error ? "error" : "ready"}
          promoters={promoters}
          inventoryItems={inventoryItems}
          queuedActions={queuedActions}
          flash={flash}
          incidentsKey={incidentsKey}
          closeBusy={closeBusyId === ficha.event.id}
          closeError={closeError}
          menuItems={menuItemsFor(ficha, true)}
          onRunNext={runNext}
          onMovement={(mode, assignment) => {
            setFlash("");
            setMovement({ mode, assignment, eventName: ficha.event.name });
          }}
          onReload={operations.reload}
          onReloadInventory={inventoryResource.reload}
          onIncidentsChanged={() => {
            inventoryResource.reload();
            operations.reload();
          }}
        />
      ) : null}

      {movement ? (
        <InventoryMovementDialog
          mode={movement.mode}
          assignment={movement.assignment}
          eventName={movement.eventName}
          onClose={() => setMovement(null)}
          onDone={(message, wasQueued) => {
            setFlash(message);
            setMovement(null);
            if (!wasQueued) {
              operations.reload();
              inventoryResource.reload();
              setIncidentsKey((key) => key + 1);
            }
          }}
        />
      ) : null}

      {templateTarget ? (
        <MessageTemplateSendDialog target={templateTarget} onClose={() => setTemplateTarget(null)} />
      ) : null}
      {/* Alta rápida de cliente desde el evento (issue #106): el mismo
          formulario mínimo del módulo Clientes; al crear queda elegido. */}
      {newClientName !== null ? (
        <ClientQuickDialog
          initialName={newClientName}
          onClose={() => setNewClientName(null)}
          onCreated={selectCreatedClient}
        />
      ) : null}
    </div>
  );
}
