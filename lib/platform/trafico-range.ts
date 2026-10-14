/**
 * Rango de fechas para «Tráfico» (puro, días de Paraguay). Es una versión chica y propia:
 * si `lib/platform/periods.ts` (E1a) llega a la rama, `trafico.ts` puede pasar a usarla sin
 * cambiar los tipos. Límites en medianoche de America/Asuncion convertidas a UTC; el
 * período anterior tiene igual duración: `[desde − (hasta − desde), desde)`.
 */

export const TRAFICO_PERIODS = ["hoy", "7d", "30d", "90d", "mes", "mes-anterior"] as const;
export type TraficoPeriod = (typeof TRAFICO_PERIODS)[number];

export type TraficoRange = {
  period: TraficoPeriod;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** Días de Paraguay (`YYYY-MM-DD`) del período, en orden. */
  days: string[];
  /** Días del período anterior, alineados por posición con `days`. */
  prevDays: string[];
};

const TIME_ZONE = "America/Asuncion";
const DAY_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" });

export function dayOf(date: Date): string {
  const parts: Record<string, string> = {};
  for (const part of dayFormat.formatToParts(date)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Instante UTC de las 00:00 de Paraguay de ese día. */
export function paraguayMidnight(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  for (const offset of [3, 4, 2, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, offset));
    if (dayOf(candidate) === day && Number(hourFormat.format(candidate)) === 0) return candidate;
  }
  return new Date(Date.UTC(y, m - 1, d, 3));
}

function daysBetween(fromDay: string, toDayExclusive: string): string[] {
  const out: string[] = [];
  for (let day = fromDay; day < toDayExclusive; day = addDays(day, 1)) out.push(day);
  return out;
}

export function parseTraficoPeriod(value: string | null | undefined): TraficoPeriod {
  return (TRAFICO_PERIODS as readonly string[]).includes(value || "") ? (value as TraficoPeriod) : "7d";
}

export function traficoRange(period: TraficoPeriod, now: Date = new Date()): TraficoRange {
  const today = dayOf(now);
  const tomorrow = addDays(today, 1);
  let fromDay: string;
  let toDay = tomorrow;
  switch (period) {
    case "hoy":
      fromDay = today;
      break;
    case "7d":
      fromDay = addDays(today, -6);
      break;
    case "30d":
      fromDay = addDays(today, -29);
      break;
    case "90d":
      fromDay = addDays(today, -89);
      break;
    case "mes":
      fromDay = `${today.slice(0, 7)}-01`;
      break;
    case "mes-anterior": {
      toDay = `${today.slice(0, 7)}-01`;
      fromDay = `${addDays(toDay, -1).slice(0, 7)}-01`;
      break;
    }
  }
  const days = daysBetween(fromDay, toDay);
  const prevFromDay = addDays(fromDay, -days.length);
  return {
    period,
    from: paraguayMidnight(fromDay),
    to: paraguayMidnight(toDay),
    prevFrom: paraguayMidnight(prevFromDay),
    prevTo: paraguayMidnight(fromDay),
    days,
    prevDays: daysBetween(prevFromDay, fromDay),
  };
}

/** Delta % contra el período anterior; anterior 0 → «nuevo» (nunca infinito). */
export function deltaPct(current: number, previous: number): number | "nuevo" | null {
  if (previous === 0) return current === 0 ? null : "nuevo";
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export { DAY_MS };
