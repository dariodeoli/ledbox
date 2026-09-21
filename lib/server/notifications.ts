import { db } from "./db";
import type {
  AdminCalendarAlert,
  AdminCalendarAlertKind,
  AdminCalendarAlertLevel,
  AdminNotification,
  AdminNotificationCounts,
  AdminNotificationKind,
  AdminNotificationLevel,
} from "@/lib/admin-types";

/**
 * Avisos operativos del panel: fuente única de `/api/admin/notifications` y de
 * las alertas de `/api/admin/calendar` (mismos ids, niveles, fechas y orden).
 *
 * Cada aviso nace de un hecho real con fecha real; no se inventan estados ni
 * recordatorios:
 * - `task`: `EventTask.dueAt` pendiente de un evento no cancelado.
 * - `supplier_due`: `SupplierJob.dueAt` de un trabajo abierto (ni pagado ni cancelado).
 * - `checklist`: evento próximo (ni cancelado ni finalizado) con tareas pendientes.
 * - `collection`: presupuesto aprobado con saldo, con la validez como fecha.
 * - `lead`: lead sin contactar (`Lead.status = NEW`).
 * - `portal_request`: solicitud del cliente en el portal sin resolver
 *   (`BudgetChangeRequest.status = pending`, issue #14); la fecha es el día en
 *   que el cliente la mandó y el aviso desaparece cuando el equipo la resuelve.
 *
 * El calendario consume solo los tres primeros (`calendarAlerts`) y las
 * notificaciones suman los informativos, deduplican por entidad y día, ordenan
 * por urgencia y recortan a `NOTIFICATION_LIMIT`.
 */

// ── Días de Asunción ────────────────────────────────────────────────────────
// Paraguay no aplica horario de verano desde 2024, pero el offset se calcula
// igual con Intl para no romperse si la regla cambia (los rangos se resuelven con
// las 00:00 locales, no con la medianoche UTC del servidor).

const TIME_ZONE = "America/Asuncion";

export const DAY_MS = 86_400_000;
export const NOTIFICATION_WINDOW_DAYS = 7;
export const NOTIFICATION_LIMIT = 20;

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
export function dayKeyOf(date: Date): string {
  const { year, month, day } = zoneParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Offset de Asunción contra UTC para un instante dado. */
function zoneOffsetMs(instant: Date): number {
  const { year, month, day, hour, minute, second } = zoneParts(instant);
  return Date.UTC(year, month - 1, day, hour, minute, second) - instant.getTime();
}

/** Instante UTC de las 00:00 de un día de Asunción. */
export function dayStart(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const firstGuess = utcMidnight - zoneOffsetMs(new Date(utcMidnight));
  // Segundo ajuste por si el offset cambió al convertir.
  return new Date(utcMidnight - zoneOffsetMs(new Date(firstGuess)));
}

/** Día siguiente a una clave `YYYY-MM-DD` (a límite exclusivo). */
export function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Último día del mes de una clave `YYYY-MM-DD`. */
export function monthEndKey(dayKey: string): string {
  const [year, month] = dayKey.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
}

// ── Normalización compartida ────────────────────────────────────────────────

export function clientLabel(client: { name: string; company: string | null }): string {
  return client.company?.trim() || client.name;
}

export function joinParts(parts: Array<string | null | undefined>): string | null {
  const text = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(" · ");
  return text || null;
}

const pygFormat = new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 });

/** Monto PYG para textos del API (el resto de los avisos no lleva importes). */
function formatPyg(value: number): string {
  return pygFormat.format(value);
}

// ── Candidatos ──────────────────────────────────────────────────────────────

type CalendarAlertCandidate = AdminNotification & { kind: AdminCalendarAlertKind; level: AdminCalendarAlertLevel };

function isCalendarAlert(candidate: AdminNotification): candidate is CalendarAlertCandidate {
  const sharedKind =
    candidate.kind === "task" || candidate.kind === "supplier_due" || candidate.kind === "checklist";
  return sharedKind && candidate.level !== "info";
}

