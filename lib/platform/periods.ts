/**
 * Períodos del panel de plataforma (docs/SUPERADMIN.md §3). Puro: sin base ni DOM.
 * Los límites son medianoches de America/Asuncion convertidas a UTC; el período
 * anterior tiene la misma duración y termina donde empieza el actual.
 */

export const PERIOD_KEYS = ["hoy", "7d", "30d", "90d", "mes", "mes-anterior"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const DEFAULT_PERIOD: PeriodKey = "30d";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  hoy: "Hoy",
  "7d": "7 días",
  "30d": "30 días",
  "90d": "90 días",
  mes: "Este mes",
  "mes-anterior": "Mes anterior",
};

const TIME_ZONE = "America/Asuncion";
const DAY_MS = 86_400_000;

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(instant: number) {
  const parts: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

/** Desfase de Asunción respecto de UTC (ms) en un instante: negativo al oeste. */
function offsetMs(instant: number): number {
  const p = localParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/** Día calendario de Asunción (`YYYY-MM-DD`) de un instante. */
export function asuncionDayKey(instant: Date): string {
  const p = localParts(instant.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function dayKeyFromNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Instante UTC de la medianoche de Asunción del día `YYYY-MM-DD`. */
export function asuncionMidnight(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - offsetMs(naive);
  guess = naive - offsetMs(guess);
  return new Date(guess);
}

export type PeriodRange = {
  key: PeriodKey;
  label: string;
  /** Inicio inclusive (UTC). */
  start: Date;
  /** Fin exclusivo (UTC). */
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  /** Días de Asunción del período actual (`YYYY-MM-DD`) en orden. */
  days: string[];
  /** Días del período anterior, alineados por posición con `days`. */
  prevDays: string[];
};

export function parsePeriod(raw: string | string[] | null | undefined): PeriodKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PERIOD_KEYS as readonly string[]).includes(value ?? "") ? (value as PeriodKey) : DEFAULT_PERIOD;
}

function daysBetween(startKey: string, endKeyExclusive: string): string[] {
  const out: string[] = [];
  for (let n = dayNumber(startKey); n < dayNumber(endKeyExclusive); n += 1) out.push(dayKeyFromNumber(n));
  return out;
}

/**
 * Rango de un período. «Este mes» es lo que va del mes hasta el fin de hoy; los demás
 * terminan al cierre de hoy salvo «Mes anterior» (mes calendario completo).
 */
export function resolvePeriod(key: PeriodKey, now: Date = new Date()): PeriodRange {
  const today = asuncionDayKey(now);
  const todayN = dayNumber(today);
  const tomorrowKey = dayKeyFromNumber(todayN + 1);
  const monthStartKey = `${today.slice(0, 8)}01`;
  let startKey: string;
  let endKey: string;
  switch (key) {
    case "hoy":
      startKey = today;
      endKey = tomorrowKey;
      break;
    case "7d":
      startKey = dayKeyFromNumber(todayN - 6);
      endKey = tomorrowKey;
      break;
    case "30d":
      startKey = dayKeyFromNumber(todayN - 29);
      endKey = tomorrowKey;
      break;
    case "90d":
      startKey = dayKeyFromNumber(todayN - 89);
      endKey = tomorrowKey;
      break;
    case "mes":
      startKey = monthStartKey;
      endKey = tomorrowKey;
      break;
    case "mes-anterior": {
      const prevMonthLast = dayNumber(monthStartKey) - 1;
      startKey = `${dayKeyFromNumber(prevMonthLast).slice(0, 8)}01`;
      endKey = monthStartKey;
      break;
    }
  }
  const days = daysBetween(startKey, endKey);
  const prevStartKey = dayKeyFromNumber(dayNumber(startKey) - days.length);
  const prevDays = daysBetween(prevStartKey, startKey);
  const start = asuncionMidnight(startKey);
  const end = asuncionMidnight(endKey);
  // Igual duración en días calendario: el anterior termina donde empieza el actual.
  return {
    key,
    label: PERIOD_LABELS[key],
    start,
    end,
    prevStart: asuncionMidnight(prevStartKey),
    prevEnd: start,
    days,
    prevDays,
  };
}

export type Delta =
  | { kind: "nuevo" }
  | { kind: "igual" }
  | { kind: "pct"; pct: number; direction: "up" | "down" };

/** Variación contra el período anterior. Anterior 0 y actual > 0 → «nuevo» (nunca ∞). */
export function computeDelta(current: number, previous: number): Delta {
  if (previous === 0) return current === 0 ? { kind: "igual" } : { kind: "nuevo" };
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  if (pct === 0) return { kind: "igual" };
  return { kind: "pct", pct: Math.abs(pct), direction: pct > 0 ? "up" : "down" };
}

export function formatDelta(delta: Delta): string {
  if (delta.kind === "nuevo") return "nuevo";
  if (delta.kind === "igual") return "sin cambios";
  const text = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(delta.pct);
  return `${delta.direction === "up" ? "+" : "-"}${text} %`;
}

/** Conserva los demás parámetros de la URL y cambia solo `p`. */
export function periodHref(basePath: string, params: Record<string, string | string[] | undefined>, key: PeriodKey): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === "p" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(name, item);
  }
  query.set("p", key);
  return `${basePath}?${query.toString()}`;
}
