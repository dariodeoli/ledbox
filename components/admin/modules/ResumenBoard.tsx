"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney, formatMoneyCompact, formatMonthKey, formatNumber } from "@/lib/admin-format";
import { AGING_PARAMS, conversionRate, type AdminResumenBoard, type AgingKey } from "@/lib/resumen-board";
import type { AdminResumen } from "@/lib/admin-types";
import { AdminBadge, AdminEmpty, AdminErrorState, AdminPanel } from "../AdminUI";
import { ChartBarList, type ChartBarItem } from "../charts/ChartBarList";
import { ChartBars } from "../charts/ChartBars";
import { ChartSkeleton } from "../charts/ChartSkeleton";

/**
 * Tablero gráfico del Inicio. Cada bloque dibuja datos reales de
 * `GET /api/admin/resumen` (`board`): sin filas dice qué falta, nunca inventa, y
 * mientras carga muestra un esqueleto del mismo tamaño.
 */

type Resource = { data: { resumen: AdminResumen | null; board: AdminResumenBoard | null } | null; loading: boolean; error: string; reload: () => void };

const shortMonth = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", month: "short" });

/** `2026-10-13` → `13/10`. */
export function dayMonth(key: string): string {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

function weekRange(start: string): string {
  const [year, month, day] = start.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + 6));
  const endKey = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  return `Semana del ${dayMonth(start)} al ${dayMonth(endKey)}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return shortMonth.format(new Date(Date.UTC(year, month - 1, 15))).replace(/\.$/, "");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ageText(days: number): string {
  if (days <= 0) return "de hoy";
  return days === 1 ? "hace 1 día" : `hace ${formatNumber(days)} días`;
}

function money(value: number) {
  return { compact: formatMoneyCompact(value), full: formatMoney(value) };
}

/** Contenedor de un bloque con carga (esqueleto), error y datos. */
function BoardBody({ resource, children, height = 210 }: { resource: Resource; children: (board: AdminResumenBoard) => ReactNode; height?: number }) {
  if (resource.loading) return <ChartSkeleton height={height} />;
  if (resource.error) return <AdminErrorState message={resource.error} onRetry={resource.reload} />;
  if (!resource.data?.board) return <AdminErrorState message="No pudimos cargar el tablero." onRetry={resource.reload} />;
  return <div className="admin-board-body">{children(resource.data.board)}</div>;
}

// ── Plata (tres cifras) ─────────────────────────────────────────────────────

export function MoneyStrip({ resource }: { resource: Resource }) {
  const m = resource.data?.resumen?.money;
  const cards = m
    ? [
        { key: "receivable", label: "Por cobrar", value: m.receivable, note: "saldo de presupuestos aprobados", href: "/finanzas/por-cobrar", tone: undefined as "danger" | "ok" | undefined },
        {
          key: "overdue",
          label: "En mora",
          value: m.overdueAmount,
          note: m.overdueCount > 0 ? `${formatNumber(m.overdueCount)} ${m.overdueCount === 1 ? "cobro vencido" : "cobros vencidos"}` : "sin cobros vencidos",
          href: "/finanzas/por-cobrar",
          tone: m.overdueCount > 0 ? ("danger" as const) : undefined,
        },
        { key: "collected", label: "Cobrado este mes", value: m.collectedMonth, note: "cobros confirmados", href: "/finanzas", tone: m.collectedMonth > 0 ? ("ok" as const) : undefined },
      ]
    : [];
  return (
    <section className="admin-money-strip" aria-label="Plata del mes">
      {resource.loading ? (
        <>
          {[0, 1, 2].map((index) => (
            <span key={index} className="admin-skeleton-row admin-money-skeleton" role="status" aria-label="Cargando plata" />
          ))}
        </>
      ) : resource.error || !m ? (
        <AdminErrorState message={resource.error || "No pudimos cargar la plata."} onRetry={resource.reload} />
      ) : (
        cards.map((card) => {
          const v = money(card.value);
          return (
            <Link key={card.key} className="admin-money-card" data-tone={card.tone} href={card.href} title={`${card.label}: ${v.full}`}>
              <span className="admin-money-label">{card.label}</span>
              <strong className="admin-money-value">{v.compact}</strong>
              <span className="admin-money-note">
                {v.compact !== v.full ? `${v.full} · ` : ""}
                {card.note}
              </span>
            </Link>
          );
        })
      )}
    </section>
  );
}

// ── 1. Previsibilidad de cobros ─────────────────────────────────────────────

export function ForecastBlock({ resource }: { resource: Resource }) {
  return (
    <AdminPanel
      title="Previsibilidad de cobros"
      icon="finance"
      meta="próximas 8 semanas"
      action={
        <Link className="admin-panel-link" href="/finanzas/por-confirmar">
          Ver pagos esperados →
        </Link>
      }
    >
      <BoardBody resource={resource}>
        {({ forecast }) => {
          const hasData = forecast.totals.d90 > 0 || forecast.weeks.some((week) => week.count > 0);
          if (!hasData) {
            return (
              <AdminEmpty
                icon="finance"
                title="Sin cobros esperados"
                hint="Los pagos esperados nacen al aprobar un presupuesto con plan de pagos (anticipo, cuotas, saldo) y aparecen acá por semana de vencimiento."
              />
            );
          }
          const totals = [
            { key: "d30", label: "A 30 días", value: forecast.totals.d30 },
            { key: "d60", label: "A 60 días", value: forecast.totals.d60 },
            { key: "d90", label: "A 90 días", value: forecast.totals.d90 },
          ];
          return (
            <>
              <dl className="admin-board-stats">
                {totals.map((total) => {
                  const v = money(total.value);
                  return (
                    <div key={total.key} className="admin-board-stat" title={`${total.label}: ${v.full}`}>
                      <dt>{total.label}</dt>
                      <dd>{v.compact}</dd>
                    </div>
                  );
                })}
              </dl>
              <ChartBars
                caption="Cobros esperados por semana, separados en con comprobante, pendientes y en mora"
                mode="stacked"
                showTotals
                categories={forecast.weeks.map((week, index) => ({
                  key: week.start,
                  label: index === 0 ? "Hoy" : dayMonth(week.start),
                  title: index === 0 ? `${weekRange(week.start)} (incluye lo vencido)` : weekRange(week.start),
                }))}
                series={[
                  { key: "proof", label: "Con comprobante", tone: "ok", values: forecast.weeks.map((week) => week.proof) },
                  { key: "pending", label: "Pendiente", tone: "accent", values: forecast.weeks.map((week) => week.pending) },
                  { key: "overdue", label: "En mora", tone: "danger", values: forecast.weeks.map((week) => week.overdue) },
                ]}
              />
              <p className="admin-board-note">
                Resta lo ya cobrado de cada pago. La mora ({formatMoneyCompact(forecast.overdueTotal)}) está en la primera semana y suma en los totales.
                {forecast.undated.count > 0
                  ? ` ${formatNumber(forecast.undated.count)} ${forecast.undated.count === 1 ? "pago sin fecha" : "pagos sin fecha"} de vencimiento (${formatMoneyCompact(forecast.undated.amount)}) no entran en el gráfico.`
                  : ""}
              </p>
            </>
          );
        }}
      </BoardBody>
    </AdminPanel>
  );
}

// ── 2. Pendientes de cobro por antigüedad ───────────────────────────────────

const AGING_TONE: Record<AgingKey, ChartBarItem["tone"]> = { current: "ok", d1_30: "warn", d31_60: "danger", d60plus: "danger" };

export function AgingBlock({ resource }: { resource: Resource }) {
  return (
    <AdminPanel
      title="Pendientes por antigüedad"
      icon="clock"
      action={
        <Link className="admin-panel-link" href="/finanzas/por-cobrar">
          Ver por cobrar →
        </Link>
      }
    >
      <BoardBody resource={resource} height={190}>
        {({ aging }) => {
          const total = aging.reduce((sum, bucket) => sum + bucket.amount, 0);
          const count = aging.reduce((sum, bucket) => sum + bucket.count, 0);
          if (count === 0) {
            return <AdminEmpty icon="check" title="Sin cobros a plazo pendientes" hint="Cuando registres un cobro con vencimiento, acá ves cuánto lleva atrasado." />;
          }
          return (
            <>
              <p className="admin-board-headline">
                <strong>{formatMoneyCompact(total)}</strong> en {formatNumber(count)} {count === 1 ? "cobro a plazo" : "cobros a plazo"}
              </p>
              <ChartBarList
                label="Cobros a plazo pendientes por días de atraso"
                items={aging.map((bucket) => ({
                  key: bucket.key,
                  label: bucket.label,
                  value: bucket.amount,
                  valueLabel: formatMoneyCompact(bucket.amount),
                  detail: `${formatNumber(bucket.count)} ${bucket.count === 1 ? "cobro" : "cobros"}`,
                  tone: AGING_TONE[bucket.key],
                  href: `/finanzas/por-cobrar?vence=${AGING_PARAMS[bucket.key]}`,
                  title: `${bucket.label}: ${formatMoney(bucket.amount)} en ${bucket.count} cobros. Ver la lista filtrada`,
                }))}
              />
              <p className="admin-board-note">«Al día» incluye los cobros sin vencimiento. Los días cuentan desde el vencimiento.</p>
            </>
          );
        }}
      </BoardBody>
    </AdminPanel>
  );
}

// ── 3. Presupuestos en juego ────────────────────────────────────────────────

const STATUS_LABEL = { SENT: "Enviado", NEGOTIATING: "En negociación" } as const;

export function BudgetsBlock({ resource }: { resource: Resource }) {
  const funnel = resource.data?.resumen?.funnel;
  return (
    <AdminPanel
      title="Presupuestos en juego"
      icon="budgets"
      action={
        <Link className="admin-panel-link" href="/presupuestos">
          Ver presupuestos →
        </Link>
      }
    >
      <BoardBody resource={resource} height={260}>
        {({ budgets }) => {
          const stages = funnel
            ? [
                { key: "leads", label: "Leads", count: funnel.leads, href: "/leads", from: null as number | null },
                { key: "budgets", label: "Presupuestos", count: funnel.budgets.count, href: "/presupuestos", from: funnel.leads },
                { key: "approved", label: "Aprobados", count: funnel.approved.count, href: "/presupuestos?estado=APPROVED", from: funnel.budgets.count },
                { key: "events", label: "Eventos", count: funnel.events, href: "/eventos", from: funnel.approved.count },
              ]
            : [];
          return (
            <>
              {budgets.count === 0 ? (
                <p className="admin-board-headline">Sin presupuestos enviados ni en negociación.</p>
              ) : (
                <>
                  <p className="admin-board-headline" title={formatMoney(budgets.amount)}>
                    <strong>{formatMoneyCompact(budgets.amount)}</strong> en {formatNumber(budgets.count)} {budgets.count === 1 ? "presupuesto" : "presupuestos"}
                    {budgets.oldestDays !== null ? ` · el más viejo, ${ageText(budgets.oldestDays)}` : ""}
                  </p>
                  <ul className="admin-budget-split">
                    {budgets.byStatus.map((row) => (
                      <li key={row.status}>
                        <Link href={`/presupuestos?estado=${row.status}`} title={`Ver los presupuestos ${STATUS_LABEL[row.status].toLowerCase()}s`}>
                          <span>{STATUS_LABEL[row.status]}</span>
                          <strong>{formatMoneyCompact(row.amount)}</strong>
                          <small>{formatNumber(row.count)}</small>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <h3 className="admin-board-sub">Los {Math.min(5, budgets.top.length)} de mayor monto</h3>
                  <ol className="admin-budget-top">
                    {budgets.top.map((budget) => (
                      <li key={budget.id}>
                        <Link className="admin-budget-top-row" href={`/presupuestos?detalle=${encodeURIComponent(budget.id)}`} title={`${budget.title} · ${budget.client} · ${formatMoney(budget.amount)}`}>
                          <span className="admin-budget-top-text">
                            <strong>{budget.title}</strong>
                            <small>
                              {budget.client} · {ageText(budget.ageDays)}
                            </small>
                          </span>
                          <AdminBadge tone={budget.status === "NEGOTIATING" ? "warn" : "info"}>{STATUS_LABEL[budget.status]}</AdminBadge>
                          <span className="admin-budget-top-amount">{formatMoneyCompact(budget.amount)}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {funnel ? (
                <>
                  <h3 className="admin-board-sub">Embudo de {formatMonthKey(resource.data?.resumen?.month)}</h3>
                  <ChartBarList
                    label="Embudo del mes: leads, presupuestos, aprobados y eventos"
                    items={stages.map((stage) => {
                      const rate = stage.from === null ? null : conversionRate(stage.from, stage.count);
                      return {
                        key: stage.key,
                        label: stage.label,
                        value: stage.count,
                        valueLabel: formatNumber(stage.count),
                        detail: rate === null ? undefined : `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(rate)} % de la etapa anterior`,
                        tone: "accent" as const,
                        href: stage.href,
                        title: `${stage.label} del mes. Es la relación entre cantidades del mes, no el seguimiento de cada lead. Ver la lista`,
                      };
                    })}
                  />
                </>
              ) : null}
            </>
          );
        }}
      </BoardBody>
    </AdminPanel>
  );
}

// ── 4. Tendencia de 6 meses ─────────────────────────────────────────────────

export function TrendBlock({ resource }: { resource: Resource }) {
  return (
    <AdminPanel title="Tendencia de 6 meses" icon="finance" meta="venta aprobada y cobrado">
      <BoardBody resource={resource}>
        {({ trend }) => {
          if (trend.every((month) => month.sales === 0 && month.collected === 0)) {
            return <AdminEmpty icon="finance" title="Sin ventas ni cobros" hint="Cuando apruebes presupuestos y confirmes cobros, acá ves cómo evolucionan mes a mes." />;
          }
          const current = trend[trend.length - 1];
          return (
            <>
              <ChartBars
                caption="Venta aprobada y cobrado por mes, últimos 6 meses"
                mode="grouped"
                categories={trend.map((month) => ({ key: month.month, label: monthLabel(month.month), title: `${formatMonthKey(month.month)}${month.current ? " (mes en curso)" : ""}`, current: month.current }))}
                series={[
                  { key: "sales", label: "Venta aprobada", tone: "accent", values: trend.map((month) => month.sales) },
                  { key: "collected", label: "Cobrado", tone: "ok", values: trend.map((month) => month.collected) },
                ]}
              />
              <p className="admin-board-note">
                {capitalize(formatMonthKey(current.month))} (en curso): venta aprobada {formatMoneyCompact(current.sales)}, cobrado {formatMoneyCompact(current.collected)}. La venta cuenta por fecha de aprobación; lo cobrado, por fecha de cobro.
              </p>
            </>
          );
        }}
      </BoardBody>
    </AdminPanel>
  );
}

// ── 5. Operación ────────────────────────────────────────────────────────────

export function OperationBlock({ resource }: { resource: Resource }) {
  return (
    <AdminPanel
      title="Operación"
      icon="calendar"
      action={
        <Link className="admin-panel-link" href="/inventario">
          Ver inventario →
        </Link>
      }
    >
      <BoardBody resource={resource} height={260}>
        {({ events, occupancy }) => {
          const hasEvents = events.some((week) => week.count > 0);
          return (
            <>
              <h3 className="admin-board-sub">Eventos por semana</h3>
              {hasEvents ? (
                <ChartBars
                  caption="Eventos que arrancan en cada una de las próximas 4 semanas"
                  unit="count"
                  height={150}
                  categories={events.map((week, index) => ({ key: week.start, label: index === 0 ? "Esta semana" : dayMonth(week.start), title: weekRange(week.start) }))}
                  series={[{ key: "events", label: "Eventos", tone: "accent", values: events.map((week) => week.count) }]}
                />
              ) : (
                <p className="admin-board-empty">Sin eventos en las próximas 4 semanas.</p>
              )}
              <h3 className="admin-board-sub">Ocupación del inventario esta semana</h3>
              {occupancy.percent === null ? (
                <p className="admin-board-empty">Todavía no hay productos alquilables cargados en Inventario.</p>
              ) : (
                <>
                  <p className="admin-board-headline" title="Días-unidad comprometidos sobre disponibles, con la misma regla del motor de alquileres">
                    <strong>{new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(occupancy.percent)} %</strong> de {formatNumber(occupancy.items)} {occupancy.items === 1 ? "producto" : "productos"} comprometido
                  </p>
                  {occupancy.top.length === 0 ? (
                    <p className="admin-board-empty">Ningún producto tiene reservas esta semana.</p>
                  ) : (
                    <ChartBarList
                      label="Productos más ocupados esta semana"
                      max={100}
                      items={occupancy.top.map((row) => ({
                        key: row.id,
                        label: row.name,
                        value: row.percent,
                        valueLabel: `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(row.percent)} %`,
                        tone: row.percent >= 90 ? ("danger" as const) : row.percent >= 70 ? ("warn" as const) : ("accent" as const),
                        title: `${row.name}: ${row.committedDays} de ${row.availableDays} días-unidad`,
                      }))}
                    />
                  )}
                  {occupancy.truncated ? <p className="admin-board-note">Hay más reservas que el tope de cálculo: el porcentaje puede estar subestimado.</p> : null}
                </>
              )}
            </>
          );
        }}
      </BoardBody>
    </AdminPanel>
  );
}