/**
 * Hechos que el calendario ya alertaba: tareas por vencer, trabajos de proveedor
 * abiertos y eventos próximos con checklist incompleto (ventana de 7 días).
 */
async function coreCandidates(organizationId: string, now: Date): Promise<AdminNotification[]> {
  const soonLimit = new Date(now.getTime() + NOTIFICATION_WINDOW_DAYS * DAY_MS);
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

  const candidates: AdminNotification[] = [];

  for (const task of openTasks) {
    if (!task.dueAt) continue;
    candidates.push({
      id: `task:${task.id}`,
      kind: "task",
      level: task.dueAt.getTime() < now.getTime() ? "overdue" : "soon",
      title: task.title,
      subtitle: task.event.name,
      date: dayKeyOf(task.dueAt),
      href: "/eventos",
    });
  }

  for (const job of openJobs) {
    if (!job.dueAt) continue;
    candidates.push({
      id: `supplier_due:${job.id}`,
      kind: "supplier_due",
      level: job.dueAt.getTime() < now.getTime() ? "overdue" : "soon",
      title: job.supplier.name,
      subtitle: joinParts([job.description, job.event?.name]),
      date: dayKeyOf(job.dueAt),
      href: "/finanzas",
    });
  }

  for (const event of incompleteEvents) {
    if (!event.startsAt) continue;
    candidates.push({
      id: `checklist:${event.id}`,
      kind: "checklist",
      level: event.startsAt.getTime() < now.getTime() + DAY_MS ? "overdue" : "soon",
      title: event.name,
      subtitle: joinParts([clientLabel(event.client), `${event.tasks.length} tareas pendientes`]),
      date: dayKeyOf(event.startsAt),
      href: "/eventos",
    });
  }

  return candidates;
}

/** Cómo se nombra cada solicitud del portal en el feed de avisos. */
const PORTAL_REQUEST_KIND: Record<string, string> = {
  items: "propuesta de ítems",
  discount: "pedido de rebaja",
  changes: "pedido de cambios",
};

/**
 * Hechos informativos que solo muestra el módulo de avisos: leads sin contactar,
 * presupuestos aprobados con saldo y solicitudes del portal sin resolver. La
 * fecha del cobro es la validez del presupuesto (`validUntil`) y, si no tiene,
 * el día en que se cargó; la de una solicitud, el día en que la mandó el cliente.
 */
async function extraCandidates(organizationId: string, now: Date): Promise<AdminNotification[]> {
  const soonKey = dayKeyOf(new Date(now.getTime() + NOTIFICATION_WINDOW_DAYS * DAY_MS));
  const todayKey = dayKeyOf(now);
  const [leads, budgets, portalRequests] = await Promise.all([
    db.lead.findMany({
      where: { organizationId, status: "NEW" },
      orderBy: { createdAt: "asc" },
      take: NOTIFICATION_LIMIT,
      select: { id: true, name: true, company: true, phone: true, createdAt: true },
    }),
    db.budget.findMany({
      where: { organizationId, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        title: true,
        total: true,
        validUntil: true,
        createdAt: true,
        client: { select: { name: true, company: true } },
        payments: { select: { amount: true } },
      },
    }),
    db.budgetChangeRequest.findMany({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "asc" },
      take: NOTIFICATION_LIMIT,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        requestedByName: true,
        budget: { select: { title: true, client: { select: { name: true, company: true } } } },
      },
    }),
  ]);

  const candidates: AdminNotification[] = [];

  for (const lead of leads) {
    candidates.push({
      id: `lead:${lead.id}`,
      kind: "lead",
      level: "info",
      title: lead.name,
      subtitle: joinParts([lead.company, lead.phone]),
      date: dayKeyOf(lead.createdAt),
      href: "/leads",
    });
  }

  for (const budget of budgets) {
    const paid = budget.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = Math.max(0, budget.total - paid);
    if (balance <= 0) continue;
    const validKey = budget.validUntil ? dayKeyOf(budget.validUntil) : null;
    const level: AdminNotificationLevel = !validKey
      ? "info"
      : validKey < todayKey
        ? "overdue"
        : validKey <= soonKey
          ? "soon"
          : "info";
    candidates.push({
      id: `collection:${budget.id}`,
      kind: "collection",
      level,
      title: clientLabel(budget.client),
      subtitle: joinParts([budget.title, `saldo ${formatPyg(balance)}`]),
      date: validKey ?? dayKeyOf(budget.createdAt),
      href: "/presupuestos",
    });
  }

  for (const request of portalRequests) {
    candidates.push({
      id: `portal_request:${request.id}`,
      kind: "portal_request",
      level: "info",
      title: clientLabel(request.budget.client),
      subtitle: joinParts([request.budget.title, PORTAL_REQUEST_KIND[request.kind] ?? "Solicitud del portal"]),
      date: dayKeyOf(request.createdAt),
      href: "/presupuestos",
    });
  }

  return candidates;
}

