"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  budgetStatusLabel,
  checklistProgress,
  eventStatusLabel,
  formatCalendarDayShort,
  formatDateShort,
  formatDateTime,
  formatDayWhen,
  formatMoney,
  formatNumber,
  formatTime,
  isOverdue,
  isUpcomingWithin,
  jobStatusLabel,
  notificationKindLabel,
  notificationLevelLabel,
  notificationTone,
  statusTone,
} from "@/lib/admin-format";
import { adminNavLabel, canWriteOperations } from "@/lib/admin-policy";
import { collectedAmount, supplierJobBalance, type AdminEventChecklistRow, type AdminEventTask, type AdminOverview } from "@/lib/admin-types";
import { useAdminNotifications, useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminErrorState,
  AdminKpi,
  AdminLoadingRows,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
} from "../AdminUI";
import { useAdminResource } from "@/lib/admin-api";
import { ChecklistTable, type ChecklistEntry } from "./Checklist";

export function ResumenModule() {
  const { role } = useAdminSession();
  const overview = useAdminResource<AdminOverview | null>("/api/admin/overview", (payload) =>
    payload.counts && payload.finance ? { counts: payload.counts, finance: payload.finance, upcoming: payload.upcoming ?? [] } : null,
  );
  const operations = useAdminResource(
    "/api/admin/event-ops?fields=checklist",
    (payload) => (payload as { events?: AdminEventChecklistRow[] }).events ?? [],
  );
  const budgets = useAdminResource("/api/admin/budgets", (payload) => payload.budgets ?? []);
  const finance = useAdminResource("/api/admin/finance", (payload) => ({
    payments: payload.clientPayments ?? [],
    jobs: payload.supplierJobs ?? [],
  }));
  const notifications = useAdminNotifications();
  const [checklistError, setChecklistError] = useState("");

  const canToggle = canWriteOperations(role);

  const pendingTasks = useMemo<ChecklistEntry[]>(
    () =>
      (operations.data ?? [])
        .flatMap((event) => event.tasks.filter((task) => !task.completedAt).map((task) => ({ task, eventName: event.name })))
        .sort((a, b) => (a.task.dueAt ?? "9999").localeCompare(b.task.dueAt ?? "9999"))
        .slice(0, 6),
    [operations.data],
  );

  /** Tareas vencidas de todos los eventos: el checklist real, no el ideal. */
  const overdueTasks = useMemo<Array<{ task: AdminEventTask; eventName: string }>>(
    () =>
      (operations.data ?? [])
        .flatMap((event) => event.tasks.filter((task) => !task.completedAt && isOverdue(task.dueAt)).map((task) => ({ task, eventName: event.name })))
        .sort((a, b) => (a.task.dueAt ?? "9999").localeCompare(b.task.dueAt ?? "9999")),
    [operations.data],
  );

  const pendingTotal = useMemo(
    () => (operations.data ?? []).flatMap((event) => event.tasks).filter((task) => !task.completedAt).length,
    [operations.data],
  );

  const receivables = useMemo(
    () =>
      (budgets.data ?? [])
        // Un presupuesto perdido o cancelado no es cobrable: no entra en "por cobrar".
        .filter((budget) => budget.status !== "LOST" && budget.status !== "CANCELLED")
        // Solo los cobros marcados como cobrados descuentan saldo (issue #16):
        // un cobro a plazo pendiente o anulado todavía no es plata cobrada.
        .map((budget) => ({ budget, paid: collectedAmount(budget.payments) }))
        .map((row) => ({ ...row, balance: row.budget.total - row.paid }))
        .filter((row) => row.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 6),
    [budgets.data],
  );

  const payables = useMemo(
    () =>
      (finance.data?.jobs ?? [])
        .map((job) => ({ job, balance: supplierJobBalance(job) }))
        .filter((row) => row.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 6),
    [finance.data],
  );

  const reloadChecklist = useCallback(() => {
    setChecklistError("");
    operations.reload();
  }, [operations.reload]);

  // Avisos operativos (issue #10): los 5 principales ya vienen ordenados por urgencia.
  const todayNotifications = useMemo(() => (notifications.data?.notifications ?? []).slice(0, 5), [notifications.data]);
  const notificationCounts = notifications.data?.notificationCounts;

  const counts = overview.data?.counts;
  const totals = overview.data?.finance;

  return (
    <div className="admin-module-page">
      <div className="admin-panel-grid">
        <div className="admin-panel-wide">
          <AdminPanel
            title="Qué mirar hoy" icon="bell"
            meta={notificationCounts && notificationCounts.total > 0 ? `${formatNumber(notificationCounts.total)} avisos` : undefined}
            action={
              <Link className="admin-panel-link" href="/eventos?vista=calendario" title="El calendario es una vista de Eventos">
                Ver calendario →
              </Link>
            }
          >
            <AdminDataState
              loading={notifications.loading}
              error={notifications.error}
              onRetry={notifications.reload}
              empty={todayNotifications.length === 0}
              emptyTitle="Nada urgente" emptyIcon="check"
              emptyHint="No hay vencimientos, checklist pendiente ni cobros con saldo para mirar hoy."
              rows={3}
            >
              <AdminTable
                view="resumen-avisos"
                label="Qué mirar hoy"
                columns={[{ label: "Nivel" }, { label: "Aviso" }, { label: "Módulo" }, { label: "Fecha", end: true }]}
              >
                {todayNotifications.map((notification) => (
                  <AdminRow key={notification.id}>
                    <AdminCell>
                      <AdminBadge tone={notificationTone(notification.level)}>{notificationLevelLabel(notification.level)}</AdminBadge>
                    </AdminCell>
                    <AdminCell
                      title={`${notificationKindLabel(notification.kind)}: ${notification.title}${notification.subtitle ? ` · ${notification.subtitle}` : ""}`}
                    >
                      <strong>{notification.title}</strong>
                      {notification.subtitle ? <small className="admin-cell-sub"> · {notification.subtitle}</small> : null}
                    </AdminCell>
                    <AdminCell title={`Ir a ${adminNavLabel(notification.href)}`}>
                      <Link className="admin-panel-link" href={notification.href}>
                        {adminNavLabel(notification.href)} →
                      </Link>
                    </AdminCell>
                    <AdminCell end title={formatCalendarDayShort(notification.date)}>
                      <span className="admin-nowrap">
                        {formatCalendarDayShort(notification.date)} · {formatDayWhen(notification.date)}
                      </span>
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            </AdminDataState>
          </AdminPanel>
        </div>
      </div>

      {overview.loading ? (
        <AdminLoadingRows rows={2} label="Cargando indicadores" />
      ) : overview.error ? (
        <AdminErrorState message={overview.error} onRetry={overview.reload} />
      ) : (
        <section className="admin-kpis" aria-label="Indicadores del negocio">
          <AdminKpi label="Clientes activos" icon="clients" value={formatNumber(counts?.clients)} note="en cartera" />
          <AdminKpi label="Eventos" icon="events" value={formatNumber(counts?.events)} note="no cancelados" />
          <AdminKpi label="Presupuestos" icon="budgets" value={formatNumber(counts?.budgets)} note="vigentes" />
          <AdminKpi label="Leads nuevos" icon="leads" value={formatNumber(counts?.leads)} note="por contactar" tone={counts && counts.leads > 0 ? "accent" : undefined} />
          <AdminKpi label="Por cobrar" icon="finance" value={formatMoney(totals?.totalReceivable)} note="ventas aprobadas" tone="ok" />
          <AdminKpi label="Por pagar" icon="suppliers" value={formatMoney(totals?.totalPayable)} note="proveedores" tone="warn" />
          <AdminKpi label="Caja comprometida" icon="wallet" value={formatMoney(totals?.committedCash)} note="cobros y pagos" />
          <AdminKpi label="Inventario" icon="inventory" value={formatNumber(counts?.inventory)} note="ítems controlados" />
        </section>
      )}

      <div className="admin-panel-grid">
        <AdminPanel
          title="Próximos eventos" icon="calendar"
          meta={overview.data ? `${formatNumber(overview.data.upcoming.length)} en agenda` : undefined}
          action={
            <Link className="admin-panel-link" href="/eventos">
              Ver eventos →
            </Link>
          }
        >
          <AdminDataState
            loading={overview.loading}
            error={overview.error}
            onRetry={overview.reload}
            empty={(overview.data?.upcoming.length ?? 0) === 0}
            emptyTitle="Sin eventos en agenda" emptyIcon="calendar"
            emptyHint="Cargá el primer evento para verlo acá con su checklist."
          >
            <AdminTable
              view="resumen-eventos"
              label="Próximos eventos"
              columns={[{ label: "Fecha" }, { label: "Evento" }, { label: "Cliente" }, { label: "Checklist", end: true }, { label: "Estado" }]}
            >
              {(overview.data?.upcoming ?? []).map((event) => {
                const progress = checklistProgress(event.tasks, { risk: isUpcomingWithin(event.startsAt) });
                return (
                  <AdminRow key={event.id}>
                    <AdminCell title={event.startsAt ? `${formatDateTime(event.startsAt)} · ${event.name}` : "Fecha a confirmar"}>
                      {event.startsAt ? `${formatDateShort(event.startsAt)} · ${formatTime(event.startsAt)}` : "A confirmar"}
                      <AdminCountdown value={event.startsAt} short className="admin-countdown--inline" title={`Cuánto falta para el inicio: ${event.name}`} />
                    </AdminCell>
                    <AdminCell title={`${event.name}${event.location ? ` · ${event.location}` : ""}`}>
                      <strong>{event.name}</strong>
                    </AdminCell>
                    <AdminCell title={event.client.company || event.client.name}>{event.client.company || event.client.name}</AdminCell>
                    <AdminCell title={progress.title}>
                      {event.tasks.length === 0 ? (
                        <span className="admin-muted">—</span>
                      ) : (
                        <AdminBadge tone={progress.tone}>{progress.label}</AdminBadge>
                      )}
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={statusTone(event.status)}>{eventStatusLabel(event.status)}</AdminBadge>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          </AdminDataState>
        </AdminPanel>

        <AdminPanel
          title="Checklist pendiente" icon="audit"
          meta={
            pendingTotal > 0
              ? `${formatNumber(pendingTotal)} pendientes${overdueTasks.length > 0 ? ` · ${formatNumber(overdueTasks.length)} vencida${overdueTasks.length === 1 ? "" : "s"}` : ""}`
              : undefined
          }
          action={
            <Link className="admin-panel-link" href="/eventos">
              Ver checklist →
            </Link>
          }
        >
          {checklistError ? <AdminNote tone="error">{checklistError}</AdminNote> : null}
          <AdminDataState
            loading={operations.loading}
            error={operations.error}
            onRetry={operations.reload}
            empty={pendingTasks.length === 0}
            emptyTitle="Checklist al día" emptyIcon="check"
            emptyHint="No quedan tareas pendientes en los eventos cargados."
            rows={4}
          >
            <ChecklistTable
              entries={pendingTasks}
              canToggle={canToggle}
              onChanged={reloadChecklist}
              onError={setChecklistError}
              emptyHint="No quedan tareas pendientes en los eventos cargados."
              compact
            />
          </AdminDataState>
        </AdminPanel>

        <AdminPanel
          title="Tareas vencidas" icon="alert"
          meta={overdueTasks.length > 0 ? `${formatNumber(overdueTasks.length)} sin cerrar` : undefined}
          action={
            <Link className="admin-panel-link" href="/eventos">
              Ver eventos →
            </Link>
          }
        >
          <AdminDataState
            loading={operations.loading}
            error={operations.error}
            onRetry={operations.reload}
            empty={overdueTasks.length === 0}
            emptyTitle="Sin tareas vencidas" emptyIcon="check"
            emptyHint="Ninguna tarea pendiente pasó su fecha de vencimiento."
            rows={3}
          >
            <AdminTable
              view="resumen-vencidas"
              label="Tareas vencidas"
              columns={[{ label: "Tarea" }, { label: "Evento" }, { label: "Vence", end: true }]}
            >
              {overdueTasks.slice(0, 6).map(({ task, eventName }) => (
                <AdminRow key={task.id}>
                  <AdminCell title={task.title}>
                    <strong>{task.title}</strong>
                  </AdminCell>
                  <AdminCell title={eventName}>{eventName}</AdminCell>
                  <AdminCell
                    end
                    title={task.dueAt ? `Venció el ${formatDateTime(task.dueAt)}` : "Sin fecha de vencimiento"}
                  >
                    <span className="admin-nowrap">{formatDateShort(task.dueAt)}</span>
                    <AdminCountdown value={task.dueAt} short className="admin-countdown--inline" title={`Cuánto falta: ${task.title}`} />
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          </AdminDataState>
        </AdminPanel>

        <AdminPanel
          title="Por cobrar" icon="finance"
          meta={receivables.length > 0 ? `${formatNumber(receivables.length)} saldos` : undefined}
          action={
            <Link className="admin-panel-link" href="/presupuestos">
              Ver presupuestos →
            </Link>
          }
        >
          <AdminDataState
            loading={budgets.loading}
            error={budgets.error}
            onRetry={budgets.reload}
            empty={receivables.length === 0}
            emptyTitle="Nada pendiente de cobro" emptyIcon="check"
            emptyHint="Los presupuestos aprobados y enviados aparecen acá con su saldo."
            rows={4}
          >
            <AdminTable
              view="resumen-cobrar"
              label="Saldos por cobrar"
              columns={[
                { label: "Cliente" },
                { label: "Presupuesto" },
                { label: "Saldo", end: true },
                { label: "Estado" },
              ]}
            >
              {receivables.map(({ budget, balance }) => (
                <AdminRow key={budget.id}>
                  <AdminCell title={budget.client.company || budget.client.name}>{budget.client.company || budget.client.name}</AdminCell>
                  <AdminCell title={`${budget.title} · total ${formatMoney(budget.total)}`}>
                    <strong>{budget.title}</strong>
                  </AdminCell>
                  <AdminCell end title={`Saldo ${formatMoney(balance)} · total ${formatMoney(budget.total)}`}>
                    <strong>{formatMoney(balance)}</strong>
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge>
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          </AdminDataState>
        </AdminPanel>

        <AdminPanel
          title="Por pagar" icon="suppliers"
          meta={payables.length > 0 ? `${formatNumber(payables.length)} trabajos` : undefined}
          action={
            <Link className="admin-panel-link" href="/finanzas">
              Ver finanzas →
            </Link>
          }
        >
          <AdminDataState
            loading={finance.loading}
            error={finance.error}
            onRetry={finance.reload}
            empty={payables.length === 0}
            emptyTitle="Sin saldos con proveedores" emptyIcon="check"
            emptyHint="Los trabajos contratados con saldo pendiente aparecen acá."
            rows={4}
          >
            <AdminTable
              view="resumen-pagar"
              label="Saldos por pagar"
              columns={[{ label: "Proveedor" }, { label: "Trabajo" }, { label: "Vence" }, { label: "Saldo", end: true }]}
            >
              {payables.map(({ job, balance }) => (
                <AdminRow key={job.id}>
                  <AdminCell title={job.supplier.name}>
                    <strong>{job.supplier.name}</strong>
                  </AdminCell>
                  <AdminCell title={job.event ? `${job.description} · ${job.event.name}` : job.description}>{job.description}</AdminCell>
                  <AdminCell title={job.dueAt ? `${formatDateTime(job.dueAt)} · ${jobStatusLabel(job.status)}` : "Sin fecha prevista"}>
                    <span className="admin-nowrap">{job.dueAt ? formatDateShort(job.dueAt) : "—"}</span>
                    <AdminCountdown value={job.dueAt} short className="admin-countdown--inline" title={`Vencimiento del trabajo: ${job.description}`} />
                  </AdminCell>
                  <AdminCell end title={`Saldo ${formatMoney(balance)} · total ${formatMoney(job.total)}`}>
                    <strong>{formatMoney(balance)}</strong>
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          </AdminDataState>
        </AdminPanel>
      </div>
    </div>
  );
}
