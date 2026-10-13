/**
 * Tablero del Resumen: tipos y agrupaciones puras. La base devuelve filas ya
 * agregadas por día (desplazamiento desde hoy) y estas funciones las reparten en
 * semanas, antigüedades y meses. Sin acceso a datos: se fijan con tests.
 */

export type ForecastCategory = "proof" | "pending" | "overdue";

/** Fila agregada en la base: pagos esperados pendientes de un día. */
export type ForecastRow = { category: ForecastCategory; offset: number; amount: number; count: number };

export type BoardForecastWeek = {
  /** Primer día (`YYYY-MM-DD`) de la semana; la semana 0 arranca hoy. */
  start: string;
  proof: number;
  pending: number;
  overdue: number;
  count: number;
};

export type BoardForecast = {
  weeks: BoardForecastWeek[];
  /** Acumulado desde hoy (incluye lo vencido) hasta 30, 60 y 90 días. */
  totals: { d30: number; d60: number; d90: number };
  /** Parte de cada total que ya está vencida. */
  overdueTotal: number;
  /** Pagos esperados pendientes sin fecha de vencimiento: no entran en ninguna barra. */
  undated: { count: number; amount: number };
};

export const FORECAST_WEEKS = 8;
export const FORECAST_DAYS = 90;

export function shiftKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Reparte los pagos esperados pendientes en las próximas 8 semanas. Lo vencido
 * (`offset < 0`) cae en la semana 0 y se muestra como mora; lo que está a más de
 * 8 semanas no se dibuja pero sí suma en los totales a 60 y 90 días.
 */
export function buildForecast(
  rows: ReadonlyArray<ForecastRow>,
  todayKey: string,
  undated: { count: number; amount: number } = { count: 0, amount: 0 },
  weeks = FORECAST_WEEKS,
): BoardForecast {
  const result: BoardForecastWeek[] = Array.from({ length: weeks }, (_, index) => ({
    start: shiftKey(todayKey, index * 7),
    proof: 0,
    pending: 0,
    overdue: 0,
    count: 0,
  }));
  const totals = { d30: 0, d60: 0, d90: 0 };
  let overdueTotal = 0;
  for (const row of rows) {
    if (!(row.amount > 0) && !(row.count > 0)) continue;
    const week = Math.floor(Math.max(0, row.offset) / 7);
    if (week < weeks) {
      const bucket = result[week];
      bucket[row.category] += row.amount;
      bucket.count += row.count;
    }
    if (row.offset < 30) totals.d30 += row.amount;
    if (row.offset < 60) totals.d60 += row.amount;
    if (row.offset < FORECAST_DAYS) totals.d90 += row.amount;
    if (row.category === "overdue") overdueTotal += row.amount;
  }
  return { weeks: result, totals, overdueTotal, undated };
}

export type AgingKey = "current" | "d1_30" | "d31_60" | "d60plus";
export type AgingRow = { lateDays: number; amount: number; count: number };
export type BoardAgingBucket = { key: AgingKey; label: string; amount: number; count: number };

export const AGING_LABELS: Record<AgingKey, string> = {
  current: "Al día",
  d1_30: "1–30 días",
  d31_60: "31–60 días",
  d60plus: "Más de 60 días",
};

export function agingKeyOf(lateDays: number): AgingKey {
  if (!(lateDays > 0)) return "current";
  if (lateDays <= 30) return "d1_30";
  if (lateDays <= 60) return "d31_60";
  return "d60plus";
}

/** Cobros pendientes por días de atraso (`lateDays ≤ 0` = no vencido). Siempre devuelve los 4 tramos. */
export function bucketAging(rows: ReadonlyArray<AgingRow>): BoardAgingBucket[] {
  const buckets = (Object.keys(AGING_LABELS) as AgingKey[]).map((key) => ({ key, label: AGING_LABELS[key], amount: 0, count: 0 }));
  for (const row of rows) {
    const bucket = buckets.find((candidate) => candidate.key === agingKeyOf(row.lateDays));
    if (!bucket) continue;
    bucket.amount += row.amount;
    bucket.count += row.count;
  }
  return buckets;
}

