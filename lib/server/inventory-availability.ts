import { randomUUID } from "node:crypto";
import { Prisma, type InventoryStatus } from "@prisma/client";
import { db } from "./db";
import { recordAudit, type AuditContext } from "./audit";

/**
 * Fuente única de la disponibilidad del inventario (issue #18).
 *
 * La regla de solape y el cálculo de unidades libres vivían en
 * `app/api/admin/inventory/route.ts`; acá se extraen para que las usen el
 * inventario, la reserva automática al aprobar un presupuesto y la sugerencia de
 * sustitutos. Ningún endpoint reimplementa el cálculo.
 *
 * Reglas (las mismas de siempre):
 * - El rango efectivo de una asignación es el propio y, si falta, el del evento
 *   (montaje → desmontaje); un rango sin fechas se trata como abierto.
 * - El solape es inclusivo y una asignación sin fechas ocupa siempre.
 * - Los ítems en mantenimiento o retirados no se pueden asignar (0 libres).
 * - El stock libre nunca es negativo: una sobreasignación previa se reporta como
 *   conflicto, no como disponibilidad negativa.
 */

export const BLOCKED_INVENTORY_STATUSES: readonly InventoryStatus[] = ["MAINTENANCE", "RETIRED"];

/** Máximo de asignaciones que se cargan para calcular disponibilidad. */
export const MAX_AVAILABILITY_ASSIGNMENTS = 500;

/**
 * Contador de unidades en mantenimiento (issue #112): una unidad en
 * mantenimiento o retirada no está libre. Va como `_count` de la relación
 * `units` para no traer las unidades enteras al calcular disponibilidad.
 */
export const MAINTENANCE_UNITS_SELECT = {
  units: { where: { status: "MAINTENANCE" } },
} satisfies Prisma.InventoryItemCountOutputTypeSelect;

/** Unidades en mantenimiento de un ítem con `_count` (0 si no vino el conteo). */
export function maintenanceUnits(item: { _count?: { units?: number } | null }): number {
  return item._count?.units ?? 0;
}

export const EVENT_RANGE_SELECT = {
  id: true,
  name: true,
  startsAt: true,
  endsAt: true,
  setupAt: true,
  strikeAt: true,
} as const;

export type EventRangeRef = {
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  setupAt: Date | null;
  strikeAt: Date | null;
};

export type AssignmentRecord = {
  id: string;
  inventoryId: string;
  quantity: number;
  startsAt: Date | null;
  endsAt: Date | null;
  event: EventRangeRef;
};

/** Ítem mínimo para calcular disponibilidad (no hace falta la fila completa). */
export type AvailabilityItem = {
  id: string;
  name: string;
  quantity: number;
  status: InventoryStatus;
  /** Unidades en mantenimiento (issue #112): se descuentan del stock libre. */
  maintenance: number;
};

