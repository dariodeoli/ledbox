import { addDaysKey, todayKeyPY } from "./storefront-ui";

export type DateShortcutKind = "date" | "datetime-local";
function civilNumber(value: string | undefined, kind: DateShortcutKind): number | null {
  if (!value) return null;
  const shape = kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;
  if (!shape.test(value)) return null;
  const stamp = Date.parse(kind === "date" ? `${value}T00:00:00Z` : `${value}Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value.slice(0, 10) ? stamp : null;
}

export type DateShortcut = { offset: 0 | 1 | 2; label: string; day: string; dateLabel: string; value: string; allowed: boolean };

/** Calendar days in Paraguay; offsets never add elapsed hours across a time-zone boundary. */
export function dateShortcuts({ kind = "date", value = "", min, max, now = new Date() }: {
  kind?: DateShortcutKind; value?: string; min?: string; max?: string; now?: Date;
} = {}): DateShortcut[] {
  const today = todayKeyPY(now);
  const minimum = civilNumber(min, kind), maximum = civilNumber(max, kind);
  // A shortcut changes only the civil day. An empty datetime explicitly starts at 00:00.
  const time = /^\d{4}-\d{2}-\d{2}T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?)$/.exec(value)?.[1] ?? "00:00";
  return (["Hoy", "Mañana", "Pasado mañana"] as const).map((label, offset) => {
    const day = addDaysKey(today, offset);
    const candidate = kind === "datetime-local" ? `${day}T${time}` : day;
    return { offset: offset as 0 | 1 | 2, label, day, dateLabel: day.split("-").reverse().join("/"), value: candidate,
      allowed: (minimum === null || civilNumber(candidate, kind)! >= minimum) && (maximum === null || civilNumber(candidate, kind)! <= maximum) };
  });
}
