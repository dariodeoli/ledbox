"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CALENDAR_WEEKDAYS,
  calendarAlertKindLabel,
  calendarAlertLevelLabel,
  calendarKindLabel,
  eventStatusLabel,
  formatCalendarDay,
  formatCalendarDayShort,
  formatCalendarMonth,
  formatCalendarWeekday,
  formatDayWhen,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  jobStatusLabel,
  statusTone,
  taskTypeLabel,
} from "@/lib/admin-format";
import type { AdminCalendarAlert, AdminCalendarItem, AdminEventPanelRow } from "@/lib/admin-types";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminDataState,
  AdminEmpty,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminSelect,
  AdminToolbar,
} from "../AdminUI";
import { useAdminResource } from "@/lib/admin-api";

/**
 * Calendario operativo (issue #6).
 *
 * La vista es una grilla mensual en desktop y una lista por día en mobile; la
 * vista semanal usa la misma lista con los siete días completos (sin truncar).
 * Todos los marcadores vienen normalizados por `GET /api/admin/calendar`, que
 * deriva cada uno de timestamps reales. `date` es ubicación visible en rango;
 * los límites de duración se muestran desde at/endAt, nunca desde esa ubicación.
 */

type CalendarView = "month" | "week" | "next30" | "twoMonths";

const DAY_MS = 86_400_000;
const COLLAPSED_ITEMS = 2; // Ítems visibles por día en la grilla mensual.

const asuncionDayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Asuncion",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKeyToUtc(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcToDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Día actual de Asunción (`YYYY-MM-DD`), independiente de la zona del navegador. */
function todayDayKey(): string {
  return timestampDayKey(new Date());
}

function timestampDayKey(value: Date): string {
  const parts = asuncionDayFormat.formatToParts(value);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7; // lunes = 0
}

/** Solo la primera letra: los rótulos de Intl vienen en minúscula ("septiembre de 2026"). */
function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function shiftDays(dayKey: string, days: number): string {
  const date = dayKeyToUtc(dayKey);
  return utcToDayKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)));
}

function shiftMonths(dayKey: string, months: number): string {
  const date = dayKeyToUtc(dayKey);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return utcToDayKey(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)));
}

/** Grilla mensual completa (incluye los días de los meses vecinos que la ocupan). */
function monthRange(anchorKey: string) {
  const anchor = dayKeyToUtc(anchorKey);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const start = new Date(Date.UTC(year, month, 1 - mondayIndex(first)));
  const end = new Date(Date.UTC(year, month, last.getUTCDate() + (6 - mondayIndex(last))));
  const days: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MS) {
    days.push(utcToDayKey(new Date(cursor)));
  }
  return { from: days[0], to: days[days.length - 1], days };
}

function weekRange(anchorKey: string) {
  const anchor = dayKeyToUtc(anchorKey);
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - mondayIndex(anchor)));
  const days = Array.from({ length: 7 }, (_, index) =>
    utcToDayKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index))),
  );
  return { from: days[0], to: days[6], days };
}

function calendarRange(anchor: string, view: CalendarView) {
  if (view === "week") return weekRange(anchor);
  if (view === "next30") {
    const days = Array.from({ length: 30 }, (_, index) => shiftDays(anchor, index));
    return { from: days[0], to: days[29], days };
  }
  const first = monthRange(anchor);
  if (view === "month") return first;
  const second = monthRange(shiftMonths(anchor, 1));
  return { from: first.from, to: second.to, days: Array.from(new Set([...first.days, ...second.days])) };
}

/** Etiqueta del enum real que acompaña al marcador (estado o tipo). */
function itemTagLabel(item: AdminCalendarItem): string | null {
  if (!item.tag) return null;
  if (item.kind === "task") return taskTypeLabel(item.tag);
  if (item.kind === "supplier_due" || item.kind === "supplier_delivery" || item.kind === "supplier_payment") {
    return jobStatusLabel(item.tag);
  }
  return eventStatusLabel(item.tag);
}

function itemTitleText(item: AdminCalendarItem): string {
  const parts = [calendarKindLabel(item.kind), item.title];
  if (item.subtitle) parts.push(item.subtitle);
  return parts.join(" · ");
}