export type AvailabilityConflict = {
  id: string;
  eventId: string;
  eventName: string;
  quantity: number;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type RangeAvailability = {
  inventoryId: string;
  name: string;
  status: InventoryStatus;
  total: number;
  committed: number;
  /** Unidades en mantenimiento del ítem (issue #112). */
  maintenance: number;
  available: number;
  blocked: boolean;
  startsAt: Date;
  endsAt: Date;
  conflicts: AvailabilityConflict[];
};

const rangeFormat = new Intl.DateTimeFormat("es-PY", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Fecha de un parámetro de query; `null` si falta o es inválida. */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Rango legible para mensajes: `09-oct. 08:00 → 12-oct. 20:00`. */
export function rangeLabel(startsAt: Date, endsAt: Date): string {
  return `${rangeFormat.format(startsAt)} → ${rangeFormat.format(endsAt)}`;
}

/**
 * ¿La asignación compromete unidades ahora? Devuelta no cuenta; el rango
 * efectivo es el propio y, si falta, el del evento (`assignmentRange`), así que
 * una asignación sin fechas propias sigue el montaje/desmontaje del evento y una
 * sin fechas en ninguno de los dos ocupa siempre.
 *
 * La usan la lista de inventario y su selector (issue #62): la columna «Libres
 * ahora» y el selector muestran el mismo número.
 */
export function assignmentIsActiveNow(
  row: Pick<AssignmentRecord, "startsAt" | "endsAt" | "event"> & { checkedIn: boolean; checkedInAt: Date | null },
  now: Date,
): boolean {
  if (row.checkedInAt || row.checkedIn) return false;
  const { start, end } = assignmentRange(row);
  if (!start && !end) return true;
  if (start && start.getTime() > now.getTime()) return false;
  if (end && end.getTime() < now.getTime()) return false;
  return true;
}

/** Rango efectivo de una asignación: el propio y, si falta, el del evento. */
export function assignmentRange(assignment: {
  startsAt: Date | null;
  endsAt: Date | null;
  event: EventRangeRef;
}): { start: Date | null; end: Date | null } {
  const start = assignment.startsAt ?? assignment.event.setupAt ?? assignment.event.startsAt;
  const end = assignment.endsAt ?? assignment.event.strikeAt ?? assignment.event.endsAt ?? start;
  return { start, end };
}

/** Solape inclusivo: un rango sin fechas se trata como abierto (conservador). */
export function overlaps(startA: Date | null, endA: Date | null, startB: Date, endB: Date): boolean {
  if (endA && endA.getTime() < startB.getTime()) return false;
  if (startA && startA.getTime() > endB.getTime()) return false;
  return true;
}

/**
 * Rango comprometido del evento (montaje → desmontaje), el que usa la reserva.
 * `endsAt` es `null` cuando el evento no tiene fin (desmontaje o fin): la reserva
 * queda pendiente en vez de inventar una fecha.
 */
export function eventReservationRange(event: {
  setupAt: Date | null;
  startsAt: Date | null;
  strikeAt: Date | null;
  endsAt: Date | null;
}): { startsAt: Date; endsAt: Date | null } | null {
  const startsAt = event.setupAt ?? event.startsAt;
  if (!startsAt) return null;
  const endsAt = event.strikeAt ?? event.endsAt;
  return { startsAt, endsAt: endsAt && endsAt.getTime() >= startsAt.getTime() ? endsAt : null };
}

/** Cliente de lectura: el global o el de una transacción. */
export type AvailabilityClient = Prisma.TransactionClient | typeof db;

/**
 * Filtro de `event` para las asignaciones que **comprometen** stock. Un evento
 * cancelado libera su stock y un evento cuyos presupuestos están todos perdidos
 * o cancelados también (sin presupuestos, la asignación es manual y cuenta).
 */
export function committedEventWhere(organizationId: string): Prisma.EventWhereInput {
  return {
    organizationId,
    status: { not: "CANCELLED" },
    OR: [{ budgets: { none: {} } }, { budgets: { some: { status: { notIn: ["LOST", "CANCELLED"] } } } }],
  };
}

/**
 * Asignaciones que comprometen stock. Un equipo que ya salió y no volvió
 * (`checkedOut` sin `checkedIn`) cuenta SIEMPRE: está físicamente afuera aunque el
 * evento se haya cancelado o su presupuesto se haya perdido.
 */
export function committedAssignmentWhere(organizationId: string): Prisma.EventInventoryWhereInput {
  return {
    event: { organizationId },
    OR: [
      { checkedOut: true, checkedIn: false, checkedInAt: null },
      { event: committedEventWhere(organizationId) },
    ],
  };
}

/** Asignaciones de un ítem en la empresa (opcionalmente sin una fila puntual). */
export async function loadAssignments(
  inventoryId: string,
  organizationId: string,
  excludeId?: string | null,
  client: AvailabilityClient = db,
): Promise<AssignmentRecord[]> {
  return client.eventInventory.findMany({
    where: {
      inventoryId,
      ...committedAssignmentWhere(organizationId),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { startsAt: "asc" },
    take: MAX_AVAILABILITY_ASSIGNMENTS,
    include: { event: { select: EVENT_RANGE_SELECT } },
  });
}

/**
 * Disponibilidad de un ítem en un rango: unidades comprometidas por asignaciones
 * que se solapan, libres reales y el detalle de cada rango comprometido.
 */
export function buildAvailability(
  item: AvailabilityItem,
  rows: ReadonlyArray<AssignmentRecord>,
  startsAt: Date,
  endsAt: Date,
): RangeAvailability {
  const conflicts = rows
    .filter((row) => {
      const { start, end } = assignmentRange(row);
      return overlaps(start, end, startsAt, endsAt);
    })
    .map((row) => {
      const { start, end } = assignmentRange(row);
      return {
        id: row.id,
        eventId: row.event.id,
        eventName: row.event.name,
        quantity: row.quantity,
        startsAt: start,
        endsAt: end,
      };
    });
  const committed = conflicts.reduce((sum, conflict) => sum + conflict.quantity, 0);
  const blocked = BLOCKED_INVENTORY_STATUSES.includes(item.status);
  // El stock libre descuenta las unidades en mantenimiento (issue #112): no se
  // pueden asignar aunque el ítem esté disponible.
  const usable = Math.max(0, item.quantity - item.maintenance);
  return {
    inventoryId: item.id,
    name: item.name,
    status: item.status,
    total: item.quantity,
    committed,
    maintenance: item.maintenance,
    available: blocked ? 0 : Math.max(0, usable - committed),
    blocked,
    startsAt,
    endsAt,
    conflicts,
  };
}

/** Disponibilidad de un ítem en un rango, cargando sus asignaciones. */
export async function availabilityForRange(options: {
  organizationId: string;
  item: AvailabilityItem;
  startsAt: Date;
  endsAt: Date;
  excludeId?: string | null;
  client?: AvailabilityClient;
}): Promise<RangeAvailability> {
  const rows = await loadAssignments(options.item.id, options.organizationId, options.excludeId, options.client);
  return buildAvailability(options.item, rows, options.startsAt, options.endsAt);
}

// ── Compromiso atómico de stock ───────────────────────────────────────────────
// Leer la disponibilidad y escribir sin lock deja pasar dos asignaciones
// concurrentes. Todo compromiso de stock (asignación manual, event-ops y reserva
// al aprobar) toma `FOR UPDATE` sobre las filas de InventoryItem involucradas,
// en orden de id (sin deadlocks), y recalcula la disponibilidad con el cliente de
// la transacción antes de escribir.

const OPEN_RANGE_START = new Date(-8.64e15);
const OPEN_RANGE_END = new Date(8.64e15);

/** Bloquea las filas de la empresa, ordenadas por id. Devuelve los ids que existen. */
export async function lockInventoryItems(
  tx: Prisma.TransactionClient,
  organizationId: string,
  inventoryIds: ReadonlyArray<string>,
): Promise<Set<string>> {
  const ids = [...new Set(inventoryIds)].sort();
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "InventoryItem" WHERE "organizationId" = ${organizationId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`,
  );
  return new Set(rows.map((row) => row.id));
}

export type CommitAssignmentResult =
  | { ok: true; assignment: AssignmentWrite; previous: { id: string; quantity: number; startsAt: Date | null; endsAt: Date | null } | null; item: { id: string; name: string }; event: { id: string; name: string } }
  | { ok: false; reason: "event-missing" }
  | { ok: false; reason: "item-missing" }
  | { ok: false; reason: "blocked"; item: { id: string; name: string; status: InventoryStatus } }
  | { ok: false; reason: "insufficient"; quantity: number; item: { id: string; name: string }; availability: RangeAvailability; open: boolean };

type AssignmentWrite = { id: string; eventId: string; inventoryId: string; quantity: number; startsAt: Date | null; endsAt: Date | null };

/**
 * Compromete `quantity` unidades de un ítem para un evento, de forma atómica.
 * `startsAt`/`endsAt` `undefined` = no tocar el rango propio de la asignación (se
 * valida contra el de la fila existente o el del evento; sin ninguno, el rango
 * es abierto y ocupa siempre, como el resto del módulo).
 */
export async function commitInventoryAssignment(options: {
  organizationId: string;
  eventId: string;
  inventoryId: string;
  quantity: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
}): Promise<CommitAssignmentResult> {
  return db.$transaction(
    async (tx) => {
      const locked = await lockInventoryItems(tx, options.organizationId, [options.inventoryId]);
      const [event, item] = await Promise.all([
        tx.event.findFirst({ where: { id: options.eventId, organizationId: options.organizationId }, select: EVENT_RANGE_SELECT }),
        locked.has(options.inventoryId)
          ? tx.inventoryItem.findFirst({
              where: { id: options.inventoryId, organizationId: options.organizationId },
              omit: { imageData: true },
              include: { _count: { select: MAINTENANCE_UNITS_SELECT } },
            })
          : null,
      ]);
      if (!event) return { ok: false, reason: "event-missing" } as const;
      if (!item) return { ok: false, reason: "item-missing" } as const;
      if (BLOCKED_INVENTORY_STATUSES.includes(item.status)) {
        return { ok: false, reason: "blocked", item: { id: item.id, name: item.name, status: item.status } } as const;
      }

      const previous = await tx.eventInventory.findUnique({
        where: { eventId_inventoryId: { eventId: event.id, inventoryId: item.id } },
        select: { id: true, quantity: true, startsAt: true, endsAt: true },
      });
      const effective = {
        start: options.startsAt === undefined ? (previous?.startsAt ?? event.setupAt ?? event.startsAt) : (options.startsAt ?? event.setupAt ?? event.startsAt),
        end:
          options.endsAt === undefined
            ? (previous?.endsAt ?? event.strikeAt ?? event.endsAt)
            : (options.endsAt ?? event.strikeAt ?? event.endsAt),
      };
      const open = !effective.start || !effective.end;
      const checkStart = effective.start ?? OPEN_RANGE_START;
      const checkEnd = effective.end ?? OPEN_RANGE_END;

      const availability = await availabilityForRange({
        organizationId: options.organizationId,
        item: { ...item, maintenance: maintenanceUnits(item) },
        startsAt: checkStart,
        endsAt: checkEnd,
        excludeId: previous?.id ?? null,
        client: tx,
      });
      if (options.quantity > availability.available) {
        return {
          ok: false,
          reason: "insufficient",
          quantity: options.quantity,
          item: { id: item.id, name: item.name },
          availability,
          open,
        } as const;
      }

      const rangeData = {
        ...(options.startsAt !== undefined ? { startsAt: options.startsAt } : {}),
        ...(options.endsAt !== undefined ? { endsAt: options.endsAt } : {}),
      };
      const assignment = await tx.eventInventory.upsert({
        where: { eventId_inventoryId: { eventId: event.id, inventoryId: item.id } },
        create: {
          id: randomUUID(),
          eventId: event.id,
          inventoryId: item.id,
          quantity: options.quantity,
          startsAt: options.startsAt ?? null,
          endsAt: options.endsAt ?? null,
        },
        update: { quantity: options.quantity, ...rangeData },
      });
      return {
        ok: true,
        assignment,
        previous,
        item: { id: item.id, name: item.name },
        event: { id: event.id, name: event.name },
      } as const;
    },
    { timeout: 15_000 },
  );
}

/** Mensaje 409 de «sin disponibilidad», igual para la asignación manual y event-ops. */
export function insufficientMessage(result: Extract<CommitAssignmentResult, { reason: "insufficient" }>): string {
  const { availability } = result;
  const detail = availability.conflicts.length
    ? ` En el rango: ${availability.conflicts.map((conflict) => `${conflict.eventName} (${conflict.quantity})`).join(", ")}.`
    : "";
  const where = result.open ? "sin fechas definidas (se toma como ocupado siempre)" : `entre ${rangeLabel(availability.startsAt, availability.endsAt)}`;
  return `Sin disponibilidad: pediste ${result.quantity} y hay ${availability.available} de ${availability.total} libres ${where}.${detail}`;
}

export type InventorySubstitute = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  status: InventoryStatus;
  total: number;
  committed: number;
  available: number;
  /** Cuántas asignaciones comprometidas se solapan en el rango. */
  conflicts: number;
};

/**
 * Sustitutos sugeridos: artículos de la **misma categoría** con stock libre en el
 * rango pedido, ordenados por cantidad libre (los más libres primero). El ítem
 * consultado nunca se sugiere a sí mismo y los que están en mantenimiento o
 * retirados no aparecen.
 */
export async function findSubstitutes(options: {
  organizationId: string;
  item: { id: string; category: string; status: InventoryStatus };
  startsAt: Date;
  endsAt: Date;
  limit?: number;
}): Promise<InventorySubstitute[]> {
  const limit = options.limit ?? 8;
  const candidates = await db.inventoryItem.findMany({
    where: { organizationId: options.organizationId, category: options.item.category, id: { not: options.item.id } },
    orderBy: { name: "asc" },
    take: 100,
    omit: { imageData: true },
    include: { _count: { select: MAINTENANCE_UNITS_SELECT } },
  });
  if (candidates.length === 0) return [];
  const rows = await db.eventInventory.findMany({
    where: {
      inventoryId: { in: candidates.map((candidate) => candidate.id) },
      ...committedAssignmentWhere(options.organizationId),
    },
    orderBy: { startsAt: "asc" },
    take: MAX_AVAILABILITY_ASSIGNMENTS * 4,
    include: { event: { select: EVENT_RANGE_SELECT } },
  });
  return candidates
    .flatMap((candidate) => {
      const availability = buildAvailability(
        { ...candidate, maintenance: maintenanceUnits(candidate) },
        rows.filter((row) => row.inventoryId === candidate.id),
        options.startsAt,
        options.endsAt,
      );
      if (availability.blocked || availability.available <= 0) return [];
      return [
        {
          id: candidate.id,
          name: candidate.name,
          sku: candidate.sku,
          category: candidate.category,
          status: candidate.status,
          total: availability.total,
          committed: availability.committed,
          available: availability.available,
          conflicts: availability.conflicts.length,
        },
      ];
    })
    .sort((a, b) => b.available - a.available || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ── Reserva automática al aprobar un presupuesto (issue #18) ──────────────────
// Reglas:
// - Solo los ítems con `inventoryId` reservan; el resto no toca el inventario.
// - El rango es el del evento (montaje → desmontaje); sin evento o sin fechas no
//   se reserva y queda pendiente de completar (se avisa, no se inventan fechas).
// - Nunca se superpone stock: se reserva lo libre real y el faltante se reporta
//   como conflicto, con los eventos que ocupan el rango y los sustitutos de la
//   misma categoría con stock libre.
// - Nunca se duplica una asignación: la fila es única por evento + ítem y se
//   actualiza solo si hace falta (una asignación existente nunca se achica).
// - Si la asignación ya tiene salida o devolución registrada, no se toca.
// - Toda reserva y todo conflicto quedan auditados con el actor real.

export type ReservationStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "conflict"
  | "blocked"
  | "missing-event"
  | "missing-range"
  | "in-movement";

export type ReservationOutcome = {
  /** Ítem del presupuesto que pidió la reserva. */
  itemId: string;
  itemName: string;
  /** Unidades pedidas por el presupuesto (la mayor si varios ítems apuntan al mismo artículo). */
  quantity: number;
  inventoryId: string;
  inventoryName: string;
  inventorySku: string | null;
  status: ReservationStatus;
  /** Unidades reservadas en el evento después de la operación. */
  reserved: number;
  available: number;
  total: number;
  conflicts: AvailabilityConflict[];
  substitutes: InventorySubstitute[];
  /** Motivo legible cuando la reserva no quedó completa. */
  reason: string | null;
};

export type BudgetReservation = {
  eventId: string | null;
  eventName: string | null;
  range: { startsAt: Date; endsAt: Date } | null;
  outcomes: ReservationOutcome[];
  /** Unidades pedidas por los ítems vinculados y unidades reservadas. */
  requested: number;
  reserved: number;
  /** Ítems vinculados con reserva incompleta o imposible. */
  conflicts: number;
  failed: boolean;
};

const EMPTY_RESERVATION: BudgetReservation = {
  eventId: null,
  eventName: null,
  range: null,
  outcomes: [],
  requested: 0,
  reserved: 0,
  conflicts: 0,
  failed: false,
};

type LinkedItem = {
  id: string;
  name: string;
  quantity: number;
  inventoryId: string;
  inventory: {
    id: string;
    name: string;
    sku: string | null;
    category: string;
    quantity: number;
    status: InventoryStatus;
    _count: { units: number };
  };
};

/**
 * Agrupa los ítems vinculados por artículo: si dos ítems del mismo presupuesto
 * apuntan al mismo equipo, la reserva es una sola con la mayor cantidad pedida
 * (reservar la suma duplicaría unidades que en realidad son las mismas).
 */
function groupLinkedItems(
  items: ReadonlyArray<LinkedItem>,
): Array<{ inventory: LinkedItem["inventory"]; quantity: number; names: string[]; itemIds: string[] }> {
  const grouped = new Map<string, { inventory: LinkedItem["inventory"]; quantity: number; names: string[]; itemIds: string[] }>();
  for (const item of items) {
    const current = grouped.get(item.inventoryId);
    if (current) {
      current.quantity = Math.max(current.quantity, item.quantity);
      current.names.push(item.name);
      current.itemIds.push(item.id);
      continue;
    }
    grouped.set(item.inventoryId, {
      inventory: item.inventory,
      quantity: item.quantity,
      names: [item.name],
      itemIds: [item.id],
    });
  }
  return [...grouped.values()];
}

type MovementState = { checkedOut: boolean; checkedOutAt: Date | null; checkedIn: boolean; checkedInAt: Date | null };

/** Una asignación con salida o devolución registrada es un movimiento vivo: no se toca. */
function inMovement(assignment: MovementState): boolean {
  return Boolean(assignment.checkedOutAt || assignment.checkedOut || assignment.checkedInAt || assignment.checkedIn);
}

/**
 * Reserva el stock de los ítems vinculados de un presupuesto aprobado. Nunca
 * lanza: si algo falla, devuelve `failed: true` para que la aprobación siga
 * (lo que no se haya reservado se completa a mano desde Eventos).
 */
export async function reserveBudgetInventory(options: {
  organizationId: string;
  budgetId: string;
  context: AuditContext;
}): Promise<BudgetReservation> {
  try {
    const budget = await db.budget.findFirst({
      where: { id: options.budgetId, organizationId: options.organizationId },
      select: {
        id: true,
        title: true,
        client: { select: { name: true, company: true } },
        event: { select: EVENT_RANGE_SELECT },
        items: {
          where: { inventoryId: { not: null }, excluded: false },
          select: {
            id: true,
            name: true,
            quantity: true,
            inventoryId: true,
            inventory: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                quantity: true,
                status: true,
                _count: { select: MAINTENANCE_UNITS_SELECT },
              },
            },
          },
        },
      },
    });
    if (!budget) return { ...EMPTY_RESERVATION };

    const linked = budget.items.filter((item): item is LinkedItem => Boolean(item.inventoryId && item.inventory));
    if (linked.length === 0) return { ...EMPTY_RESERVATION };

    const clientLabel = budget.client.company?.trim() || budget.client.name;
    const event = budget.event;
    const eventRange = event ? eventReservationRange(event) : null;
    // Sin rango completo no se reserva: el rango es montaje → desmontaje y una
    // punta faltante se pide (no se inventa).
    const range = eventRange && eventRange.endsAt ? { startsAt: eventRange.startsAt, endsAt: eventRange.endsAt } : null;
    const groups = groupLinkedItems(linked);
    const requested = groups.reduce((sum, group) => sum + group.quantity, 0);
    const outcomes: ReservationOutcome[] = [];

    // Fase atómica: lock de los ítems, disponibilidad recalculada con el cliente
    // de la transacción y escritura. Dos aprobaciones (o una aprobación y una
    // asignación manual) sobre el mismo equipo se serializan acá y no sobrevenden.
    // La aprobación no depende de esto: si falta stock queda «pendiente de reservar».
    type GroupCommit = {
      existing: { id: string; quantity: number; startsAt: Date | null; endsAt: Date | null } | null;
      movement: boolean;
      availability: RangeAvailability | null;
      reserved: number;
      assignment: AssignmentWrite | null;
    };
    const commits = new Map<string, GroupCommit>();
    let atomicPhaseFailed = false;
    if (event && range) {
      try {
      await db.$transaction(
        async (tx) => {
          await lockInventoryItems(tx, options.organizationId, groups.map((group) => group.inventory.id));
          for (const group of groups) {
            const fresh = await tx.inventoryItem.findFirst({
              where: { id: group.inventory.id, organizationId: options.organizationId },
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                quantity: true,
                status: true,
                _count: { select: MAINTENANCE_UNITS_SELECT },
              },
            });
            // Con el stock y el estado leídos bajo el lock (los del presupuesto pueden estar viejos).
            if (fresh) group.inventory = fresh;
            if (!fresh || BLOCKED_INVENTORY_STATUSES.includes(fresh.status)) continue;

            const existing = await tx.eventInventory.findUnique({
              where: { eventId_inventoryId: { eventId: event.id, inventoryId: fresh.id } },
              select: {
                id: true,
                quantity: true,
                startsAt: true,
                endsAt: true,
                checkedOut: true,
                checkedOutAt: true,
                checkedIn: true,
                checkedInAt: true,
              },
            });
            if (existing && inMovement(existing)) {
              commits.set(fresh.id, { existing, movement: true, availability: null, reserved: existing.quantity, assignment: null });
              continue;
            }

            const availability = await availabilityForRange({
              organizationId: options.organizationId,
              item: { ...fresh, maintenance: maintenanceUnits(fresh) },
              startsAt: range.startsAt,
              endsAt: range.endsAt,
              excludeId: existing?.id ?? null,
              client: tx,
            });
            // Nunca se achica una asignación existente: se completa hasta lo pedido,
            // sin pasar de lo que hay libre (lo ya reservado se mantiene).
            const kept = existing?.quantity ?? 0;
            const target = Math.max(group.quantity, kept);
            const reserved = Math.max(kept, Math.min(target, availability.available));
            const rangeChanged = existing
              ? existing.startsAt?.getTime() !== range.startsAt.getTime() || existing.endsAt?.getTime() !== range.endsAt.getTime()
              : false;
            // Nunca se crea una asignación en cero: sin unidades libres solo se reporta
            // el conflicto (y si ya había una reserva, esa se mantiene).
            const mustWrite = reserved > 0 && (!existing || existing.quantity !== reserved || rangeChanged);
            let assignment: AssignmentWrite | null = null;
            if (mustWrite) {
              assignment = existing
                ? await tx.eventInventory.update({
                    where: { id: existing.id },
                    data: { quantity: reserved, startsAt: range.startsAt, endsAt: range.endsAt },
                  })
                : await tx.eventInventory.create({
                    data: {
                      id: randomUUID(),
                      eventId: event.id,
                      inventoryId: fresh.id,
                      quantity: reserved,
                      startsAt: range.startsAt,
                      endsAt: range.endsAt,
                    },
                  });
            }
            commits.set(fresh.id, {
              existing: existing ? { id: existing.id, quantity: existing.quantity, startsAt: existing.startsAt, endsAt: existing.endsAt } : null,
              movement: false,
              availability,
              reserved,
              assignment,
            });
          }
        },
        { timeout: Math.min(60_000, 15_000 + groups.length * 100) },
      );
      } catch (error) {
        // La aprobación nunca se rompe: sin la fase atómica no se reservó nada
        // (la transacción hizo rollback) y todo queda pendiente de reservar.
        atomicPhaseFailed = true;
        commits.clear();
        console.error("[reserva] Falló la fase atómica de la reserva; queda pendiente:", error instanceof Error ? error.message : error);
      }
    }

    for (const group of groups) {
      const base: ReservationOutcome = {
        itemId: group.itemIds[0],
        itemName: group.names.join(" · "),
        quantity: group.quantity,
        inventoryId: group.inventory.id,
        inventoryName: group.inventory.name,
        inventorySku: group.inventory.sku,
        status: "unchanged",
        reserved: 0,
        available: 0,
        total: group.inventory.quantity,
        conflicts: [],
        substitutes: [],
        reason: null,
      };

      if (!event || !range) {
        outcomes.push({
          ...base,
          status: event ? "missing-range" : "missing-event",
          reason: !event
            ? "El presupuesto no tiene un evento asociado: asociá el evento y sus fechas para reservar."
            : !eventRange
              ? `El evento «${event.name}» no tiene fecha de montaje ni de inicio: definila para reservar (o asigná el equipo a mano desde Eventos).`
              : `El evento «${event.name}» no tiene fecha de desmontaje ni de fin: definila para reservar (o asigná el equipo a mano desde Eventos).`,
        });
        continue;
      }

      if (BLOCKED_INVENTORY_STATUSES.includes(group.inventory.status)) {
        outcomes.push({
          ...base,
          status: "blocked",
          reason: `«${group.inventory.name}» está ${group.inventory.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede reservar.`,
          substitutes: await findSubstitutes({
            organizationId: options.organizationId,
            item: { id: group.inventory.id, category: group.inventory.category, status: group.inventory.status },
            startsAt: range.startsAt,
            endsAt: range.endsAt,
          }),
        });
        continue;
      }

      const commit = commits.get(group.inventory.id);
      if (!commit && atomicPhaseFailed) {
        outcomes.push({
          ...base,
          status: "conflict",
          reason: `No se pudo reservar «${group.inventory.name}» por un error temporal: quedó pendiente de reservar, completalo desde Eventos.`,
        });
        continue;
      }
      if (!commit) {
        outcomes.push({ ...base, status: "blocked", reason: `«${group.inventory.name}» ya no está disponible para reservar.` });
        continue;
      }
      const { existing, availability, assignment } = commit;

      if (commit.movement && existing) {
        outcomes.push({
          ...base,
          status: "in-movement",
          reserved: existing.quantity,
          available: existing.quantity,
          reason: `La asignación de «${group.inventory.name}» en «${event.name}» ya tiene salida o devolución registrada: no se modificó.`,
        });
        continue;
      }
      if (!availability) continue;

      const reserved = commit.reserved;
      const shortfall = group.quantity - reserved;
      const substitutes = shortfall > 0
        ? await findSubstitutes({
            organizationId: options.organizationId,
            item: { id: group.inventory.id, category: group.inventory.category, status: group.inventory.status },
            startsAt: range.startsAt,
            endsAt: range.endsAt,
          })
        : [];

      let status: ReservationStatus = shortfall > 0 ? "conflict" : "unchanged";

      if (assignment) {
        await recordAudit({
          context: options.context,
          action: existing ? "update" : "create",
          entity: "EventInventory",
          entityId: assignment.id,
          summary: existing
            ? `Actualizó la reserva de «${group.inventory.name}» (${existing.quantity} → ${reserved} u.) en «${event.name}» al aprobar el presupuesto «${budget.title}»`
            : `Reservó «${group.inventory.name}» (${reserved} u.) para «${event.name}» al aprobar el presupuesto «${budget.title}»`,
          detail: existing
            ? {
                changes: {
                  quantity: { from: existing.quantity, to: reserved },
                  startsAt: { from: existing.startsAt, to: range.startsAt },
                  endsAt: { from: existing.endsAt, to: range.endsAt },
                },
              }
            : {
                fields: {
                  eventId: event.id,
                  inventoryId: group.inventory.id,
                  quantity: reserved,
                  startsAt: range.startsAt,
                  endsAt: range.endsAt,
                  budgetId: budget.id,
                },
              },
        });
        status = shortfall > 0 ? "conflict" : existing ? "updated" : "created";
      }

      outcomes.push({
        ...base,
        status,
        reserved,
        available: availability.available,
        conflicts: availability.conflicts,
        substitutes,
        reason:
          shortfall > 0
            ? `Se reservaron ${reserved} de ${group.quantity}: ${
                availability.available > 0 ? `solo hay ${availability.available} libres` : "no hay unidades libres"
              } en ${rangeLabel(range.startsAt, range.endsAt)}${
                availability.conflicts.length > 0
                  ? ` · ocupado por ${availability.conflicts.map((conflict) => `${conflict.eventName} (${conflict.quantity})`).join(", ")}`
                  : ""
              }.`
            : null,
      });
    }

    const pendingOutcomes = outcomes.filter(
      (outcome) => outcome.status !== "created" && outcome.status !== "updated" && outcome.status !== "unchanged",
    );
    const reservedUnits = outcomes.reduce((sum, outcome) => sum + outcome.reserved, 0);

    // Un conflicto (o una reserva pendiente por fechas) no rompe la aprobación:
    // queda auditado con el actor real y el equipo lo ve en los avisos.
    for (const outcome of pendingOutcomes) {
      await recordAudit({
        context: options.context,
        action: "update",
        entity: "Budget",
        entityId: budget.id,
        summary: `No pudo reservar «${outcome.itemName}» completo para el presupuesto «${budget.title}» de «${clientLabel}»${
          outcome.reason ? `: ${outcome.reason}` : ""
        }`,
        detail: {
          fields: {
            inventoryId: outcome.inventoryId,
            inventoryName: outcome.inventoryName,
            requested: outcome.quantity,
            reserved: outcome.reserved,
            status: outcome.status,
            ...(outcome.conflicts.length > 0
              ? {
                  ocupadoPor: outcome.conflicts.map(
                    (conflict) =>
                      `${conflict.eventName} (${conflict.quantity}) ${conflict.startsAt?.toISOString() ?? "sin fecha"} → ${conflict.endsAt?.toISOString() ?? "sin fecha"}`,
                  ),
                }
              : {}),
            ...(outcome.substitutes.length > 0
              ? { sustitutos: outcome.substitutes.map((substitute) => `${substitute.name} (${substitute.available} libres)`) }
              : {}),
          },
        },
      });
    }

    await recordAudit({
      context: options.context,
      action: "update",
      entity: "Budget",
      entityId: budget.id,
      summary: `Aprobación de «${budget.title}»: ${reservedUnits} de ${requested} unidades reservadas${
        pendingOutcomes.length > 0 ? ` · ${pendingOutcomes.length} ítem${pendingOutcomes.length === 1 ? "" : "es"} sin completar` : ""
      }`,
      detail: {
        fields: {
          eventId: event?.id ?? null,
          range: range ? `${range.startsAt.toISOString()} → ${range.endsAt.toISOString()}` : null,
          requested,
          reserved: reservedUnits,
          outcome: outcomes.map((outcome) => `${outcome.inventoryName}: ${outcome.reserved}/${outcome.quantity} (${outcome.status})`),
        },
      },
    });

    return {
      eventId: event?.id ?? null,
      eventName: event?.name ?? null,
      range,
      outcomes,
      requested,
      reserved: reservedUnits,
      conflicts: pendingOutcomes.length,
      failed: false,
    };
  } catch (error) {
    console.error("[reserva] No se pudo reservar el inventario del presupuesto aprobado:", error instanceof Error ? error.message : error);
    return { ...EMPTY_RESERVATION, failed: true };
  }
}
