import type { AdminNavCounts, AdminResumen, AdminResumenWeekEvent } from "@/lib/admin-types";
import { db } from "./db";
import { clientLabel, DAY_MS, dayKeyOf, dayStart, placeLabel, shiftDayKey } from "./notifications";

/**
 * Datos del Resumen y del menú que no salen de los listados. Todo es `count` o
 * `sum` de la empresa activa (nunca se mezclan organizaciones) y cada cifra se
 * deriva de filas reales; sin filas el resultado es 0, nunca un número inventado.
 */

/** Ventana de «esta semana» del menú y del Resumen: hoy y los 6 días siguientes. */
export const WEEK_DAYS = 7;
/** Un cheque anulado cuenta como «rechazado» durante este período. */
export const REJECTED_CHEQUE_DAYS = 30;

/** Inicio del mes de Asunción (UTC) que contiene a `now`, y su clave `YYYY-MM`. */
export function monthWindow(now: Date): { key: string; start: Date; end: Date } {
  const today = dayKeyOf(now);
  const key = today.slice(0, 7);
  const [year, month] = key.split("-").map(Number);
  const nextKey = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { key, start: dayStart(`${key}-01`), end: dayStart(`${nextKey}-01`) };
}

/** Desde hoy 00:00 (Asunción) hasta dentro de 7 días: `[start, end)`. */
export function weekWindow(now: Date): { start: Date; end: Date } {
  const todayKey = dayKeyOf(now);
  return { start: dayStart(todayKey), end: dayStart(shiftDayKey(todayKey, WEEK_DAYS)) };
}

/** Cheques anulados en los últimos 30 días (misma regla en el Resumen y en la demo). */
export function rejectedChequeWhere(organizationId: string, now: Date) {
  const since = new Date(now.getTime() - REJECTED_CHEQUE_DAYS * DAY_MS);
  return {
    organizationId,
    status: "CANCELLED" as const,
    method: { contains: "cheque", mode: "insensitive" as const },
    OR: [{ chequeDate: { gte: since } }, { chequeDate: null, createdAt: { gte: since } }],
  };
}

/** Contadores de Ventas del menú: tres `count` baratos. */
export async function getNavCounts(organizationId: string, now = new Date()): Promise<AdminNavCounts> {
  const week = weekWindow(now);
  const [leads, budgets, events] = await Promise.all([
    db.lead.count({ where: { organizationId, status: "NEW" } }),
    db.budget.count({ where: { organizationId, status: { in: ["SENT", "NEGOTIATING"] } } }),
    db.event.count({
      where: { organizationId, status: { notIn: ["CANCELLED", "COMPLETED"] }, startsAt: { gte: week.start, lt: week.end } },
    }),
  ]);
  return { leads, budgets, events };
}

/** Embudo del mes, plata, atención de hoy y agenda de la semana. */
export async function getResumen(organizationId: string, now = new Date()): Promise<AdminResumen> {
  const month = monthWindow(now);
  const week = weekWindow(now);
  const todayStart = dayStart(dayKeyOf(now));

  const [
    leadsMonth,
    budgetsMonth,
    approvedMonth,
    eventsMonth,
    receivableBudgets,
    pendingStandalone,
    overdue,
    collected,
    newLeads,
    oldestLead,
    rejectedCheques,
    proofs,
    weekEvents,
  ] = await Promise.all([
    db.lead.count({ where: { organizationId, createdAt: { gte: month.start, lt: month.end } } }),
    db.budget.aggregate({
      where: { organizationId, createdAt: { gte: month.start, lt: month.end }, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.budget.aggregate({
      where: { organizationId, status: "APPROVED", approvedAt: { gte: month.start, lt: month.end } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.event.count({
      where: { organizationId, status: { not: "CANCELLED" }, startsAt: { gte: month.start, lt: month.end } },
    }),
    // Por cobrar = saldo de los presupuestos aprobados (solo cuenta lo cobrado de
    // verdad, issue #16) + cobros a plazo pendientes que no cuelgan de un presupuesto.
    db.budget.findMany({
      where: { organizationId, status: "APPROVED" },
      select: { total: true, payments: { where: { status: "RECEIVED" }, select: { amount: true } } },
    }),
    db.clientPayment.aggregate({
      where: { organizationId, status: "PENDING", budgetId: null },
      _sum: { amount: true },
    }),
    db.clientPayment.aggregate({
      where: { organizationId, status: "PENDING", dueAt: { lt: todayStart } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.clientPayment.aggregate({
      where: {
        organizationId,
        status: "RECEIVED",
        OR: [
          { collectedAt: { gte: month.start, lt: month.end } },
          { collectedAt: null, paidAt: { gte: month.start, lt: month.end } },
        ],
      },
      _sum: { amount: true },
    }),
    db.lead.count({ where: { organizationId, status: "NEW" } }),
    db.lead.findFirst({ where: { organizationId, status: "NEW" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.clientPayment.count({ where: rejectedChequeWhere(organizationId, now) }),
    db.expectedPayment.aggregate({
      where: { organizationId, status: "PROOF" },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.event.findMany({
      where: { organizationId, status: { notIn: ["CANCELLED", "COMPLETED"] }, startsAt: { gte: week.start, lt: week.end } },
      orderBy: { startsAt: "asc" },
      take: 8,
      select: {
        id: true,
        name: true,
        startsAt: true,
        location: true,
        city: true,
        client: { select: { name: true, company: true } },
        tasks: { select: { completedAt: true } },
        budgets: {
          where: { status: "APPROVED", advanceAmount: { gt: 0 } },
          select: { advanceAmount: true, payments: { where: { status: "RECEIVED" }, select: { amount: true } } },
        },
      },
    }),
  ]);

  const receivable =
    receivableBudgets.reduce(
      (sum, budget) => sum + Math.max(0, budget.total - budget.payments.reduce((paid, payment) => paid + payment.amount, 0)),
      0,
    ) + (pendingStandalone._sum.amount ?? 0);

  const weekRows: AdminResumenWeekEvent[] = weekEvents.map((event) => ({
    id: event.id,
    name: event.name,
    startsAt: event.startsAt ? event.startsAt.toISOString() : null,
    client: clientLabel(event.client),
    place: placeLabel(event.location, event.city),
    tasksTotal: event.tasks.length,
    tasksDone: event.tasks.filter((task) => task.completedAt).length,
    depositPending: event.budgets.reduce((sum, budget) => {
      const paid = budget.payments.reduce((acc, payment) => acc + payment.amount, 0);
      return sum + Math.max(0, budget.advanceAmount - paid);
    }, 0),
  }));

  return {
    month: month.key,
    funnel: {
      leads: leadsMonth,
      budgets: { count: budgetsMonth._count._all, amount: budgetsMonth._sum.total ?? 0 },
      approved: { count: approvedMonth._count._all, amount: approvedMonth._sum.total ?? 0 },
      events: eventsMonth,
    },
    money: {
      receivable,
      overdueAmount: overdue._sum.amount ?? 0,
      overdueCount: overdue._count._all,
      collectedMonth: collected._sum.amount ?? 0,
    },
    attention: {
      newLeads,
      oldestLeadDay: oldestLead ? dayKeyOf(oldestLead.createdAt) : null,
      rejectedCheques,
      proofsToConfirm: proofs._count._all,
      proofsAmount: proofs._sum.amount ?? 0,
    },
    week: weekRows,
  };
}
