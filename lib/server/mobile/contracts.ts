import { z } from "zod";
import { dayKeyOf, dayStart, isValidDayKey, monthEndKey, nextDayKey, DAY_MS } from "../notifications";

export const mobileLoginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) }).strict();
export const mobileOrganizationSchema = z.object({ organizationId: z.string().min(1).max(200) }).strict();
export const mobileDeleteSchema = z.object({ password: z.string().min(1).max(200), confirmation: z.literal("DELETE_ACCOUNT") }).strict();

export function calendarRange(params: URLSearchParams, now = new Date()) {
  const today = dayKeyOf(now);
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? monthEndKey(today);
  if (!isValidDayKey(from) || !isValidDayKey(to) || to < from) return null;
  const start = dayStart(from), end = dayStart(nextDayKey(to));
  if ((end.getTime() - start.getTime()) / DAY_MS > 400) return null;
  return { from, to, start, end };
}

export const mobileEventSelect = {
  id: true, name: true, status: true, location: true, city: true,
  startsAt: true, endsAt: true, setupAt: true, strikeAt: true,
} as const;

type MobileEvent = {
  id: string; name: string; status: string; location: string | null; city: string | null;
  startsAt: Date | null; endsAt: Date | null; setupAt: Date | null; strikeAt: Date | null;
};

/** Allowlist operativa: no clientes, contactos, notas, costos ni documentos. */
export function mobileEventDTO(event: MobileEvent) {
  return { id: event.id, name: event.name, status: event.status, location: event.location, city: event.city,
    startsAt: event.startsAt?.toISOString() ?? null, endsAt: event.endsAt?.toISOString() ?? null,
    setupAt: event.setupAt?.toISOString() ?? null, strikeAt: event.strikeAt?.toISOString() ?? null };
}

export function mobileCalendarItems(event: MobileEvent, range: NonNullable<ReturnType<typeof calendarRange>>) {
  const items: Array<{ id: string; eventId: string; kind: "event" | "setup" | "strike"; date: string; at: string; endAt: string | null }> = [];
  const inside = (at: Date) => at >= range.start && at < range.end;
  const validDuration = event.startsAt && event.endsAt && event.endsAt > event.startsAt;
  const point = event.startsAt ?? event.endsAt;
  if (validDuration ? event.startsAt! < range.end && event.endsAt! > range.start : point && inside(point)) {
    const at = point!;
    items.push({ id: `event:${event.id}`, eventId: event.id, kind: "event", date: dayKeyOf(at < range.start ? range.start : at), at: at.toISOString(), endAt: validDuration ? event.endsAt!.toISOString() : null });
  }
  for (const kind of ["setup", "strike"] as const) {
    const at = kind === "setup" ? event.setupAt : event.strikeAt;
    if (at && inside(at)) items.push({ id: `${kind}:${event.id}`, eventId: event.id, kind, date: dayKeyOf(at), at: at.toISOString(), endAt: null });
  }
  return items;
}

export function parseMobileBearer(value: string | null): string | null {
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}
