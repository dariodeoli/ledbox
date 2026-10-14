import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { computeDelta, type Delta, type PeriodRange } from "@/lib/platform/periods";
import { dayWindow, inWindow, localDayText, runMetric, type MetricResult } from "@/lib/platform/aggregate";
import { orgDemo, orgReal, usuarioReal } from "@/lib/platform/sin-demo";

/**
 * Resumen de plataforma (docs/SUPERADMIN.md §3). Solo agregados: cada KPI lleva el
 * período anterior, una serie diaria y la nota «fuente · cálculo». Sin la empresa demo
 * (se cuenta aparte) y sin datos sueltos de personas: todo son números y textos fijos.
 */

export type KpiFormat = "count" | "money";

export type PlatformKpi = {
  key: string;
  label: string;
  format: KpiFormat;
  value: number;
  previous: number | null;
  delta: Delta | null;
  series: number[];
  prevSeries: number[];
  /** «fuente · cálculo». */
  note: string;
  /** Conteos: cuántos hay en la papelera (no entran en `value`). */
  papelera: number | null;
  /** Montos: la parte de `value` que está eliminada. */
  deleted: number | null;
  /** Sin datos propios todavía (p. ej. usuarios activos antes del deploy). */
  empty: string | null;
};

export type ResumenData = {
  kpis: PlatformKpi[];
  /** La empresa demo, aparte: nunca suma a los KPIs. */
  demo: { empresas: number; eventos: number; presupuestos: number; total: number };
};

function kpiFromMetric(
  key: string,
  label: string,
  note: string,
  m: MetricResult,
  options: { format?: KpiFormat; pick?: "n" | "amt"; withTrash?: boolean } = {},
): PlatformKpi {
  const format = options.format ?? "count";
  const pick = options.pick ?? "n";
  const value = pick === "amt" ? m.amt : m.n;
  const previous = pick === "amt" ? m.amtPrev : m.nPrev;
  const trash = options.withTrash ?? true;
  return {
    key,
    label,
    format,
    value,
    previous,
    delta: computeDelta(value, previous),
    series: m.series,
    prevSeries: m.prevSeries,
    note,
    papelera: format === "count" && trash ? m.nDel : null,
    deleted: format === "money" ? m.amtDel : null,
    empty: null,
  };
}

const NO_DEL = Prisma.sql`false`;
const NO_AMT = Prisma.sql`0::int`;

