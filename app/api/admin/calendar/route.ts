import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import {
  DAY_MS,
  calendarAlerts,
  clientLabel,
  dayKeyOf,
  dayStart,
  isValidDayKey,
  joinParts,
  monthEndKey,
  nextDayKey,
} from "@/lib/server/notifications";
import type { AdminCalendarItem, AdminCalendarItemKind } from "@/lib/admin-types";

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
 * `EventTask.dueAt`, `ClientPayment.paidAt` de los cobros cobrados y
 * `ClientPayment.dueAt` de los cobros a plazo pendientes —issue #16—,
 * `SupplierJob.dueAt/deliveredAt/paidAt`) ubicado en el día de Asunción en que
 * ocurre. Las tareas ya cumplidas no se listan: el calendario muestra lo que
 * todavía requiere acción y su historial vive en el módulo de Eventos.
 *
 * Las `alerts` se arman en `lib/server/notifications.ts`, la misma fuente que
 * `GET /api/admin/notifications`; su contrato no cambió (mismos ids, niveles,
 * fechas y orden).
 */

const MAX_RANGE_DAYS = 400;

const KIND_ORDER: Record<AdminCalendarItemKind, number> = {
  setup: 0,
  task: 1,
  event: 2,
  event_end: 3,
  strike: 4,
  supplier_due: 5,
  supplier_delivery: 6,
  collection: 7,
  collection_due: 8,
  supplier_payment: 9,
};

// ── Normalización ───────────────────────────────────────────────────────────

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

  const [events, tasks, payments, pendingCollections, jobs] = await Promise.all([
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
      where: { organizationId, status: "RECEIVED", paidAt: { gte: from, lt: to } },
      orderBy: { paidAt: "asc" },
      take: 300,
      include: {
        client: { select: { name: true, company: true } },
        budget: { select: { title: true } },
      },
    }),
    db.clientPayment.findMany({
      where: { organizationId, status: "PENDING", dueAt: { gte: from, lt: to } },
      orderBy: { dueAt: "asc" },
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
    if (!payment.paidAt) continue;
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

  // Cobros a plazo pendientes: el marcador es el `dueAt` real y avisa en rojo si
  // el día de Asunción del vencimiento ya pasó (issue #16).
  for (const payment of pendingCollections) {
    if (!payment.dueAt) continue;
    items.push({
      id: `collection_due:${payment.id}`,
      kind: "collection_due",
      date: dayKeyOf(payment.dueAt),
      at: payment.dueAt.toISOString(),
      endAt: null,
      endDate: null,
      title: clientLabel(payment.client),
      subtitle: joinParts([
        payment.budget?.title,
        payment.method,
        payment.invoiceNumber ? `factura ${payment.invoiceNumber}` : null,
      ]),
      href: "/finanzas",
      tone: dayKeyOf(payment.dueAt) < today ? "danger" : "warn",
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
  // Misma fuente que el feed de avisos (`lib/server/notifications.ts`): tareas
  // pendientes, trabajos de proveedor abiertos y eventos próximos con checklist
  // incompleto, vencidos o dentro de los próximos 7 días.
  const alerts = await calendarAlerts(organizationId, now);

  return Response.json({ items, alerts, range: { from: fromKey, to: toKey } });
}
