import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { asuncionDayKey, type PeriodRange } from "@/lib/platform/periods";

/**
 * Agregación común de las consultas de plataforma. Cada métrica define una base con las
 * columnas `ts` (instante UTC sin zona), `d` (día de Paraguay `YYYY-MM-DD`), `k` (clave
 * a contar sin repetir), `amt` (monto PYG) y `del` (¿está en la papelera?). Acá se agrupa:
 * nunca salen filas sueltas, solo conteos y sumas por período y por día.
 */

const TZ = "America/Asuncion";

/** Fecha JS como `timestamp` UTC sin zona (las columnas de Prisma guardan UTC). */
export function utc(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Instante UTC sin zona → hora local de Paraguay (`timestamp`). `column` es una expresión fija del código. */
export function localTs(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${Prisma.raw(`'${TZ}'`)})`;
}

/** Día de Paraguay `YYYY-MM-DD` de una columna de instante UTC. */
export function localDayText(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`to_char(${localTs(column)}::date, 'YYYY-MM-DD')`;
}

/** Hora (0–23) de Paraguay de una columna de instante UTC. */
export function localHour(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXTRACT(HOUR FROM ${localTs(column)})::int`;
}

/** Condición `column` ∈ [anterior.inicio, fin) para una columna de instante UTC. */
export function inWindow(column: Prisma.Sql, range: PeriodRange): Prisma.Sql {
  return Prisma.sql`${column} >= ${utc(range.prevStart)} AND ${column} < ${utc(range.end)}`;
}

/** Límites de día (`YYYY-MM-DD`) de la ventana anterior+actual, para columnas `DATE`. */
export function dayWindow(range: PeriodRange): { first: string; endExclusive: string } {
  return { first: range.prevDays[0], endExclusive: asuncionDayKey(range.end) };
}

export type MetricResult = {
  n: number;
  nPrev: number;
  /** En papelera (no entra en `n`). */
  nDel: number;
  nDelPrev: number;
  amt: number;
  amtPrev: number;
  /** Parte de `amt` que está eliminada. */
  amtDel: number;
  amtDelPrev: number;
  /** Serie diaria del período actual y del anterior (alineadas por posición). */
  series: number[];
  prevSeries: number[];
};

export const EMPTY_METRIC = (days: number): MetricResult => ({
  n: 0, nPrev: 0, nDel: 0, nDelPrev: 0, amt: 0, amtPrev: 0, amtDel: 0, amtDelPrev: 0,
  series: Array.from({ length: days }, () => 0),
  prevSeries: Array.from({ length: days }, () => 0),
});

type TotalsRow = { cur: boolean; n: number; n_del: number; amt: number; amt_del: number };
type SeriesRow = { d: string; cur: boolean; n: number; amt: number };

/**
 * Corre una métrica. `base` ya filtra por ventana, empresa real y demás; acá solo se
 * agrupa por período (`ts >= inicio`) y por día. `seriesBy` elige qué dibuja el sparkline.
 */
export async function runMetric(base: Prisma.Sql, range: PeriodRange, seriesBy: "n" | "amt" = "n"): Promise<MetricResult> {
  const start = utc(range.start);
  const [totals, series] = await Promise.all([
    db.$queryRaw<TotalsRow[]>(Prisma.sql`
      SELECT t."cur" AS cur,
             (COUNT(DISTINCT t."k") FILTER (WHERE NOT t."del"))::int AS n,
             (COUNT(DISTINCT t."k") FILTER (WHERE t."del"))::int AS n_del,
             COALESCE(SUM(t."amt"), 0)::float8 AS amt,
             COALESCE(SUM(t."amt") FILTER (WHERE t."del"), 0)::float8 AS amt_del
      FROM (SELECT x.*, (x."ts" >= ${start}) AS cur FROM (${base}) x) t
      GROUP BY t."cur"`),
    db.$queryRaw<SeriesRow[]>(Prisma.sql`
      SELECT t."d" AS d, t."cur" AS cur,
             (COUNT(DISTINCT t."k") FILTER (WHERE NOT t."del"))::int AS n,
             COALESCE(SUM(t."amt"), 0)::float8 AS amt
      FROM (SELECT x.*, (x."ts" >= ${start}) AS cur FROM (${base}) x) t
      GROUP BY t."d", t."cur"`),
  ]);
  const result = EMPTY_METRIC(range.days.length);
  for (const row of totals) {
    if (row.cur) {
      result.n = row.n; result.nDel = row.n_del; result.amt = row.amt; result.amtDel = row.amt_del;
    } else {
      result.nPrev = row.n; result.nDelPrev = row.n_del; result.amtPrev = row.amt; result.amtDelPrev = row.amt_del;
    }
  }
  const curIndex = new Map(range.days.map((day, index) => [day, index]));
  const prevIndex = new Map(range.prevDays.map((day, index) => [day, index]));
  for (const row of series) {
    const value = seriesBy === "amt" ? row.amt : row.n;
    if (row.cur) {
      const i = curIndex.get(row.d);
      if (i !== undefined) result.series[i] = value;
    } else {
      const i = prevIndex.get(row.d);
      if (i !== undefined) result.prevSeries[i] = value;
    }
  }
  return result;
}
