import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import type { AdminCalendarAlert, AdminCalendarItem, AdminCalendarItemKind } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Calendario operativo del panel.
 *
 * `from` y `to` son días de Asunción (`YYYY-MM-DD`, ambos inclusive); si faltan
 * se usa el mes en curso. Devuelve marcadores normalizados (`items`) y alertas
 * de vencimiento (`alerts`), siempre filtrados por la empresa activa.
 *
 * No se inventan estados ni fechas derivadas: cada ítem corresponde a un
 * timestamp real (`Event.setupAt/startsAt/endsAt/strikeAt`,
 * `EventTask.dueAt`, `ClientPayment.paidAt`,
 * `SupplierJob.dueAt/deliveredAt/paidAt`) ubicado en el día de Asunción en que
 * ocurre. Las tareas ya cumplidas no se listan: el calendario muestra lo que
 * todavía requiere acción y su historial vive en el módulo de Eventos.
 */

const TIME_ZONE = "America/Asuncion";
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;
const ALERT_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

const KIND_ORDER: Record<AdminCalendarItemKind, number> = {
  setup: 0,
  task: 1,
  event: 2,
  event_end: 3,
  strike: 4,
  supplier_due: 5,
  supplier_delivery: 6,
  collection: 7,
  supplier_payment: 8,
};

// ── Días de Asunción ────────────────────────────────────────────────────────
// Paraguay no aplica horario de verano desde 2024, pero el offset se calcula
// igual con Intl para no romperse si la regla cambia (el rango se resuelve con
// las 00:00 locales, no con la medianoche UTC del servidor).

const zonePartsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type ZoneParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zoneParts(date: Date): ZoneParts {
  const parts = zonePartsFormat.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Día de Asunción (`YYYY-MM-DD`) de un instante real. */
function dayKeyOf(date: Date): string {
  const { year, month, day } = zoneParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Offset de Asunción contra UTC para un instante dado. */
function zoneOffsetMs(instant: Date): number {
  const { year, month, day, hour, minute, second } = zoneParts(instant);
  return Date.UTC(year, month - 1, day, hour, minute, second) - instant.getTime();
}

/** Instante UTC de las 00:00 de un día de Asunción. */
function dayStart(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const firstGuess = utcMidnight - zoneOffsetMs(new Date(utcMidnight));
  // Segundo ajuste por si el offset cambió al convertir.
  return new Date(utcMidnight - zoneOffsetMs(new Date(firstGuess)));
}

/** Día siguiente a una clave `YYYY-MM-DD` (a límite exclusivo). */
function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function isValidDayKey(value: string): boolean {
  if (!DAY_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Último día del mes de una clave `YYYY-MM-DD`. */
function monthEndKey(dayKey: string): string {
  const [year, month] = dayKey.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
}

// ── Normalización ───────────────────────────────────────────────────────────

function clientLabel(client: { name: string; company: string | null }): string {
  return client.company?.trim() || client.name;
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const text = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(" · ");
  return text || null;
}

type CalendarEvent = {
  id: string;
  name: string;
  location: string | null;
  setupAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  strikeAt: Date | null;
  status: string;
  client: { name: string; company: string | null };
};

function eventItem(
  kind: Extract<AdminCalendarItemKind, "setup" | "event" | "event_end" | "strike">,
  event: CalendarEvent,
  at: Date,
): AdminCalendarItem {
  const multiDay = Boolean(
    kind === "event" && event.startsAt && event.endsAt && dayKeyOf(event.startsAt) !== dayKeyOf(event.endsAt),
  );
  return {
    id: `${kind}:${event.id}`,
    kind,
    date: dayKeyOf(at),
    at: at.toISOString(),
    endAt: multiDay && event.endsAt ? event.endsAt.toISOString() : null,
    endDate: multiDay && event.endsAt ? dayKeyOf(event.endsAt) : null,
    title: event.name,
    subtitle: joinParts([event.client.company || event.client.name, event.location]),
    href: "/eventos",
    tone: kind === "strike" ? "warn" : kind === "event" ? "accent" : "info",
    tag: event.status,
    amount: null,
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const url = new URL(request.url);
  const today = dayKeyOf(new Date());
  const fromKey = (url.searchParams.get("from") || `${today.slice(0, 7)}-01`).trim();
  const toKey = (url.searchParams.get("to") || monthEndKey(today)).trim();
  if (!isValidDayKey(fromKey) || !isValidDayKey(toKey)) return jsonError("Parametrizá el rango con días válidos (YYYY-MM-DD).", 400);
  if (toKey < fromKey) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);
  const rangeDays = (dayStart(nextDayKey(toKey)).getTime() - dayStart(fromKey).getTime()) / DAY_MS;
  if (rangeDays > MAX_RANGE_DAYS) return jsonError("El rango no puede superar un año.", 400);

  const from = dayStart(fromKey);
  const to = dayStart(nextDayKey(toKey)); // límite exclusivo
  const now = new Date();

  const [events, tasks, payments, jobs] = await Promise.all([
    db.event.findMany({
      where: {
        organizationId,
        status: { not: "CANCELLED" },
        OR: [
          { setupAt: { gte: from, lt: to } },
          { startsAt: { gte: from, lt: to } },
          { endsAt: { gte: from, lt: to } },
          { strikeAt: { gte: from, lt: to } },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 200,
      include: { client: { select: { name: true, company: true } } },
    }),
    db.eventTask.findMany({
      where: {
        event: { organizationId, status: { not: "CANCELLED" } },
        completedAt: null,
        dueAt: { gte: from, lt: to },
      },
      orderBy: { dueAt: "asc" },
      take: 300,
      include: { event: { select: { id: true, name: true } } },
    }),
    db.clientPayment.findMany({
      where: { organizationId, paidAt: { gte: from, lt: to } },
      orderBy: { paidAt: "asc" },
      take: 300,
      include: {
        client: { select: { name: true, company: true } },
        budget: { select: { title: true } },
      },
    }),
    db.supplierJob.findMany({
      where: {
        organizationId,
        status: { not: "CANCELLED" },
        OR: [
          { dueAt: { gte: from, lt: to } },
          { deliveredAt: { gte: from, lt: to } },
          { paidAt: { gte: from, lt: to } },
        ],
      },
      orderBy: { dueAt: "asc" },
      take: 200,
      include: {
        supplier: { select: { name: true } },
        event: { select: { id: true, name: true } },
      },
    }),
  ]);

  const items: AdminCalendarItem[] = [];

  for (const event of events) {
    if (event.setupAt && event.setupAt >= from && event.setupAt < to) items.push(eventItem("setup", event, event.setupAt));
    const startsAt = event.startsAt ?? event.endsAt;
    if (startsAt && startsAt >= from && startsAt < to) items.push(eventItem("event", event, startsAt));
    if (
      event.endsAt &&
      event.startsAt &&
      dayKeyOf(event.endsAt) !== dayKeyOf(event.startsAt) &&
      event.endsAt >= from &&
      event.endsAt < to
    ) {
      items.push(eventItem("event_end", event, event.endsAt));
    }
    if (event.strikeAt && event.strikeAt >= from && event.strikeAt < to) items.push(eventItem("strike", event, event.strikeAt));
  }

  for (const payment of payments) {
    items.push({
      id: `collection:${payment.id}`,
      kind: "collection",
      date: dayKeyOf(payment.paidAt),
      at: payment.paidAt.toISOString(),
      endAt: null,
      endDate: null,
      title: clientLabel(payment.client),
      subtitle: joinParts([payment.budget?.title, payment.method]),
      href: "/finanzas",
      tone: "ok",
      tag: null,
      amount: payment.amount,
    });
  }

  for (const job of jobs) {
    const base = {
      title: job.supplier.name,
      subtitle: joinParts([job.description, job.event?.name]),
      href: "/finanzas",
      tag: job.status,
      amount: job.total,
    };
    if (job.dueAt && job.dueAt >= from && job.dueAt < to) {
      items.push({
        ...base,
        id: `supplier_due:${job.id}`,
        kind: "supplier_due",
        date: dayKeyOf(job.dueAt),
        at: job.dueAt.toISOString(),
        endAt: null,
        endDate: null,
        tone: job.status === "PAID" ? "neutral" : "warn",
      });
    }
    if (job.deliveredAt && job.deliveredAt >= from && job.deliveredAt < to) {
      items.push({
        ...base,
        id: `supplier_delivery:${job.id}`,
        kind: "supplier_delivery",
        date: dayKeyOf(job.deliveredAt),
        at: job.deliveredAt.toISOString(),
        endAt: null,
        endDate: null,
        tone: "info",
      });
    }
    if (job.paidAt && job.paidAt >= from && job.paidAt < to) {
      items.push({
        ...base,
        id: `supplier_payment:${job.id}`,
        kind: "supplier_payment",
        date: dayKeyOf(job.paidAt),
        at: job.paidAt.toISOString(),
        endAt: null,
        endDate: null,
        tone: "ok",
      });
    }
  }

  for (const task of tasks) {
    if (!task.dueAt) continue;
    items.push({
      id: `task:${task.id}`,
      kind: "task",
      date: dayKeyOf(task.dueAt),
      at: task.dueAt.toISOString(),
      endAt: null,
      endDate: null,
      title: task.title,
      subtitle: task.event.name,
      href: "/eventos",
      tone: task.dueAt.getTime() < now.getTime() ? "danger" : "info",
      tag: task.type,
      amount: null,
    });
  }

  items.sort((a, b) => (a.at === b.at ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.at.localeCompare(b.at)));

  // ── Alertas (relativas a hoy, sin depender del rango consultado) ──────────
  const soonLimit = new Date(now.getTime() + ALERT_WINDOW_DAYS * DAY_MS);
  const [openTasks, openJobs, incompleteEvents] = await Promise.all([
    db.eventTask.findMany({
      where: {
        event: { organizationId, status: { not: "CANCELLED" } },
        completedAt: null,
        dueAt: { not: null, lte: soonLimit },
      },
      orderBy: { dueAt: "asc" },
      take: 50,
      include: { event: { select: { id: true, name: true } } },
    }),
    db.supplierJob.findMany({
      where: {
        organizationId,
        status: { notIn: ["PAID", "CANCELLED"] },
        dueAt: { not: null, lte: soonLimit },
      },
      orderBy: { dueAt: "asc" },
      take: 50,
      include: { supplier: { select: { name: true } }, event: { select: { id: true, name: true } } },
    }),
    db.event.findMany({
      where: {
        organizationId,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        startsAt: { not: null, gte: new Date(now.getTime() - DAY_MS), lte: soonLimit },
        tasks: { some: { completedAt: null } },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
      include: {
        client: { select: { name: true, company: true } },
        tasks: { where: { completedAt: null }, select: { id: true } },
      },
    }),
  ]);

  const alerts: AdminCalendarAlert[] = [];

  for (const task of openTasks) {
    if (!task.dueAt) continue;
    alerts.push({
      id: `task:${task.id}`,
      level: task.dueAt.getTime() < now.getTime() ? "overdue" : "soon",
      kind: "task",
      title: task.title,
      subtitle: task.event.name,
      date: dayKeyOf(task.dueAt),
      href: "/eventos",
    });
  }

  for (const job of openJobs) {
    if (!job.dueAt) continue;
    alerts.push({
      id: `supplier_due:${job.id}`,
      level: job.dueAt.getTime() < now.getTime() ? "overdue" : "soon",
      kind: "supplier_due",
      title: job.supplier.name,
      subtitle: joinParts([job.description, job.event?.name]),
      date: dayKeyOf(job.dueAt),
      href: "/finanzas",
    });
  }

  for (const event of incompleteEvents) {
    if (!event.startsAt) continue;
    alerts.push({
      id: `checklist:${event.id}`,
      level: event.startsAt.getTime() < now.getTime() + DAY_MS ? "overdue" : "soon",
      kind: "checklist",
      title: event.name,
      subtitle: joinParts([clientLabel(event.client), `${event.tasks.length} tareas pendientes`]),
      date: dayKeyOf(event.startsAt),
      href: "/eventos",
    });
  }

  alerts.sort((a, b) => (a.level === b.level ? a.date.localeCompare(b.date) : a.level === "overdue" ? -1 : 1));

  return Response.json({ items, alerts, range: { from: fromKey, to: toKey } });
}