// ── Orden, deduplicación y recorte ──────────────────────────────────────────

const LEVEL_ORDER: Record<AdminNotificationLevel, number> = { overdue: 0, soon: 1, info: 2 };

/** Mismo orden que las alertas del calendario: tareas, proveedores y checklist. */
const KIND_ORDER: Record<AdminNotificationKind, number> = {
  task: 0,
  supplier_due: 1,
  checklist: 2,
  collection: 3,
  lead: 4,
  portal_request: 5,
};

/** Urgencia primero (vencido → próximo → informativo) y, dentro de cada nivel, por fecha. */
function compareNotifications(a: AdminNotification, b: AdminNotification): number {
  return (
    LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
    a.date.localeCompare(b.date) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  );
}

/**
 * Sin duplicados por día: el id identifica la entidad (`kind:entityId`), así que
 * se colapsa por entidad + día y sobrevive el candidato de mayor urgencia (los
 * urgentes se arman primero). También cubre el caso de un evento que podría
 * aparecer como checklist y como evento el mismo día.
 */
function dedupeByEntityAndDay(candidates: AdminNotification[]): AdminNotification[] {
  const unique = new Map<string, AdminNotification>();
  for (const candidate of candidates) {
    const entityId = candidate.id.slice(candidate.id.indexOf(":") + 1);
    const key = `${candidate.date}:${entityId}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

// ── Contratos ───────────────────────────────────────────────────────────────

/**
 * Alertas del calendario (`AdminCalendarAlert[]`, contrato estable): solo los
 * hechos vencidos o próximos que ya exponía, ordenados igual que antes.
 */
export async function calendarAlerts(organizationId: string, now = new Date()): Promise<AdminCalendarAlert[]> {
  const candidates = (await coreCandidates(organizationId, now)).sort(compareNotifications);
  return candidates.flatMap((candidate) =>
    isCalendarAlert(candidate)
      ? [
          {
            id: candidate.id,
            level: candidate.level,
            kind: candidate.kind,
            title: candidate.title,
            subtitle: candidate.subtitle,
            date: candidate.date,
            href: candidate.href,
          },
        ]
      : [],
  );
}

/**
 * Feed de avisos del panel: hechos reales normalizados, ordenados por urgencia,
 * sin duplicados por día y recortados a `NOTIFICATION_LIMIT`. Los totales son
 * del feed completo (no del recorte) para que la campana no mienta.
 */
export async function listAdminNotifications(
  organizationId: string,
  now = new Date(),
): Promise<{ notifications: AdminNotification[]; notificationCounts: AdminNotificationCounts }> {
  const [core, extras] = await Promise.all([
    coreCandidates(organizationId, now),
    extraCandidates(organizationId, now),
  ]);
  const sorted = dedupeByEntityAndDay([...core, ...extras]).sort(compareNotifications);
  const notificationCounts: AdminNotificationCounts = { overdue: 0, soon: 0, info: 0, total: sorted.length };
  for (const notification of sorted) notificationCounts[notification.level] += 1;
  return { notifications: sorted.slice(0, NOTIFICATION_LIMIT), notificationCounts };
}
