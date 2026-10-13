import {
  ageInDays,
  buildEventWeeks,
  buildForecast,
  buildTrend,
  bucketAging,
  lastMonthKeys,
  type AdminResumenBoard,
  type AgingRow,
  type ForecastCategory,
  type ForecastRow,
  type MonthAmountRow,
} from "@/lib/resumen-board";
import { db } from "./db";
import { clientLabel, dayKeyOf, dayStart, shiftDayKey } from "./notifications";
import { getOccupancyWindow } from "./rental-report";
import { monthWindow, parseBalance, weekWindow } from "./resumen";

/**
 * Tablero gráfico del Resumen. Todo se agrega en la base (`GROUP BY` / `aggregate`)
 * y cada consulta lleva `organizationId` parametrizado; nunca se traen tablas
 * enteras. Las fechas viajan como texto UTC sin zona porque las columnas son
 * `timestamp` sin zona (Prisma guarda UTC).
 */

const FORECAST_DAYS = 90;
const EVENT_WEEKS = 4;
const TREND_MONTHS = 6;
const TOP_BUDGETS = 5;
/** Asunción es UTC-3 fijo (misma convención que `dayStart`). */
const ZONE_SHIFT = "3 hours";

const sqlTime = (date: Date) => date.toISOString().slice(0, 19);
const num = (value: bigint | number | string | null | undefined) => parseBalance(value);

type RawForecast = { category: string; offset: number | string; amount: bigint | number | string | null; count: number | string };
type RawAging = { lateDays: number | string; amount: bigint | number | string | null; count: number | string };
type RawMonth = { month: string; amount: bigint | number | string | null; count: number | string };
type RawWeek = { week: number | string; count: number | string };