export type BoardTrendMonth = { month: string; sales: number; salesCount: number; collected: number; current: boolean };
export type MonthAmountRow = { month: string; amount: number; count: number };

/** Claves `YYYY-MM` de los últimos `count` meses terminando en el de `todayKey`, del más viejo al actual. */
export function lastMonthKeys(todayKey: string, count = 6): string[] {
  let [year, month] = todayKey.split("-").map(Number);
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    keys.unshift(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

/** Une venta aprobada y cobrado por mes; un mes sin filas queda en 0 (es un 0 real, no un dato faltante). */
export function buildTrend(
  keys: ReadonlyArray<string>,
  sales: ReadonlyArray<MonthAmountRow>,
  collected: ReadonlyArray<MonthAmountRow>,
): BoardTrendMonth[] {
  const sum = (rows: ReadonlyArray<MonthAmountRow>, key: string, field: "amount" | "count") =>
    rows.filter((row) => row.month === key).reduce((acc, row) => acc + row[field], 0);
  return keys.map((month, index) => ({
    month,
    sales: sum(sales, month, "amount"),
    salesCount: sum(sales, month, "count"),
    collected: sum(collected, month, "amount"),
    current: index === keys.length - 1,
  }));
}

export type BoardEventWeek = { start: string; count: number };

/** Eventos de las próximas semanas: `weeks` filas siempre (semana 0 = próximos 7 días). */
export function buildEventWeeks(rows: ReadonlyArray<{ week: number; count: number }>, todayKey: string, weeks = 4): BoardEventWeek[] {
  return Array.from({ length: weeks }, (_, index) => ({
    start: shiftKey(todayKey, index * 7),
    count: rows.filter((row) => row.week === index).reduce((acc, row) => acc + row.count, 0),
  }));
}

/** Porcentaje (1 decimal) de `to` sobre `from`; `null` si no hay base. */
export function conversionRate(from: number, to: number): number | null {
  if (!(from > 0)) return null;
  return Math.round((to / from) * 1000) / 10;
}

export type BoardOpenBudgets = {
  count: number;
  amount: number;
  /** Antigüedad en días del presupuesto abierto más viejo; `null` si no hay. */
  oldestDays: number | null;
  byStatus: Array<{ status: "SENT" | "NEGOTIATING"; count: number; amount: number; oldestDays: number | null }>;
  top: Array<{ id: string; title: string; client: string; status: "SENT" | "NEGOTIATING"; amount: number; ageDays: number }>;
};

export type BoardOccupancy = {
  /** Ocupación global de la semana; `null` si no hay productos alquilables. */
  percent: number | null;
  items: number;
  truncated: boolean;
  top: Array<{ id: string; name: string; percent: number; committedDays: number; availableDays: number }>;
};

export type AdminResumenBoard = {
  today: string;
  forecast: BoardForecast;
  aging: BoardAgingBucket[];
  budgets: BoardOpenBudgets;
  trend: BoardTrendMonth[];
  events: BoardEventWeek[];
  occupancy: BoardOccupancy;
};

/** Días enteros entre dos instantes (a − b), sin negativos. */
export function ageInDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

const ASUNCION_UTC_OFFSET_MS = 3 * 3_600_000;
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" });

/** Días de atraso de un vencimiento (misma cuenta que el tablero): `ceil((inicio de hoy − vencimiento) / 1 día)`, `≤ 0` si no venció. */
export function lateDaysOf(dueAt: string | Date | null | undefined, now: Date): number {
  if (!dueAt) return 0;
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return 0;
  const [year, month, day] = dayKeyFormat.format(now).split("-").map(Number);
  const todayStart = Date.UTC(year, month - 1, day) + ASUNCION_UTC_OFFSET_MS;
  return Math.ceil((todayStart - due) / 86_400_000) || 0;
}

export const AGING_PARAMS: Record<AgingKey, string> = { current: "al-dia", d1_30: "1-30", d31_60: "31-60", d60plus: "60-mas" };

/** Valor de `?vence=` → tramo; `null` si no es uno de los cuatro. */
export function parseAgingParam(value: string | null | undefined): AgingKey | null {
  const found = (Object.keys(AGING_PARAMS) as AgingKey[]).find((key) => AGING_PARAMS[key] === value);
  return found ?? null;
}