export async function loadResumen(range: PeriodRange): Promise<ResumenData> {
  const window = dayWindow(range);

  const empresasNuevas = Prisma.sql`
    SELECT o."createdAt" AS ts, ${localDayText(Prisma.sql`o."createdAt"`)} AS d, o."id" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "Organization" o
    WHERE ${orgReal("o", "id")} AND ${inWindow(Prisma.sql`o."createdAt"`, range)}`;

  const empresasActivas = Prisma.sql`
    SELECT a."createdAt" AS ts, ${localDayText(Prisma.sql`a."createdAt"`)} AS d, a."organizationId" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "AuditLog" a
    WHERE ${orgReal("a")} AND ${inWindow(Prisma.sql`a."createdAt"`, range)}`;

  const usuariosActivos = Prisma.sql`
    SELECT ((a."day"::timestamp AT TIME ZONE 'America/Asuncion') AT TIME ZONE 'UTC') AS ts,
           to_char(a."day", 'YYYY-MM-DD') AS d, a."userId" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "AdminActivityDay" a
    WHERE ${usuarioReal("a")} AND a."day" >= ${window.first}::date AND a."day" < ${window.endExclusive}::date`;

  const ingresos = Prisma.sql`
    SELECT s."createdAt" AS ts, ${localDayText(Prisma.sql`s."createdAt"`)} AS d, s."userId" AS k, ${NO_AMT} AS amt, ${NO_DEL} AS del
    FROM "AdminSession" s
    WHERE ${usuarioReal("s")} AND ${inWindow(Prisma.sql`s."createdAt"`, range)}`;

  const eventosCreados = Prisma.sql`
    SELECT e."createdAt" AS ts, ${localDayText(Prisma.sql`e."createdAt"`)} AS d, e."id" AS k, ${NO_AMT} AS amt, (e."deletedAt" IS NOT NULL) AS del
    FROM "Event" e
    WHERE ${orgReal("e")} AND ${inWindow(Prisma.sql`e."createdAt"`, range)}`;

  const eventosRealizados = Prisma.sql`
    SELECT e."startsAt" AS ts, ${localDayText(Prisma.sql`e."startsAt"`)} AS d, e."id" AS k, ${NO_AMT} AS amt, (e."deletedAt" IS NOT NULL) AS del
    FROM "Event" e
    WHERE ${orgReal("e")} AND e."status" <> 'CANCELLED' AND ${inWindow(Prisma.sql`e."startsAt"`, range)}`;

  // «Enviado» = acción `send` o cambio de estado a SENT; un presupuesto enviado dos veces cuenta una.
  const enviados = Prisma.sql`
    SELECT a."createdAt" AS ts, ${localDayText(Prisma.sql`a."createdAt"`)} AS d, a."entityId" AS k, ${NO_AMT} AS amt, (b."deletedAt" IS NOT NULL) AS del
    FROM "AuditLog" a
    LEFT JOIN "Budget" b ON b."id" = a."entityId"
    WHERE ${orgReal("a")} AND a."entity" = 'Budget'
      AND (a."action" = 'send' OR (a."action" = 'status' AND a."detail" -> 'changes' -> 'status' ->> 'to' = 'SENT'))
      AND ${inWindow(Prisma.sql`a."createdAt"`, range)}`;

  const aprobados = Prisma.sql`
    SELECT b."approvedAt" AS ts, ${localDayText(Prisma.sql`b."approvedAt"`)} AS d, b."id" AS k, b."total" AS amt, (b."deletedAt" IS NOT NULL) AS del
    FROM "Budget" b
    WHERE ${orgReal("b")} AND b."approvedAt" IS NOT NULL AND ${inWindow(Prisma.sql`b."approvedAt"`, range)}`;

  const cobros = Prisma.sql`
    SELECT p."paidAt" AS ts, ${localDayText(Prisma.sql`p."paidAt"`)} AS d, p."id" AS k, p."amount" AS amt, (b."deletedAt" IS NOT NULL) AS del
    FROM "ClientPayment" p
    LEFT JOIN "Budget" b ON b."id" = p."budgetId"
    WHERE ${orgReal("p")} AND p."status" = 'RECEIVED' AND p."paidAt" IS NOT NULL AND ${inWindow(Prisma.sql`p."paidAt"`, range)}`;

  const [nuevas, activas, activos, logins, creados, realizados, enviadosM, aprobadosM, cobrosM, reales, hasActivity, demo] = await Promise.all([
    runMetric(empresasNuevas, range),
    runMetric(empresasActivas, range),
    runMetric(usuariosActivos, range),
    runMetric(ingresos, range),
    runMetric(eventosCreados, range),
    runMetric(eventosRealizados, range),
    runMetric(enviados, range),
    runMetric(aprobados, range, "n"),
    runMetric(cobros, range, "amt"),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "Organization" o
      WHERE o."active" = true AND ${orgReal("o", "id")}
      GROUP BY o."active"`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "AdminActivityDay" a
      WHERE ${usuarioReal("a")}
      GROUP BY (a."day" IS NOT NULL)`),
    db.$queryRaw<Array<{ k: string; n: number }>>(Prisma.sql`
      SELECT 'empresas' AS k, COUNT(*)::int AS n FROM "Organization" o WHERE ${orgDemo("o", "id")} GROUP BY 1
      UNION ALL
      SELECT 'eventos' AS k, COUNT(*)::int AS n FROM "Event" e WHERE ${orgDemo("e")} GROUP BY 1
      UNION ALL
      SELECT 'presupuestos' AS k, COUNT(*)::int AS n FROM "Budget" b WHERE ${orgDemo("b")} GROUP BY 1`),
  ]);

  const realesN = reales[0]?.n ?? 0;
  const empresasReales: PlatformKpi = {
    key: "empresas-reales",
    label: "Empresas reales",
    format: "count",
    value: realesN,
    previous: null,
    delta: null,
    series: [],
    prevSeries: [],
    note: "Organization · empresas activas sin la demo, al día de hoy",
    papelera: null,
    deleted: null,
    empty: null,
  };
  const usuarios = kpiFromMetric(
    "usuarios-activos",
    "Usuarios activos",
    "AdminActivityDay · usuarios distintos con actividad en el período",
    activos,
    { withTrash: false },
  );
  if ((hasActivity[0]?.n ?? 0) === 0) usuarios.empty = "sin datos todavía";

  const kpis: PlatformKpi[] = [
    empresasReales,
    kpiFromMetric("empresas-nuevas", "Empresas nuevas", "Organization · altas (createdAt) en el período", nuevas, { withTrash: false }),
    kpiFromMetric("empresas-activas", "Empresas con actividad", "AuditLog · empresas distintas con alguna acción en el período", activas, { withTrash: false }),
    usuarios,
    kpiFromMetric("ingresos", "Ingresos (logins)", "AdminSession · usuarios distintos que iniciaron sesión", logins, { withTrash: false }),
    kpiFromMetric("eventos-creados", "Eventos creados", "Event · createdAt en el período, sin la papelera", creados),
    kpiFromMetric("eventos-realizados", "Eventos realizados", "Event · fecha de inicio en el período y estado distinto de cancelado", realizados),
    kpiFromMetric("presupuestos-enviados", "Presupuestos enviados", "AuditLog · presupuestos distintos enviados (acción enviar o cambio a SENT)", enviadosM),
    kpiFromMetric("presupuestos-aprobados", "Presupuestos aprobados", "Budget · approvedAt en el período, sin la papelera", aprobadosM),
    kpiFromMetric("monto-aprobado", "Monto aprobado", "Budget · suma de total (Gs) con approvedAt en el período, incluye lo eliminado", aprobadosM, { format: "money", pick: "amt" }),
    kpiFromMetric("cobros", "Cobros recibidos", "ClientPayment · suma de monto RECIBIDO con paidAt en el período, incluye lo eliminado", cobrosM, { format: "money", pick: "amt" }),
  ];
  // La serie del monto aprobado es por monto; la de los conteos, por cantidad.
  const monto = kpis.find((kpi) => kpi.key === "monto-aprobado");
  if (monto) {
    const amountSeries = await runMetric(aprobados, range, "amt");
    monto.series = amountSeries.series;
    monto.prevSeries = amountSeries.prevSeries;
  }

  const demoCount = (key: string) => demo.find((row) => row.k === key)?.n ?? 0;
  const demoData = {
    empresas: demoCount("empresas"),
    eventos: demoCount("eventos"),
    presupuestos: demoCount("presupuestos"),
    total: 0,
  };
  demoData.total = demoData.eventos + demoData.presupuestos;
  return { kpis, demo: demoData };
}
