import { db } from "../db";
import { calendarRange, mobileCalendarItems, mobileEventDTO, mobileEventSelect } from "./contracts";

export function mobileReadQuery(url: URL, calendar: boolean) {
  const allowed = calendar ? ["from", "to", "after", "limit"] : ["after", "limit"];
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return null;
  const rawLimit = url.searchParams.get("limit") ?? "50";
  if (!/^\d+$/.test(rawLimit)) return null;
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 100) return null;
  const after = url.searchParams.get("after");
  if (after !== null && (!after.length || after.length > 200)) return null;
  const range = calendar ? calendarRange(url.searchParams) : null;
  if (calendar && !range) return null;
  return { limit, after, range };
}

export async function mobileEvents(organizationId: string, query: NonNullable<ReturnType<typeof mobileReadQuery>>) {
  const range = query.range;
  const rows = await db.event.findMany({
    where: {
      organizationId,
      ...(query.after ? { id: { gt: query.after } } : {}),
      ...(range ? { status: { not: "CANCELLED" as const }, OR: [
        { startsAt: { lt: range.end }, endsAt: { gt: range.start }, AND: { endsAt: { gt: db.event.fields.startsAt } } },
        { startsAt: { gte: range.start, lt: range.end }, OR: [{ endsAt: null }, { endsAt: { lte: db.event.fields.startsAt } }] },
        { startsAt: null, endsAt: { gte: range.start, lt: range.end } },
        { setupAt: { gte: range.start, lt: range.end } },
        { strikeAt: { gte: range.start, lt: range.end } },
      ] } : {}),
    },
    select: mobileEventSelect, orderBy: { id: "asc" }, take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  return { version: 1, events: page.map(mobileEventDTO),
    ...(range ? { from: range.from, to: range.to, timeZone: "America/Asuncion", items: page.flatMap(event => mobileCalendarItems(event, range)).sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id)) } : {}),
    page: { hasMore, nextAfter: hasMore ? page.at(-1)!.id : null } };
}
