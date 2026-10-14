import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { publicConfig, hostnameOf } from "@/lib/public-config";
import { asuncionDayKey, asuncionMidnight, computeDelta, type Delta, type PeriodRange } from "@/lib/platform/periods";

/**
 * Consultas agregadas de «Tráfico» (docs/SUPERADMIN.md). Solo servidor, solo lectura.
 * Siempre `GROUP BY`/agregados (nunca filas sueltas), parametrizadas, y los días se agrupan
 * en hora de Paraguay. Los datos de la demo (`DemoSession` y las vistas del host de la demo)
 * se devuelven aparte (`getDemo`), nunca mezclados con las métricas del negocio.
 */

const TZ = "America/Asuncion";
const BOUNCE_UNDER_SEC = 10;

const ts = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const paraguayDay = (column: string) => Prisma.raw(`((${column} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date`);
const inRange = (from: Date, to: Date) => Prisma.sql`"createdAt" >= ${ts(from)} AND "createdAt" < ${ts(to)}`;
/** `host` = solo ese host; `excludeHost` = todos menos ese (la demo va aparte, nunca en los totales del sitio). */
type HostScope = { host?: string; excludeHost?: string };
const hostFilter = (scope?: HostScope) =>
  Prisma.sql`${scope?.host ? Prisma.sql`AND "host" = ${scope.host}` : Prisma.empty} ${scope?.excludeHost ? Prisma.sql`AND "host" <> ${scope.excludeHost}` : Prisma.empty}`;

export function demoHost(): string {
  return hostnameOf(publicConfig.demoUrl);
}

const round1 = (value: number | null) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

export type HostRow = {
  host: string;
  isDemo: boolean;
  views: number;
  viewsPrev: number;
  viewsDelta: Delta;
  /** Visitantes por día sumados (el hash cambia cada día: no se puede deduplicar entre días). */
  visitors: number;
  sessions: number;
  avgSec: number | null;
  medianSec: number | null;
  avgScrollPct: number | null;
  bounceRate: number | null;
};

/** Vistas, visitantes, sesiones, tiempo (promedio y mediana), scroll y rebote por host. */
export async function getTraficoPorHost(range: PeriodRange): Promise<HostRow[]> {
  const rows = await db.$queryRaw<
    Array<{
      host: string;
      views: number;
      visitors: number;
      sessions: number;
      avg_sec: number | null;
      median_sec: number | null;
      avg_scroll: number | null;
      bounced: number | null;
      views_prev: number | null;
    }>
  >(Prisma.sql`
    WITH cur AS (
      SELECT "host", count(*)::int AS views, count(DISTINCT "visitorHash")::int AS visitors, count(DISTINCT "sessionId")::int AS sessions,
             avg("durationSec")::float8 AS avg_sec,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationSec")::float8 AS median_sec,
             avg("scrollPct")::float8 AS avg_scroll
      FROM "WebView" WHERE ${inRange(range.start, range.end)} GROUP BY "host"),
    per_session AS (
      SELECT "host", "sessionId", count(*) AS n, COALESCE(max("durationSec"), 0) AS dur
      FROM "WebView" WHERE ${inRange(range.start, range.end)} GROUP BY "host", "sessionId"),
    bounce AS (
      SELECT "host", (count(*) FILTER (WHERE n = 1 AND dur < ${BOUNCE_UNDER_SEC}))::int AS bounced FROM per_session GROUP BY "host"),
    prev AS (
      SELECT "host", count(*)::int AS views_prev FROM "WebView" WHERE ${inRange(range.prevStart, range.prevEnd)} GROUP BY "host")
    SELECT cur."host", cur.views, cur.visitors, cur.sessions, cur.avg_sec, cur.median_sec, cur.avg_scroll, bounce.bounced, prev.views_prev
    FROM cur LEFT JOIN bounce ON bounce."host" = cur."host" LEFT JOIN prev ON prev."host" = cur."host"
    ORDER BY cur.views DESC, cur."host"`);
  const demo = demoHost();
  return rows.map((row) => ({
    host: row.host,
    isDemo: row.host === demo,
    views: row.views,
    viewsPrev: row.views_prev ?? 0,
    viewsDelta: computeDelta(row.views, row.views_prev ?? 0),
    visitors: row.visitors,
    sessions: row.sessions,
    avgSec: round1(row.avg_sec),
    medianSec: round1(row.median_sec),
    avgScrollPct: round1(row.avg_scroll),
    bounceRate: row.sessions > 0 ? Math.round(((row.bounced ?? 0) / row.sessions) * 1000) / 10 : null,
  }));
}

