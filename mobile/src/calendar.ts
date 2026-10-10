import type { MobileEvent } from "./api/contract";

export function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes inválido");
  const [year, value] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${count}`, count, offset: (new Date(Date.UTC(year, value - 1, 1)).getUTCDay() + 6) % 7 };
}
export function shiftMonth(month: string, delta: number) {
  monthRange(month);
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function eventsForDay(events: MobileEvent[], day: string) {
  return events.filter(event => event.startsAt && dayKey(new Date(event.startsAt)) <= day
    && dayKey(new Date(event.endsAt && event.endsAt > event.startsAt ? new Date(event.endsAt).getTime() - 1 : event.startsAt)) >= day);
}
export function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(new Date(value)) : "Sin fecha";
}
