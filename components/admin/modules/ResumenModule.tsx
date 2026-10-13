"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatNumber, formatTime } from "@/lib/admin-format";
import { canWriteClients } from "@/lib/admin-policy";
import type { AdminResumen } from "@/lib/admin-types";
import type { AdminResumenBoard } from "@/lib/resumen-board";
import { buildTodayActions, TODAY_ACTIONS_LIMIT, weekEventChip, type TodayAction } from "@/lib/resumen-actions";
import { useAdminNotifications, useAdminSession } from "../AdminShell";
import { AdminBadge, AdminDataState, AdminEmpty, AdminErrorState, AdminLoadingRows, AdminNote, AdminPanel } from "../AdminUI";
import { AdminIcon } from "../AdminIcons";
import { useAdminResource } from "@/lib/admin-api";
import { AgingBlock, BudgetsBlock, ForecastBlock, MoneyStrip, OperationBlock, TrendBlock } from "./ResumenBoard";

/**
 * Resumen (inicio del panel): «Para hacer hoy» arriba (lo accionable) y debajo un
 * tablero con gráficos: previsibilidad de cobros, pendientes por antigüedad,
 * presupuestos en juego con el embudo, tendencia de 6 meses, operación y «Esta
 * semana». Todo sale de datos reales (`/api/admin/notifications` y
 * `/api/admin/resumen`); nada se inventa: sin datos cada bloque dice qué falta.
 */

const TIME_ZONE = "America/Asuncion";
const dateFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hourFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });
const weekdayFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, weekday: "short" });
const dayFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, day: "2-digit" });
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