export type DayPoint = { day: string; views: number; visitors: number };
export type VistasPorDia = { current: DayPoint[]; previous: DayPoint[] };

/** Vistas y visitantes por día de Paraguay (días sin datos = 0) y el período anterior alineado. */
export async function getVistasPorDia(range: PeriodRange, options?: HostScope): Promise<VistasPorDia> {
  const rows = await db.$queryRaw<Array<{ day: string; views: number; visitors: number }>>(Prisma.sql`
    SELECT to_char(${paraguayDay('"createdAt"')}, 'YYYY-MM-DD') AS day, count(*)::int AS views, count(DISTINCT "visitorHash")::int AS visitors
    FROM "WebView" WHERE ${inRange(range.prevStart, range.end)} ${hostFilter(options)}
    GROUP BY 1`);
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const point = (day: string): DayPoint => ({ day, views: byDay.get(day)?.views ?? 0, visitors: byDay.get(day)?.visitors ?? 0 });
  return { current: range.days.map(point), previous: range.prevDays.map(point) };
}

export type PageRow = { host: string; path: string; views: number; avgSec: number | null; avgScrollPct: number | null };

/** Top 10 páginas (por host y path normalizado). */
export async function getTopPaginas(range: PeriodRange, options?: HostScope & { limit?: number }): Promise<PageRow[]> {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 10));
  const rows = await db.$queryRaw<Array<{ host: string; path: string; views: number; avg_sec: number | null; avg_scroll: number | null }>>(Prisma.sql`
    SELECT "host", "path", count(*)::int AS views, avg("durationSec")::float8 AS avg_sec, avg("scrollPct")::float8 AS avg_scroll
    FROM "WebView" WHERE ${inRange(range.start, range.end)} ${hostFilter(options)}
    GROUP BY "host", "path" ORDER BY views DESC, "host", "path" LIMIT ${limit}`);
  return rows.map((r) => ({ host: r.host, path: r.path, views: r.views, avgSec: round1(r.avg_sec), avgScrollPct: round1(r.avg_scroll) }));
}

export type ReferrerRow = { referrerHost: string; views: number };
export type Referrers = { top: ReferrerRow[]; directViews: number; totalViews: number };

/** Top referrers (solo dominio) y las vistas directas (sin referrer o de la misma web). */
export async function getTopReferrers(range: PeriodRange, options?: HostScope & { limit?: number }): Promise<Referrers> {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 10));
  const top = await db.$queryRaw<Array<{ referrer_host: string; views: number }>>(Prisma.sql`
    SELECT "referrerHost" AS referrer_host, count(*)::int AS views
    FROM "WebView" WHERE ${inRange(range.start, range.end)} AND "referrerHost" IS NOT NULL ${hostFilter(options)}
    GROUP BY 1 ORDER BY views DESC, 1 LIMIT ${limit}`);
  const totals = await db.$queryRaw<Array<{ total: number; direct: number }>>(Prisma.sql`
    SELECT count(*)::int AS total, (count(*) FILTER (WHERE "referrerHost" IS NULL))::int AS direct
    FROM "WebView" WHERE ${inRange(range.start, range.end)} ${hostFilter(options)}`);
  return { top: top.map((r) => ({ referrerHost: r.referrer_host, views: r.views })), directViews: totals[0]?.direct ?? 0, totalViews: totals[0]?.total ?? 0 };
}

export type Dispositivos = { mobile: number; desktop: number; mobilePct: number | null };

export async function getDispositivos(range: PeriodRange, options?: HostScope): Promise<Dispositivos> {
  const rows = await db.$queryRaw<Array<{ device: string; views: number }>>(Prisma.sql`
    SELECT "device", count(*)::int AS views FROM "WebView"
    WHERE ${inRange(range.start, range.end)} ${hostFilter(options)} GROUP BY "device"`);
  const mobile = rows.find((r) => r.device === "mobile")?.views ?? 0;
  const desktop = rows.find((r) => r.device === "desktop")?.views ?? 0;
  const total = mobile + desktop;
  return { mobile, desktop, mobilePct: total > 0 ? Math.round((mobile / total) * 1000) / 10 : null };
}

export type HoyVsAyer = { today: number; yesterdaySameSlice: number; delta: Delta };

