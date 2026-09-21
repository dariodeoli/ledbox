"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  formatMoney,
  formatNumber,
  formatTime,
  jobStatusLabel,
  statusTone,
  taskTypeLabel,
} from "@/lib/admin-format";
import type { AdminCalendarAlert, AdminCalendarItem } from "@/lib/admin-types";
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
import { useAdminResource } from "../use-admin-data";

/**
 * Calendario operativo (issue #6).
 *
 * La vista es una grilla mensual en desktop y una lista por día en mobile; la
 * vista semanal usa la misma lista con los siete días completos (sin truncar).
 * Todos los marcadores vienen normalizados por `GET /api/admin/calendar`, que
 * deriva cada uno de un timestamp real: acá no se inventan estados ni fechas.
 */

type CalendarView = "month" | "week";

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
  const parts = asuncionDayFormat.formatToParts(new Date());
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
}: {
  days: string[];
  itemsByDay: Map<string, AdminCalendarItem[]>;
  today: string;
  /** Mobile: la lista del mes muestra solo los días con movimientos (y hoy). */
  onlyWithItems?: boolean;
  /** Detalle de un día ya rotulado por el panel: no repite el encabezado. */
  hideDayHeader?: boolean;
}) {
  const visibleDays = onlyWithItems ? days.filter((day) => (itemsByDay.get(day)?.length ?? 0) > 0 || day === today) : days;
  return (
    <div className="admin-cal-days">
      {visibleDays.map((day) => {
        const dayItems = itemsByDay.get(day) ?? [];
        return (
          <section className="admin-cal-day-row" key={day} data-today={day === today ? "true" : undefined} data-compact={hideDayHeader ? "true" : undefined}>
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
                dayItems.map((item) => <CalendarItemLink key={item.id} item={item} variant="list" />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarItemLink({ item, variant }: { item: AdminCalendarItem; variant: "grid" | "list" }) {
  const tag = itemTagLabel(item);
  const range =
    item.kind === "event" && item.endAt
      ? ` · ${formatCalendarDayShort(item.date)} → ${formatCalendarDayShort(item.endDate)}`
      : "";
  return (
    <Link className="admin-cal-item" href={item.href} data-tone={item.tone} title={`${itemTitleText(item)}${range}`}>
      <span className="admin-cal-item-time">{formatTime(item.at)}</span>
      <span className="admin-cal-item-main">
        <span className="admin-cal-item-title">{item.title}</span>
        {variant === "list" && item.subtitle ? <span className="admin-cal-item-sub">{item.subtitle}</span> : null}
      </span>
      {variant === "list" && item.amount !== null ? (
        <strong className="admin-cal-item-amount">{formatMoney(item.amount)}</strong>
      ) : null}
      {variant === "list" && tag ? (
        <span className="admin-cal-item-badge">
          <AdminBadge tone={statusTone(item.tag)}>{tag}</AdminBadge>
        </span>
      ) : null}
    </Link>
  );
}

export function CalendarioModule() {
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(todayDayKey);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const today = useMemo(todayDayKey, []);
  const range = useMemo(() => (view === "month" ? monthRange(anchor) : weekRange(anchor)), [anchor, view]);
  const calendar = useAdminResource(`/api/admin/calendar?from=${range.from}&to=${range.to}`, (payload) => ({
    items: payload.items ?? [],
    alerts: payload.alerts ?? [],
  }));

  const items = useMemo(() => calendar.data?.items ?? [], [calendar.data]);
  const alerts = useMemo(() => calendar.data?.alerts ?? [], [calendar.data]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AdminCalendarItem[]>();
    for (const item of items) {
      const list = map.get(item.date);
      if (list) list.push(item);
      else map.set(item.date, [item]);
    }
    return map;
  }, [items]);

  const collected = useMemo(
    () => items.filter((item) => item.kind === "collection").reduce((sum, item) => sum + (item.amount ?? 0), 0),
    [items],
  );
  const overdue = alerts.filter((alert) => alert.level === "overdue").length;
  const soon = alerts.filter((alert) => alert.level === "soon").length;
  const selectedItems = selectedDay ? itemsByDay.get(selectedDay) ?? [] : [];

  const periodLabel = view === "month" ? capitalize(formatCalendarMonth(anchor)) : `${formatCalendarDayShort(range.from)} – ${formatCalendarDayShort(range.to)}`;

  function goToToday() {
    setAnchor(today);
    setSelectedDay(today);
  }

  function move(delta: number) {
    setAnchor((current) => (view === "month" ? shiftMonths(current, delta) : shiftDays(current, delta * 7)));
    setSelectedDay(null);
  }

  return (
    <div className="admin-module-page">
      <AdminToolbar>
        <div className="admin-cal-nav">
          <AdminButton onClick={() => move(-1)} title={view === "month" ? "Mes anterior" : "Semana anterior"}>
            Anterior
          </AdminButton>
          <AdminButton onClick={goToToday} icon="refresh" title="Ir al día de hoy">
            Hoy
          </AdminButton>
          <AdminButton onClick={() => move(1)} title={view === "month" ? "Mes siguiente" : "Semana siguiente"}>
            Siguiente
          </AdminButton>
        </div>
        <span className="admin-cal-range">{periodLabel}</span>
        <AdminSelect
          value={view}
          onChange={(value) => {
            setView(value === "week" ? "week" : "month");
            setSelectedDay(null);
          }}
          label="Vista del calendario"
          options={[
            { value: "month", label: "Mes" },
            { value: "week", label: "Semana" },
          ]}
        />
      </AdminToolbar>

      <section className="admin-kpis" aria-label="Indicadores del calendario">
        <AdminKpi label="Movimientos" value={formatNumber(items.length)} note="en el período" />
        <AdminKpi label="Cobros" value={formatMoney(collected)} note="registrados en el período" tone="ok" />
        <AdminKpi label="Atrasados" value={formatNumber(overdue)} note="vencimientos vencidos" tone={overdue > 0 ? "danger" : "ok"} />
        <AdminKpi label="Próximos" value={formatNumber(soon)} note="vencen en 7 días" tone={soon > 0 ? "warn" : "ok"} />
      </section>

      <AdminPanel title={view === "month" ? "Vista mensual" : "Vista semanal"} meta={`${formatNumber(items.length)} movimientos`}>
        <AdminDataState loading={calendar.loading} error={calendar.error} onRetry={calendar.reload} rows={6}>
          {view === "month" ? (
            <div className="admin-cal-month" role="group" aria-label={`Calendario de ${periodLabel}`}>
              {CALENDAR_WEEKDAYS.map((weekday) => (
                <span key={weekday} className="admin-cal-weekday">
                  {weekday}
                </span>
              ))}
              {range.days.map((day) => {
                const dayItems = itemsByDay.get(day) ?? [];
                const hidden = dayItems.length - COLLAPSED_ITEMS;
                return (
                  <div
                    className="admin-cal-cell"
                    key={day}
                    data-outside={day.startsWith(anchor.slice(0, 7)) ? undefined : "true"}
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
                      <CalendarItemLink key={item.id} item={item} variant="grid" />
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
          ) : (
            <CalendarDayList days={range.days} itemsByDay={itemsByDay} today={today} />
          )}

          {/* Mobile: misma información en lista por día, sin grilla apretada. */}
          {view === "month" ? (
            <div className="admin-cal-mobile">
              <p className="admin-cal-mobile-note">Solo días con movimientos y hoy.</p>
              <CalendarDayList days={range.days} itemsByDay={itemsByDay} today={today} onlyWithItems />
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

      {view === "month" && selectedDay ? (
        <div className="admin-cal-selected">
          <AdminPanel
            title={formatCalendarDay(selectedDay)}
            meta={`${formatNumber(selectedItems.length)} movimientos`}
            action={
              <AdminButton onClick={() => setSelectedDay(null)} title="Cerrar el detalle del día">
                Cerrar
              </AdminButton>
            }
          >
            {selectedItems.length === 0 ? (
              <div className="admin-cal-empty">
                <AdminEmpty icon="calendar" title="Sin movimientos" hint="Elegí otro día o navegá a otro período." />
              </div>
            ) : (
              <CalendarDayList days={[selectedDay]} itemsByDay={itemsByDay} today={today} hideDayHeader />
            )}
          </AdminPanel>
        </div>
      ) : null}

      <AdminPanel
        title="Vencimientos y checklist"
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
              <CalendarAlertLink key={alert.id} alert={alert} today={today} />
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

function CalendarAlertLink({ alert, today }: { alert: AdminCalendarAlert; today: string }) {
  const distance = Math.round((dayKeyToUtc(alert.date).getTime() - dayKeyToUtc(today).getTime()) / DAY_MS);
  const when = distance === 0 ? "hoy" : distance < 0 ? `hace ${formatNumber(Math.abs(distance))} d` : `en ${formatNumber(distance)} d`;
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
