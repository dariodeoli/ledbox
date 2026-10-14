import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { computeDelta, type Delta, type PeriodRange } from "@/lib/platform/periods";
import { dayWindow, inWindow, localDayText, localHour, runMetric, utc, type MetricResult } from "@/lib/platform/aggregate";
import { orgReal, usuarioReal } from "@/lib/platform/sin-demo";

/**
 * Actividad de plataforma: por día (usuarios activos, logins, acciones) con el período
 * anterior, y por hora 0–23 en hora de Paraguay. Solo agregados; sin la demo.
 */

export type DaySeries = {
  key: "usuarios" | "logins" | "acciones";
  label: string;
  total: number;
  previous: number;
  delta: Delta;
  values: number[];
  prevValues: number[];
  note: string;
  empty: string | null;
};

export type ActividadData = {
  /** Días del período (`YYYY-MM-DD`), alineados con `values`. */
  days: string[];
  prevDays: string[];
  series: DaySeries[];
  /** 24 valores (hora 0–23 de Paraguay) de usuarios activos y de acciones. */
  hoursUsers: number[];
  hoursActions: number[];
  hasUserData: boolean;
};

const NO_DEL = Prisma.sql`false`;
const NO_AMT = Prisma.sql`0::int`;

function toSeries(key: DaySeries["key"], label: string, note: string, m: MetricResult): DaySeries {
  return {
    key,
    label,
    total: m.n,
    previous: m.nPrev,
    delta: computeDelta(m.n, m.nPrev),
    values: m.series,
    prevValues: m.prevSeries,
    note,
    empty: null,
  };
}

function hourArray(rows: Array<{ h: number; n: number }>): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const row of rows) if (row.h >= 0 && row.h < 24) out[row.h] = row.n;
  return out;
}

export async function loadActividad(range: PeriodRange): Promise<ActividadData> {
  const window = dayWindow(range);

  const usuarios = Prisma.sql`
    SELECT ((a."day"::timestamp AT TIME ZONE 'America/Asuncion') AT TIME ZONE 'UTC') AS ts,
           to_char(a."day", 'YYYY-MM-DD') AS d, a."userId" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "AdminActivityDay" a
    WHERE ${usuarioReal("a")} AND a."day" >= ${window.first}::date AND a."day" < ${window.endExclusive}::date`;

  const logins = Prisma.sql`
    SELECT s."createdAt" AS ts, ${localDayText(Prisma.sql`s."createdAt"`)} AS d, s."id" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "AdminSession" s
    WHERE ${usuarioReal("s")} AND ${inWindow(Prisma.sql`s."createdAt"`, range)}`;

  const acciones = Prisma.sql`
    SELECT a."createdAt" AS ts, ${localDayText(Prisma.sql`a."createdAt"`)} AS d, a."id" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "AuditLog" a
    WHERE ${orgReal("a")} AND ${inWindow(Prisma.sql`a."createdAt"`, range)}`;

  const [u, l, a, usersByHour, actionsByHour, anyUser] = await Promise.all([
    runMetric(usuarios, range),
    runMetric(logins, range),
    runMetric(acciones, range),
    // Un bit por hora en `hourMask`: cuántos usuarios estuvieron activos en cada hora.
    db.$queryRaw<Array<{ h: number; n: number }>>(Prisma.sql`
      SELECT h::int AS h, COUNT(*)::int AS n
      FROM generate_series(0, 23) AS h
      JOIN "AdminActivityDay" a ON ((a."hourMask" >> h) & 1) = 1
      WHERE ${usuarioReal("a")} AND a."day" >= ${range.days[0]}::date AND a."day" < ${window.endExclusive}::date
      GROUP BY h`),
    db.$queryRaw<Array<{ h: number; n: number }>>(Prisma.sql`
      SELECT ${localHour(Prisma.sql`a."createdAt"`)} AS h, COUNT(*)::int AS n
      FROM "AuditLog" a
      WHERE ${orgReal("a")} AND a."createdAt" >= ${utc(range.start)} AND a."createdAt" < ${utc(range.end)}
      GROUP BY 1`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "AdminActivityDay" a
      WHERE ${usuarioReal("a")}
      GROUP BY (a."day" IS NOT NULL)`),
  ]);

  const hasUserData = (anyUser[0]?.n ?? 0) > 0;
  const users = toSeries("usuarios", "Usuarios activos", "AdminActivityDay · usuarios distintos por día", u);
  if (!hasUserData) users.empty = "sin datos todavía";
  return {
    days: range.days,
    prevDays: range.prevDays,
    series: [
      users,
      toSeries("logins", "Logins", "AdminSession · sesiones iniciadas por día", l),
      toSeries("acciones", "Acciones", "AuditLog · acciones registradas por día", a),
    ],
    hoursUsers: hourArray(usersByHour),
    hoursActions: hourArray(actionsByHour),
    hasUserData,
  };
}