/** Vistas de hoy hasta ahora contra el mismo tramo de ayer (misma hora, 24 h antes). */
export async function getHoy(now: Date = new Date(), options?: HostScope): Promise<HoyVsAyer> {
  const startToday = asuncionMidnight(asuncionDayKey(now));
  const yesterdayStart = new Date(startToday.getTime() - 86_400_000);
  const yesterdayNow = new Date(now.getTime() - 86_400_000);
  const rows = await db.$queryRaw<Array<{ today: number; yesterday: number }>>(Prisma.sql`
    SELECT (count(*) FILTER (WHERE "createdAt" >= ${ts(startToday)} AND "createdAt" <= ${ts(now)}))::int AS today,
           (count(*) FILTER (WHERE "createdAt" >= ${ts(yesterdayStart)} AND "createdAt" <= ${ts(yesterdayNow)}))::int AS yesterday
    FROM "WebView" WHERE "createdAt" >= ${ts(yesterdayStart)} AND "createdAt" <= ${ts(now)} ${hostFilter(options)}`);
  const today = rows[0]?.today ?? 0;
  const yesterday = rows[0]?.yesterday ?? 0;
  return { today, yesterdaySameSlice: yesterday, delta: computeDelta(today, yesterday) };
}

export type DemoModuleRow = { module: string; views: number; sessions: number };
export type DemoResumen = {
  started: number;
  startedPrev: number;
  startedDelta: Delta;
  startedByDay: Array<{ day: string; started: number }>;
  /** Demos iniciadas por día del período anterior, alineadas por posición con `startedByDay`. */
  startedByDayPrev: Array<{ day: string; started: number }>;
  /** Sesiones demo con al menos una vista medida (la duración solo existe desde ahí). */
  measuredSessions: number;
  avgDurationSec: number | null;
  medianDurationSec: number | null;
  avgModulesPerSession: number | null;
  /** Módulos del panel demo (primer segmento del path) del host de la demo. */
  topModules: DemoModuleRow[];
  /** Conversión demo → registro/lead: sin vínculo honesto, siempre «sin datos». */
  conversion: { available: false; reason: string };
};

/** Todo lo de la demo, aparte de las métricas del negocio. */
export async function getDemo(range: PeriodRange): Promise<DemoResumen> {
  const rowsByDay = await db.$queryRaw<Array<{ day: string; started: number }>>(Prisma.sql`
    SELECT to_char(${paraguayDay('"startedAt"')}, 'YYYY-MM-DD') AS day, count(*)::int AS started
    FROM "DemoSession" WHERE "startedAt" >= ${ts(range.prevStart)} AND "startedAt" < ${ts(range.end)} GROUP BY 1`);
  const byDay = new Map(rowsByDay.map((r) => [r.day, r.started]));
  const startedByDay = range.days.map((day) => ({ day, started: byDay.get(day) ?? 0 }));
  const startedByDayPrev = range.prevDays.map((day) => ({ day, started: byDay.get(day) ?? 0 }));
  const started = startedByDay.reduce((sum, r) => sum + r.started, 0);
  const startedPrev = range.prevDays.reduce((sum, day) => sum + (byDay.get(day) ?? 0), 0);

  const stats = await db.$queryRaw<Array<{ measured: number; avg_sec: number | null; median_sec: number | null; avg_modules: number | null }>>(Prisma.sql`
    SELECT count(*)::int AS measured, avg("durationSec")::float8 AS avg_sec,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationSec")::float8 AS median_sec,
           avg(cardinality("modules"))::float8 AS avg_modules
    FROM "DemoSession" WHERE "startedAt" >= ${ts(range.start)} AND "startedAt" < ${ts(range.end)} AND "sessionId" IS NOT NULL`);

  const modules = await db.$queryRaw<Array<{ module: string; views: number; sessions: number }>>(Prisma.sql`
    SELECT CASE WHEN m = '' OR m = 'demo' OR m LIKE ':%' THEN 'entrada' ELSE m END AS module,
           count(*)::int AS views, count(DISTINCT "sessionId")::int AS sessions
    FROM (SELECT split_part("path", '/', 2) AS m, "sessionId" FROM "WebView"
          WHERE "host" = ${demoHost()} AND ${inRange(range.start, range.end)}) v
    GROUP BY 1 ORDER BY views DESC, 1 LIMIT 10`);

  return {
    started,
    startedPrev,
    startedDelta: computeDelta(started, startedPrev),
    startedByDay,
    startedByDayPrev,
    measuredSessions: stats[0]?.measured ?? 0,
    avgDurationSec: round1(stats[0]?.avg_sec ?? null),
    medianDurationSec: round1(stats[0]?.median_sec ?? null),
    avgModulesPerSession: round1(stats[0]?.avg_modules ?? null),
    topModules: modules,
    conversion: {
      available: false,
      reason: "Sin datos: la demo no comparte ningún identificador con los leads ni con los registros, así que no se puede medir sin adivinar.",
    },
  };
}