/** Bloque de un día: lo comparten la vista semanal, la lista mobile y el detalle del día. */
function CalendarDayList({
  days,
  itemsByDay,
  today,
  onlyWithItems,
  hideDayHeader,
  onSelect,
}: {
  days: string[];
  itemsByDay: Map<string, AdminCalendarItem[]>;
  today: string;
  /** Mobile: la lista del mes muestra solo los días con movimientos (y hoy). */
  onlyWithItems?: boolean;
  /** Detalle de un día ya rotulado por el panel: no repite el encabezado. */
  hideDayHeader?: boolean;
  onSelect: (item: AdminCalendarItem) => void;
}) {
  const visibleDays = onlyWithItems ? days.filter((day) => (itemsByDay.get(day)?.length ?? 0) > 0 || day === today) : days;
  return (
    <div className="admin-cal-days">
      {visibleDays.map((day) => {
        const dayItems = itemsByDay.get(day) ?? [];
        return (
          <section className="admin-cal-day-row" key={day} data-date={day} data-today={day === today ? "true" : undefined} data-compact={hideDayHeader ? "true" : undefined}>
            {hideDayHeader ? null : (
              <header className="admin-cal-day-label">
                <span className="admin-cal-day-name">{formatCalendarWeekday(day)}</span>
                <span className="admin-cal-day-num">{formatCalendarDayShort(day)}</span>
              </header>
            )}
            <div className="admin-cal-day-items">
              {dayItems.length === 0 ? (
                <p className="admin-cal-day-empty">Sin movimientos</p>
              ) : (
                dayItems.map((item) => <CalendarItemLink key={item.id} item={item} variant="list" onSelect={onSelect} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarItemLink({ item, variant, onSelect }: { item: AdminCalendarItem; variant: "grid" | "list"; onSelect: (item: AdminCalendarItem) => void }) {
  const tag = itemTagLabel(item);
  const range =
    item.kind === "event" && item.endAt
      ? ` · ${formatDateTime(item.at)} → ${formatDateTime(item.endAt)}`
      : "";
  return (
    <button type="button" className="admin-cal-item" onClick={() => onSelect(item)} data-variant={variant} data-kind={item.kind} data-tone={item.tone} title={`${itemTitleText(item)}${range}`} aria-label={`Ver resumen: ${item.title}`}>
      <span className="admin-cal-item-time">{formatTime(item.at)}</span>
      <span className="admin-cal-item-main">
        <span className="admin-cal-item-title">{item.title}</span>
        {item.subtitle ? <span className="admin-cal-item-sub">{item.subtitle}</span> : null}
        {range ? <span className="admin-cal-item-sub">{range.slice(3)}</span> : null}
      </span>
      {variant === "list" && item.amount !== null ? (
        <strong className="admin-cal-item-amount">{formatMoney(item.amount)}</strong>
      ) : null}
      {variant === "list" && tag ? (
        <span className="admin-cal-item-badge">
          <AdminBadge tone={statusTone(item.tag)}>{tag}</AdminBadge>
        </span>
      ) : null}
    </button>
  );
}

export function CalendarioModule({ events = [], eventsLoading = false, eventsError = "", onRetryEvents }: {
  events?: AdminEventPanelRow[];
  eventsLoading?: boolean;
  eventsError?: string;
  onRetryEvents?: () => void;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(todayDayKey);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<AdminCalendarItem | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const selectionOrigin = useRef<HTMLElement | null>(null);
  function selectItem(item: AdminCalendarItem) {
    selectionOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedItem(item);
  }
  function closeSummary() {
    setSelectedItem(null);
    selectionOrigin.current?.focus();
  }
  useEffect(() => { if (selectedItem) summaryRef.current?.focus(); }, [selectedItem]);

  const today = useMemo(todayDayKey, []);
  const range = useMemo(() => calendarRange(anchor, view), [anchor, view]);
  const calendar = useAdminResource(`/api/admin/calendar?from=${range.from}&to=${range.to}`, (payload) => ({
    items: payload.items ?? [],
    alerts: payload.alerts ?? [],
  }));

  const items = useMemo(() => calendar.data?.items ?? [], [calendar.data]);
  const alerts = useMemo(() => calendar.data?.alerts ?? [], [calendar.data]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AdminCalendarItem[]>();
    for (const item of items) {
      // Se conserva el rango original del API; sólo se expande su presencia visual.
      const duration = item.kind === "event" && item.endAt && new Date(item.endAt).getTime() > new Date(item.at).getTime();
      const start = duration ? timestampDayKey(new Date(item.at)) : item.date;
      const from = start < range.from ? range.from : start;
      // [inicio, fin): medianoche de fin no crea un día extra de ocupación.
      const to = duration ? timestampDayKey(new Date(new Date(item.endAt!).getTime() - 1)) : item.date;
      for (let day = from; day <= to && day <= range.to; day = shiftDays(day, 1)) {
        const list = map.get(day);
        if (list) list.push(item);
        else map.set(day, [item]);
      }
    }
    return map;
  }, [items, range.from, range.to]);

  const collected = useMemo(
    () => items.filter((item) => item.kind === "collection").reduce((sum, item) => sum + (item.amount ?? 0), 0),
    [items],
  );
  const overdue = alerts.filter((alert) => alert.level === "overdue").length;
  const soon = alerts.filter((alert) => alert.level === "soon").length;
  const selectedItems = selectedDay ? itemsByDay.get(selectedDay) ?? [] : [];

  const periodLabel = view === "month" ? capitalize(formatCalendarMonth(anchor)) : view === "twoMonths"
    ? `${capitalize(formatCalendarMonth(anchor))} · ${capitalize(formatCalendarMonth(shiftMonths(anchor, 1)))}`
    : `${formatCalendarDayShort(range.from)} – ${formatCalendarDayShort(range.to)}`;
  const monthly = view === "month" || view === "twoMonths";
  const selectedEvent = selectedItem ? events.find((event) => event.id === selectedItem.id.split(":").slice(1).join(":")) : undefined;

  function goToToday() {
    setAnchor(today);
    setSelectedDay(today);
    setSelectedItem(null);
  }

  function move(delta: number) {
    setAnchor((current) => monthly ? shiftMonths(current, delta * (view === "twoMonths" ? 2 : 1)) : shiftDays(current, delta * (view === "next30" ? 30 : 7)));
    setSelectedDay(null);
    setSelectedItem(null);
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores del calendario">
        <AdminKpi label="Movimientos" icon="calendar" value={formatNumber(items.length)} note="en el período" />
        <AdminKpi label="Cobros" icon="finance" value={formatMoney(collected)} note="registrados en el período" tone="ok" />
        <AdminKpi label="Atrasados" icon="alert" value={formatNumber(overdue)} note="vencimientos vencidos" tone={overdue > 0 ? "danger" : "ok"} />
        <AdminKpi label="Próximos" icon="clock" value={formatNumber(soon)} note="vencen en 7 días" tone={soon > 0 ? "warn" : "ok"} />
      </section>

      <AdminToolbar>
        <div className="admin-cal-nav">
          <AdminButton icon="arrow-left" onClick={() => move(-1)} title="Período anterior">
            Anterior
          </AdminButton>
          <AdminButton onClick={goToToday} icon="refresh" title="Ir al día de hoy">
            Hoy
          </AdminButton>
          <AdminButton onClick={() => move(1)} icon="arrow-right" title="Período siguiente">
            Siguiente
          </AdminButton>
        </div>
        <span className="admin-cal-range">{periodLabel}</span>
        <AdminSelect
          value={view}
          onChange={(value) => {
            setView(value as CalendarView);
            setSelectedDay(null);
            setSelectedItem(null);
          }}
          label="Vista del calendario"
          options={[
            { value: "month", label: "Mes" },
            { value: "week", label: "Semana" },
            { value: "next30", label: "Próximos 30 días" },
            { value: "twoMonths", label: "Dos meses" },
          ]}
        />
      </AdminToolbar>

      {selectedItem ? (
        <AdminPanel title={selectedItem.title} icon="calendar" action={<AdminButton icon="close" onClick={closeSummary}>Cerrar resumen</AdminButton>}>
          <div className="admin-cal-summary" ref={summaryRef} tabIndex={-1} aria-label={`Resumen: ${selectedItem.title}`} role="region" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSummary(); } }}>
            <AdminBadge tone={selectedItem.tone}>{calendarKindLabel(selectedItem.kind)}</AdminBadge>
            {itemTagLabel(selectedItem) ? <AdminBadge tone={statusTone(selectedItem.tag)}>{itemTagLabel(selectedItem)}</AdminBadge> : null}
            {selectedEvent ? null : <p>{selectedItem.subtitle ?? "Sin información adicional"}</p>}
            <dl>
              {!selectedEvent || selectedItem.kind !== "event" ? <div><dt>Fecha del movimiento</dt><dd>{formatDateTime(selectedItem.at)}</dd></div> : null}
              {!selectedEvent && selectedItem.endAt ? <div><dt>Fin de la duración</dt><dd>{formatDateTime(selectedItem.endAt)}</dd></div> : null}
              {selectedEvent ? <>
                <div><dt>Inicio del evento</dt><dd>{selectedEvent.startsAt ? formatDateTime(selectedEvent.startsAt) : "Sin fecha informada"}</dd></div>
                <div><dt>Fin del evento</dt><dd>{selectedEvent.endsAt ? formatDateTime(selectedEvent.endsAt) : "Sin fecha informada"}</dd></div>
                <div><dt>Cliente</dt><dd>{selectedEvent.client.company || selectedEvent.client.name}</dd></div>
                <div><dt>Lugar</dt><dd>{[selectedEvent.location, selectedEvent.city].filter(Boolean).join(" · ") || "Sin lugar informado"}</dd></div>
                <div><dt>Montaje</dt><dd>{selectedEvent.setupAt ? formatDateTime(selectedEvent.setupAt) : "Sin fecha informada"}</dd></div>
                <div><dt>Desmontaje</dt><dd>{selectedEvent.strikeAt ? formatDateTime(selectedEvent.strikeAt) : "Sin fecha informada"}</dd></div>
              </> : null}
            </dl>
            {!selectedEvent && ["event", "event_end", "setup", "strike"].includes(selectedItem.kind) ? <AdminDataState loading={eventsLoading} error={eventsError} onRetry={onRetryEvents}><AdminNote>Ficha operativa no disponible en los datos cargados.</AdminNote></AdminDataState> : null}
            <Link className="admin-btn" href={selectedItem.href}>Abrir ficha completa</Link>
          </div>
        </AdminPanel>
      ) : null}

      <AdminPanel title={monthly ? (view === "twoMonths" ? "Vista de dos meses" : "Vista mensual") : view === "next30" ? "Próximos 30 días" : "Vista semanal"} icon="calendar" meta={`${formatNumber(items.length)} movimientos`}>
        <AdminDataState loading={calendar.loading} error={calendar.error} onRetry={calendar.reload} rows={6}>
          {monthly ? (
            <div className="admin-cal-months" data-double={view === "twoMonths" ? "true" : undefined}>
            {(view === "twoMonths" ? [anchor, shiftMonths(anchor, 1)] : [anchor]).map((month) => <section key={month} className="admin-cal-month-section" aria-label={capitalize(formatCalendarMonth(month))}>
            <h3 className="admin-cal-month-label">{capitalize(formatCalendarMonth(month))}</h3>
            <div className="admin-cal-month" role="group" aria-label={`Calendario de ${formatCalendarMonth(month)}`}>
              {CALENDAR_WEEKDAYS.map((weekday) => (
                <span key={weekday} className="admin-cal-weekday">
                  {weekday}
                </span>
              ))}
              {monthRange(month).days.map((day) => {
                const dayItems = itemsByDay.get(day) ?? [];
                const hidden = dayItems.length - COLLAPSED_ITEMS;
                return (
                  <div
                    className="admin-cal-cell"
                    key={day}
                    data-date={day}
                    data-outside={day.startsWith(month.slice(0, 7)) ? undefined : "true"}
                    data-today={day === today ? "true" : undefined}
                    data-selected={day === selectedDay ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className="admin-cal-day"
                      onClick={() => setSelectedDay(day)}
                      title={`Ver el detalle de ${formatCalendarDay(day)}`}
                      aria-label={`Ver el detalle de ${formatCalendarDay(day)}`}
                    >
                      <span className="admin-cal-day-number">{Number(day.slice(8, 10))}</span>
                      {dayItems.length > 0 ? <span className="admin-cal-day-count">{formatNumber(dayItems.length)}</span> : null}
                    </button>
                    {dayItems.slice(0, COLLAPSED_ITEMS).map((item) => (
                      <CalendarItemLink key={item.id} item={item} variant="grid" onSelect={selectItem} />
                    ))}
                    {hidden > 0 ? (
                      <button type="button" className="admin-cal-more" onClick={() => setSelectedDay(day)} title={`Ver ${formatNumber(dayItems.length)} movimientos`}>
                        +{formatNumber(hidden)} más
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            </section>)}
            </div>
          ) : (
            <CalendarDayList days={range.days} itemsByDay={itemsByDay} today={today} onSelect={selectItem} />
          )}

          {/* Mobile: misma información en lista por día, sin grilla apretada. */}
          {monthly ? (
            <div className="admin-cal-mobile">
              <p className="admin-cal-mobile-note">Solo días con movimientos y hoy.</p>
              <CalendarDayList days={range.days} itemsByDay={itemsByDay} today={today} onlyWithItems onSelect={selectItem} />
            </div>
          ) : null}
        </AdminDataState>

        {!calendar.loading && !calendar.error && items.length === 0 ? (
          <div className="admin-cal-empty">
            <AdminEmpty
              icon="calendar"
              title="Sin movimientos en el período"
              hint="No hay montajes, eventos, cobros, entregas de proveedores ni tareas con vencimiento en estas fechas."
            />
          </div>
        ) : null}
      </AdminPanel>

      {monthly && selectedDay ? (
        <div className="admin-cal-selected">
          <AdminPanel
            title={formatCalendarDay(selectedDay)} icon="clock"
            meta={`${formatNumber(selectedItems.length)} movimientos`}
            action={
              <AdminButton icon="close" onClick={() => setSelectedDay(null)} title="Cerrar el detalle del día">
                Cerrar
              </AdminButton>
            }
          >
            {selectedItems.length === 0 ? (
              <div className="admin-cal-empty">
                <AdminEmpty icon="calendar" title="Sin movimientos" hint="Elegí otro día o navegá a otro período." />
              </div>
            ) : (
              <CalendarDayList days={[selectedDay]} itemsByDay={itemsByDay} today={today} hideDayHeader onSelect={selectItem} />
            )}
          </AdminPanel>
        </div>
      ) : null}

      <AdminPanel
        title="Vencimientos y checklist" icon="alert"
        meta={`${formatNumber(alerts.length)} alertas`}
        action={overdue > 0 ? <AdminBadge tone="danger">{`${formatNumber(overdue)} atrasadas`}</AdminBadge> : <AdminBadge tone="ok">Sin atrasos</AdminBadge>}
      >
        {alerts.length === 0 ? (
          <div className="admin-cal-empty">
            <AdminEmpty
              icon="check"
              title="Sin vencimientos próximos"
              hint="No hay tareas, pagos a proveedores ni checklists incompletos con vencimiento en los próximos 7 días."
            />
          </div>
        ) : (
          <div className="admin-cal-alerts">
            {alerts.slice(0, 8).map((alert) => (
              <CalendarAlertLink key={alert.id} alert={alert} />
            ))}
          </div>
        )}
        {alerts.length > 8 ? (
          <AdminNote>Mostrando las primeras 8 alertas de {formatNumber(alerts.length)}. El detalle completo vive en Eventos y Finanzas.</AdminNote>
        ) : null}
      </AdminPanel>
    </div>
  );
}

function CalendarAlertLink({ alert }: { alert: AdminCalendarAlert }) {
  // Mismo lenguaje de cuenta regresiva que el resto del panel (issue #25).
  const when = formatDayWhen(alert.date);
  const label = `${calendarAlertLevelLabel(alert.level)} · ${calendarAlertKindLabel(alert.kind)}: ${alert.title}`;
  return (
    <Link className="admin-cal-alert" href={alert.href} data-level={alert.level} title={`${label} · ${formatCalendarDay(alert.date)} · ir al módulo`}>
      <AdminBadge tone={alert.level === "overdue" ? "danger" : "warn"}>{calendarAlertLevelLabel(alert.level)}</AdminBadge>
      <span className="admin-cal-alert-main">
        <span className="admin-cal-alert-title">{alert.title}</span>
        <span className="admin-cal-alert-sub">
          {calendarAlertKindLabel(alert.kind)}
          {alert.subtitle ? ` · ${alert.subtitle}` : ""}
        </span>
      </span>
      <span className="admin-cal-alert-date" title={formatCalendarDay(alert.date)}>
        {formatCalendarDayShort(alert.date)} · {when}
      </span>
      <AdminIcon name="info" size={14} />
    </Link>
  );
}