export async function getResumenBoard(organizationId: string, now = new Date()): Promise<AdminResumenBoard> {
  const todayKey = dayKeyOf(now);
  const todayStart = dayStart(todayKey);
  const today = sqlTime(todayStart);
  const horizon = sqlTime(dayStart(shiftDayKey(todayKey, FORECAST_DAYS)));
  const eventsEnd = sqlTime(dayStart(shiftDayKey(todayKey, EVENT_WEEKS * 7)));
  const monthKeys = lastMonthKeys(todayKey, TREND_MONTHS);
  const trendFrom = sqlTime(monthWindow(new Date(`${monthKeys[0]}-15T12:00:00Z`)).start);
  const trendTo = sqlTime(monthWindow(now).end);

  const [forecastRows, undated, agingRows, openGroups, topBudgets, salesRows, collectedRows, eventRows, occupancy] = await Promise.all([
    db.$queryRaw<RawForecast[]>`
      SELECT (CASE WHEN "status" = 'PROOF' THEN 'proof' WHEN "dueAt" < ${today}::timestamp THEN 'overdue' ELSE 'pending' END) AS "category",
             FLOOR(EXTRACT(EPOCH FROM ("dueAt" - ${today}::timestamp)) / 86400)::int AS "offset",
             COALESCE(SUM(GREATEST("amount" - "paidAmount", 0)), 0)::bigint AS "amount",
             COUNT(*)::int AS "count"
      FROM "ExpectedPayment"
      WHERE "organizationId" = ${organizationId}
        AND "status" IN ('AWAITING', 'PROOF', 'PARTIAL')
        AND "dueAt" IS NOT NULL AND "dueAt" < ${horizon}::timestamp
      GROUP BY 1, 2
    `,
    db.$queryRaw<Array<{ amount: bigint | number | string | null; count: number | string }>>`
      SELECT COALESCE(SUM(GREATEST("amount" - "paidAmount", 0)), 0)::bigint AS "amount", COUNT(*)::int AS "count"
      FROM "ExpectedPayment"
      WHERE "organizationId" = ${organizationId} AND "status" IN ('AWAITING', 'PROOF', 'PARTIAL') AND "dueAt" IS NULL
    `,
    db.$queryRaw<RawAging[]>`
      SELECT (CASE WHEN "dueAt" IS NULL THEN 0 ELSE CEIL(EXTRACT(EPOCH FROM (${today}::timestamp - "dueAt")) / 86400) END)::int AS "lateDays",
             COALESCE(SUM("amount"), 0)::bigint AS "amount", COUNT(*)::int AS "count"
      FROM "ClientPayment"
      WHERE "organizationId" = ${organizationId} AND "status" = 'PENDING'
      GROUP BY 1
    `,
    db.budget.groupBy({
      by: ["status"],
      where: { organizationId, status: { in: ["SENT", "NEGOTIATING"] } },
      _count: { _all: true },
      _sum: { total: true },
      _min: { createdAt: true },
    }),
    db.budget.findMany({
      where: { organizationId, status: { in: ["SENT", "NEGOTIATING"] } },
      orderBy: [{ total: "desc" }, { createdAt: "asc" }],
      take: TOP_BUDGETS,
      select: { id: true, title: true, status: true, total: true, createdAt: true, client: { select: { name: true, company: true } } },
    }),
    db.$queryRaw<RawMonth[]>`
      SELECT to_char(date_trunc('month', "approvedAt" - ${ZONE_SHIFT}::interval), 'YYYY-MM') AS "month",
             COALESCE(SUM("total"), 0)::bigint AS "amount", COUNT(*)::int AS "count"
      FROM "Budget"
      -- Papelera: un presupuesto APPROVED no se puede eliminar, por eso no filtra deletedAt.
      WHERE "organizationId" = ${organizationId} AND "status" = 'APPROVED'
        AND "approvedAt" >= ${trendFrom}::timestamp AND "approvedAt" < ${trendTo}::timestamp
      GROUP BY 1
    `,
    db.$queryRaw<RawMonth[]>`
      SELECT to_char(date_trunc('month', COALESCE("collectedAt", "paidAt") - ${ZONE_SHIFT}::interval), 'YYYY-MM') AS "month",
             COALESCE(SUM("amount"), 0)::bigint AS "amount", COUNT(*)::int AS "count"
      FROM "ClientPayment"
      WHERE "organizationId" = ${organizationId} AND "status" = 'RECEIVED'
        AND COALESCE("collectedAt", "paidAt") >= ${trendFrom}::timestamp AND COALESCE("collectedAt", "paidAt") < ${trendTo}::timestamp
      GROUP BY 1
    `,
    db.$queryRaw<RawWeek[]>`
      SELECT FLOOR(EXTRACT(EPOCH FROM ("startsAt" - ${today}::timestamp)) / 604800)::int AS "week", COUNT(*)::int AS "count"
      FROM "Event"
      WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND "status" NOT IN ('CANCELLED', 'COMPLETED')
        AND "startsAt" >= ${today}::timestamp AND "startsAt" < ${eventsEnd}::timestamp
      GROUP BY 1
    `,
    getOccupancyWindow(organizationId, weekWindow(now), now, 5),
  ]);

  const forecast = buildForecast(
    forecastRows.map((row): ForecastRow => ({
      category: row.category as ForecastCategory,
      offset: Number(row.offset),
      amount: num(row.amount),
      count: Number(row.count),
    })),
    todayKey,
    { count: Number(undated[0]?.count ?? 0), amount: num(undated[0]?.amount) },
  );

  const aging = bucketAging(
    agingRows.map((row): AgingRow => ({ lateDays: Number(row.lateDays), amount: num(row.amount), count: Number(row.count) })),
  );

  const byStatus = (["SENT", "NEGOTIATING"] as const).map((status) => {
    const group = openGroups.find((row) => row.status === status);
    return {
      status,
      count: group?._count._all ?? 0,
      amount: group?._sum.total ?? 0,
      oldestDays: group?._min.createdAt ? ageInDays(group._min.createdAt, now) : null,
    };
  });
  const oldest = byStatus.map((row) => row.oldestDays).filter((value): value is number => value !== null);

  const monthRows = (rows: RawMonth[]): MonthAmountRow[] => rows.map((row) => ({ month: row.month, amount: num(row.amount), count: Number(row.count) }));

  return {
    today: todayKey,
    forecast,
    aging,
    budgets: {
      count: byStatus.reduce((sum, row) => sum + row.count, 0),
      amount: byStatus.reduce((sum, row) => sum + row.amount, 0),
      oldestDays: oldest.length ? Math.max(...oldest) : null,
      byStatus,
      top: topBudgets.map((budget) => ({
        id: budget.id,
        title: budget.title,
        client: clientLabel(budget.client),
        status: budget.status as "SENT" | "NEGOTIATING",
        amount: budget.total,
        ageDays: ageInDays(budget.createdAt, now),
      })),
    },
    trend: buildTrend(monthKeys, monthRows(salesRows), monthRows(collectedRows)),
    events: buildEventWeeks(
      eventRows.map((row) => ({ week: Number(row.week), count: Number(row.count) })),
      todayKey,
      EVENT_WEEKS,
    ),
    occupancy: {
      percent: occupancy.percent,
      items: occupancy.items,
      truncated: occupancy.truncated,
      top: occupancy.top.map((row) => ({ id: row.id, name: row.name, percent: row.percent, committedDays: row.committedDays, availableDays: row.availableDays })),
    },
  };
}