function greetingFor(now: Date): string {
  const hour = Number(hourFormat.format(now));
  if (hour < 12) return "Buen día";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function firstName(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ResumenModule() {
  const { role, user } = useAdminSession();
  const resource = useAdminResource<{ resumen: AdminResumen | null; board: AdminResumenBoard | null }>("/api/admin/resumen", (payload) => {
    const body = payload as { resumen?: AdminResumen; board?: AdminResumenBoard };
    return { resumen: body.resumen ?? null, board: body.board ?? null };
  });
  // «Para hacer hoy» y «Esta semana» solo necesitan el Resumen clásico.
  const resumen = { ...resource, data: resource.data?.resumen ?? null };
  const notifications = useAdminNotifications();
  // La fecha se arma en el navegador: evita diferencias de hidratación con el servidor.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const name = firstName(user?.name);
  const canCreateLead = canWriteClients(role);

  return (
    <div className="admin-module-page admin-resumen">
      <header className="admin-resumen-head">
        <div className="admin-resumen-hello">
          <h2 className="admin-resumen-title">
            {now ? greetingFor(now) : "Hola"}
            {name ? `, ${name}` : ""}
          </h2>
          <p className="admin-resumen-date">{now ? capitalize(dateFormat.format(now)) : " "}</p>
        </div>
        {canCreateLead ? (
          <Link className="admin-btn admin-btn--primary" href="/leads?nuevo=1" title="Cargar una consulta que llegó por llamada, WhatsApp o referido">
            <AdminIcon name="plus" size={15} />
            <span>Nuevo lead</span>
          </Link>
        ) : null}
      </header>

      <div className="admin-resumen-today-row">
        <TodayBlock now={now} resumen={resumen} notifications={notifications} />
      </div>

      <MoneyStrip resource={resource} />

      <div className="admin-board-grid">
        <div className="admin-board-cell" data-area="forecast">
          <ForecastBlock resource={resource} />
        </div>
        <div className="admin-board-cell" data-area="aging">
          <AgingBlock resource={resource} />
        </div>
        <div className="admin-board-cell" data-area="budgets">
          <BudgetsBlock resource={resource} />
        </div>
        <div className="admin-board-cell" data-area="trend">
          <TrendBlock resource={resource} />
        </div>
        <div className="admin-board-cell" data-area="operation">
          <OperationBlock resource={resource} />
        </div>
        <div className="admin-board-cell" data-area="week">
          <WeekBlock resumen={resumen} />
        </div>
      </div>
    </div>
  );
}

// ── (a) Para hacer hoy ──────────────────────────────────────────────────────

function TodayBlock({
  now,
  resumen,
  notifications,
}: {
  now: Date | null;
  resumen: ReturnType<typeof useAdminResource<AdminResumen | null>>;
  notifications: ReturnType<typeof useAdminNotifications>;
}) {
  const [expanded, setExpanded] = useState(false);
  const loading = resumen.loading || notifications.loading || !now;
  const bothFailed = Boolean(resumen.error && notifications.error);

  const actions = useMemo<TodayAction[]>(() => {
    if (!now) return [];
    return buildTodayActions({
      notifications: notifications.data?.notifications ?? [],
      resumen: resumen.data,
      today: dayKeyFormat.format(now),
    });
  }, [now, notifications.data, resumen.data]);

  const visible = expanded ? actions : actions.slice(0, TODAY_ACTIONS_LIMIT);
  const hidden = actions.length - TODAY_ACTIONS_LIMIT;

  return (
    <section className="admin-panel admin-resumen-today" aria-labelledby="resumen-hoy">
      <header className="admin-panel-head">
        <span className="admin-panel-icon" aria-hidden="true">
          <AdminIcon name="bell" size={13} />
        </span>
        <h2 className="admin-panel-title" id="resumen-hoy">Para hacer hoy</h2>
        {!loading && actions.length > 0 ? <span className="admin-panel-meta">{formatNumber(actions.length)} pendientes</span> : null}
      </header>
      {loading ? (
        <AdminLoadingRows rows={4} label="Cargando lo que hay para hacer hoy" />
      ) : bothFailed ? (
        <AdminErrorState
          message={resumen.error}
          onRetry={() => {
            resumen.reload();
            notifications.reload();
          }}
        />
      ) : (
        <>
          {resumen.error || notifications.error ? (
            <AdminNote tone="warn">
              {resumen.error ? "No pudimos cargar los cobros y leads." : "No pudimos cargar los avisos de eventos."} Lo que ves puede estar incompleto.
            </AdminNote>
          ) : null}
          {actions.length === 0 ? (
            <AdminEmpty icon="check" title="Todo al día" hint="No hay cobros vencidos, leads sin contestar ni checklist en riesgo." />
          ) : (
            <>
              <ul className="admin-today-list">
                {visible.map((action) => (
                  <li className="admin-today-item" data-tone={action.tone} key={action.id}>
                    <span className="admin-today-rail" aria-hidden="true" />
                    <div className="admin-today-text">
                      <strong className="admin-today-title">{action.title}</strong>
                      {action.detail ? <span className="admin-today-detail">{action.detail}</span> : null}
                    </div>
                    <Link className="admin-btn admin-today-action" href={action.href} title={`${action.label}: ${action.title}`}>
                      <span>{action.label}</span>
                      <AdminIcon name="arrow-right" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
              {hidden > 0 ? (
                <div className="admin-today-more">
                  <button
                    type="button"
                    className="admin-btn"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((current) => !current)}
                  >
                    <span>{expanded ? "Ver menos" : `Ver todos (${formatNumber(actions.length)})`}</span>
                  </button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ── Esta semana ─────────────────────────────────────────────────────────

function WeekBlock({ resumen }: { resumen: ReturnType<typeof useAdminResource<AdminResumen | null>> }) {
  const events = resumen.data?.week ?? [];
  return (
    <AdminPanel
      title="Esta semana"
      icon="calendar"
      meta={resumen.data ? `${formatNumber(events.length)} ${events.length === 1 ? "evento" : "eventos"}` : undefined}
      action={
        <Link className="admin-panel-link" href="/eventos?vista=calendario">
          Ver calendario →
        </Link>
      }
    >
      <AdminDataState
        loading={resumen.loading}
        error={resumen.error}
        onRetry={resumen.reload}
        empty={events.length === 0}
        emptyTitle="Sin eventos esta semana"
        emptyIcon="calendar"
        emptyHint="Los eventos de los próximos 7 días aparecen acá con su checklist y su seña."
        emptyAction={
          <Link className="admin-empty-link" href="/eventos">
            Ver eventos →
          </Link>
        }
        rows={3}
      >
        <ul className="admin-week-list">
          {events.map((event) => {
            const chip = weekEventChip(event);
            const start = event.startsAt ? new Date(event.startsAt) : null;
            const detail = [start ? formatTime(start) : "Hora a confirmar", event.client, event.place].filter(Boolean).join(" · ");
            return (
              <li key={event.id}>
                <Link className="admin-week-item" href="/eventos" title={`${event.name} · ${detail}`}>
                  <span className="admin-week-date" aria-hidden="true">
                    <small>{start ? weekdayFormat.format(start).replace(/\.$/, "") : "—"}</small>
                    <strong>{start ? dayFormat.format(start) : "—"}</strong>
                  </span>
                  <span className="admin-week-text">
                    <strong className="admin-week-name">{event.name}</strong>
                    <span className="admin-week-detail">{detail}</span>
                  </span>
                  <AdminBadge tone={chip.tone} title={chip.label}>
                    {chip.label}
                  </AdminBadge>
                </Link>
              </li>
            );
          })}
        </ul>
      </AdminDataState>
    </AdminPanel>
  );
}
