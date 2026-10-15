import { randomUUID } from "node:crypto";
import { Prisma, type InventoryStatus, type InventoryUnitStatus } from "@prisma/client";
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
export const UNAVAILABLE_UNIT_STATUSES = ["MAINTENANCE", "DAMAGED", "LOST"] as const satisfies readonly InventoryUnitStatus[];

/**
 * Una unidad en mantenimiento, dañada o perdida no está libre (el nombre del
 * contador es histórico: cubre los tres estados).
 */
export const MAINTENANCE_UNITS_SELECT = {
  units: { where: { status: { in: [...UNAVAILABLE_UNIT_STATUSES] } } },
} satisfies Prisma.InventoryItemCountOutputTypeSelect;

/** Unidades en mantenimiento de un ítem con `_count` (0 si no vino el conteo). */
export function maintenanceUnits(item: { _count?: { units?: number } | null; incidentHold: number }): number {
  // `incidentHold` = unidades sin código retenidas por incidentes abiertos (daño o
  // faltante por cantidad): se descuentan igual que una unidad en mantenimiento.
  return (item._count?.units ?? 0) + Math.max(0, item.incidentHold);
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
  /** Devolución real: si fue después del fin del rango, la limpieza cuenta desde ahí. */
  checkedInAt?: Date | null;
  /** Salió y todavía no volvió: si el fin planeado ya pasó, sigue afuera hasta ahora. */
  checkedOut?: boolean;
  checkedIn?: boolean;
};

/** Ítem mínimo para calcular disponibilidad (no hace falta la fila completa). */
export type AvailabilityItem = {
  id: string;
  name: string;
  quantity: number;
  status: InventoryStatus;
  /** Unidades en mantenimiento, dañadas o perdidas: se descuentan del stock libre. */
  maintenance: number;
  /** Colchones antes/después del evento; sin dato, el período bloqueado es el del evento. */
  buffers?: RentalBuffers;
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

// ── Tiempos de preparación (alquileres fase 2b) ───────────────────────────────
// El período bloqueado de una asignación es el rango del evento extendido antes
// por (preparación + transporte + entrega) y después por (devolución + transporte
// + limpieza). El override del producto reemplaza el total de cada lado; sin
// override rigen los de la empresa y sin ajustes, 0. Se calcula al leer, nunca
// se materializa.

export type RentalBufferSettings = {
  deliveryBufferMin: number;
  returnBufferMin: number;
  prepBufferMin: number;
  transportBufferMin: number;
  cleaningBufferMin: number;
};

export type RentalBuffers = { beforeMin: number; afterMin: number };

export const NO_RENTAL_BUFFERS: RentalBuffers = { beforeMin: 0, afterMin: 0 };

function bufferMinutes(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Colchones de un producto: su override si existe; si no, los de la empresa; si no hay ajustes, 0. */
export function resolveRentalBuffers(
  settings: Partial<RentalBufferSettings> | null | undefined,
  item?: { bufferBeforeMin?: number | null; bufferAfterMin?: number | null } | null,
): RentalBuffers {
  const orgBefore = bufferMinutes(settings?.prepBufferMin) + bufferMinutes(settings?.transportBufferMin) + bufferMinutes(settings?.deliveryBufferMin);
  const orgAfter = bufferMinutes(settings?.returnBufferMin) + bufferMinutes(settings?.transportBufferMin) + bufferMinutes(settings?.cleaningBufferMin);
  return {
    beforeMin: item?.bufferBeforeMin == null ? orgBefore : bufferMinutes(item.bufferBeforeMin),
    afterMin: item?.bufferAfterMin == null ? orgAfter : bufferMinutes(item.bufferAfterMin),
  };
}

const MAX_TIME = 8.64e15;

/**
 * Rango bloqueado: el del evento extendido por los colchones. Una punta `null`
 * (rango abierto) se queda abierta y el resultado nunca sale del rango válido de
 * `Date` (los rangos «siempre ocupado» usan los extremos).
 */
export function extendedRentalRange(
  start: Date | null,
  end: Date | null,
  buffers: RentalBuffers,
): { start: Date | null; end: Date | null } {
  const shift = (date: Date | null, minutes: number): Date | null => {
    if (!date || minutes === 0) return date;
    const time = Math.min(MAX_TIME, Math.max(-MAX_TIME, date.getTime() + minutes * 60_000));
    return new Date(time);
  };
  return { start: shift(start, -buffers.beforeMin), end: shift(end, buffers.afterMin) };
}

/** Ajustes de alquiler de la empresa (o `null` si nunca se configuraron). */
export async function loadRentalSettings(organizationId: string, client: AvailabilityClient = db) {
  return client.organizationRentalSettings.findUnique({ where: { organizationId } });
}

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
  row: Pick<AssignmentRecord, "startsAt" | "endsAt" | "event"> & {
    checkedIn: boolean;
    checkedInAt: Date | null;
    releasedAt?: Date | null;
    holdExpiresAt?: Date | null;
  },
  now: Date,
): boolean {
  if (row.checkedInAt || row.checkedIn) return false;
  if (!assignmentCountsAt(row, now)) return false;
  const { start, end } = assignmentRange(row);
  if (!start && !end) return true;
  if (start && start.getTime() > now.getTime()) return false;
  if (end && end.getTime() < now.getTime()) return false;
  return true;
}

/** Una asignación liberada o con retención vencida no compromete stock (vencimiento perezoso, sin cron). */
export function assignmentCountsAt(row: { releasedAt?: Date | null; holdExpiresAt?: Date | null }, now: Date): boolean {
  if (row.releasedAt) return false;
  return !row.holdExpiresAt || row.holdExpiresAt.getTime() > now.getTime();
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
    deletedAt: null, // papelera: la extensión de db no filtra relaciones anidadas
    status: { not: "CANCELLED" },
    OR: [{ budgets: { none: {} } }, { budgets: { some: { status: { notIn: ["LOST", "CANCELLED"] } } } }],
  };
}

/**
 * Asignaciones que comprometen stock. Un equipo que ya salió y no volvió
 * (`checkedOut` sin `checkedIn`) cuenta SIEMPRE: está físicamente afuera aunque el
 * evento se haya cancelado o su presupuesto se haya perdido.
 */
export function committedAssignmentWhere(organizationId: string, now: Date = new Date()): Prisma.EventInventoryWhereInput {
  return {
    event: { organizationId },
    OR: [
      { checkedOut: true, checkedIn: false, checkedInAt: null },
      {
        // Liberadas y retenciones vencidas no cuentan (vencimiento perezoso).
        releasedAt: null,
        AND: [{ OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] }],
        event: committedEventWhere(organizationId),
      },
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
 * Período bloqueado de una asignación: su rango efectivo extendido por los colchones.
 * Si volvió después de lo previsto, el equipo vuelve recién ahí y la limpieza o
 * revisión corre desde la devolución real, no desde el fin del evento. Fuente única:
 * la usan la disponibilidad y el reporte de ocupación.
 */
export function assignmentBlockedRange(
  row: Pick<AssignmentRecord, "startsAt" | "endsAt" | "event" | "checkedInAt" | "checkedOut" | "checkedIn">,
  buffers: RentalBuffers,
  now: Date = new Date(),
): { start: Date | null; end: Date | null } {
  const { start, end } = assignmentRange(row);
  let realEnd = row.checkedInAt && end && row.checkedInAt.getTime() > end.getTime() ? row.checkedInAt : end;
  // Salió, no volvió y el fin planeado ya pasó: sigue afuera. El fin efectivo es
  // max(fin, ahora) + colchón, así un equipo atrasado no figura libre ni se ofrece a otro evento.
  if (isOutstanding(row) && end && end.getTime() < now.getTime()) realEnd = now;
  return extendedRentalRange(start, realEnd, buffers);
}

/** Salió y no volvió (misma condición que lo mantiene comprometido en `committedAssignmentWhere`). */
export function isOutstanding(row: { checkedOut?: boolean; checkedIn?: boolean; checkedInAt?: Date | null }): boolean {
  return Boolean(row.checkedOut) && !row.checkedIn && !row.checkedInAt;
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
  now: Date = new Date(),
): RangeAvailability {
  const buffers = item.buffers ?? NO_RENTAL_BUFFERS;
  // Se extienden los dos períodos (el pedido y el de cada asignación): entre dos
  // usos tiene que entrar la limpieza del primero más la preparación del segundo.
  const requested = extendedRentalRange(startsAt, endsAt, buffers);
  const blockedRange = (row: AssignmentRecord) => assignmentBlockedRange(row, buffers, now);
  const conflicts = rows
    .filter((row) => {
      const { start, end } = blockedRange(row);
      return overlaps(start, end, requested.start ?? startsAt, requested.end ?? endsAt);
    })
    .map((row) => {
      // El detalle muestra el rango real del evento, no el extendido.
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
  const item = options.item.buffers
    ? options.item
    : { ...options.item, buffers: resolveRentalBuffers(await loadRentalSettings(options.organizationId, options.client), options.item as { bufferBeforeMin?: number | null; bufferAfterMin?: number | null }) };
  return buildAvailability(item, rows, options.startsAt, options.endsAt);
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
  const locked = new Set(rows.map((row) => row.id));
  await settleExpiredComboContributions(tx, organizationId, [...locked]);
  return locked;
}

/**
 * Bloquea la fila del evento (vivo, de la empresa) con `FOR UPDATE`. Orden de locks
 * documentado: ítems (por id) -> evento. `trashEvent` toma solo el lock del evento y
 * nunca el de ítems, así que no hay ciclo posible. Si la papelera gana la carrera, el
 * `deletedAt IS NULL` se reevalúa al soltarse el lock y no devuelve fila (event-missing);
 * si gana la asignación, la guarda de `trashEvent` ve la reserva abierta y bloquea.
 */
export async function lockLiveEvent(tx: Prisma.TransactionClient, organizationId: string, eventId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} AND "organizationId" = ${organizationId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  return rows.length > 0;
}

/** Sustituciones guardadas en la fila del combo: { componenteOriginal: sustituto }. */
export function parseComboSubstitutions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
    if (typeof to === "string" && to) out[from] = to;
  }
  return out;
}

/** Componentes efectivos: la definición con las sustituciones autorizadas aplicadas. */
export function effectiveComponents(
  definition: ReadonlyArray<{ componentId: string; quantity: number }>,
  substitutions: unknown,
): Array<{ definitionId: string; componentId: string; quantity: number }> {
  const subs = parseComboSubstitutions(substitutions);
  return definition.map((row) => ({ definitionId: row.componentId, componentId: subs[row.componentId] ?? row.componentId, quantity: row.quantity }));
}

/**
 * Regla de los combos con retención sobre filas compartidas: la fila del combo es
 * la fuente de verdad de su aporte (cantidad × combos × componente efectivo). El
 * aporte de un combo cuenta solo mientras su propia fila cuenta (no liberada y con
 * retención vigente), aunque la fila del componente siga firme por una asignación
 * suelta. Como no hay cron, el vencimiento es perezoso: cada vez que se toma el
 * lock de un ítem se descuentan de sus filas de componentes los aportes que ya no
 * cuentan (`comboQuantity` por encima de lo que suman los combos vivos). Es
 * idempotente (se deriva de las filas de combos, no de un marcador) y corre antes
 * de cualquier validación de stock, liberación o recompromiso. Las lecturas pasivas
 * (listas) pueden mostrar ese aporte como comprometido hasta la próxima escritura:
 * es conservador, nunca sobrevende.
 */
async function settleExpiredComboContributions(tx: Prisma.TransactionClient, organizationId: string, inventoryIds: ReadonlyArray<string>): Promise<void> {
  if (inventoryIds.length === 0) return;
  const now = new Date();
  const counting = [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }];
  const rows = await tx.eventInventory.findMany({
    where: { inventoryId: { in: [...inventoryIds] }, comboQuantity: { gt: 0 }, releasedAt: null, OR: counting, event: { organizationId } },
    select: { id: true, eventId: true, inventoryId: true, quantity: true, comboQuantity: true, checkedOut: true, checkedOutAt: true, checkedIn: true, checkedInAt: true },
  });
  if (rows.length === 0) return;
  const combos = await tx.eventInventory.findMany({
    where: { eventId: { in: [...new Set(rows.map((row) => row.eventId))] }, releasedAt: null, OR: counting, inventory: { organizationId, components: { some: {} } } },
    select: { eventId: true, inventoryId: true, quantity: true, comboSubstitutions: true },
  });
  const definitions = combos.length
    ? await tx.inventoryComponent.findMany({
        where: { organizationId, parentId: { in: [...new Set(combos.map((combo) => combo.inventoryId))] } },
        select: { parentId: true, componentId: true, quantity: true },
      })
    : [];
  const expected = new Map<string, number>();
  for (const combo of combos) {
    const definition = definitions.filter((entry) => entry.parentId === combo.inventoryId);
    for (const component of effectiveComponents(definition, combo.comboSubstitutions)) {
      const key = `${combo.eventId}:${component.componentId}`;
      expected.set(key, (expected.get(key) ?? 0) + component.quantity * combo.quantity);
    }
  }
  for (const row of rows) {
    if (inMovement(row)) continue;
    const alive = expected.get(`${row.eventId}:${row.inventoryId}`) ?? 0;
    if (row.comboQuantity <= alive) continue;
    const left = row.quantity - (row.comboQuantity - alive);
    if (left <= 0) await tx.eventInventory.delete({ where: { id: row.id } });
    else await tx.eventInventory.update({ where: { id: row.id }, data: { quantity: left, comboQuantity: alive } });
  }
}

/** Aplica el vencimiento perezoso de aportes de combos a un ítem (con su lock). */
export async function settleComboContributions(organizationId: string, inventoryId: string): Promise<void> {
  await db.$transaction((tx) => lockInventoryItems(tx, organizationId, [inventoryId]), { timeout: 15_000 });
}

/** ¿El ítem es un combo (tiene componentes)? Un combo no tiene stock propio (fase 2c). */
export async function isComboItem(
  client: { inventoryComponent: { count: (args: { where: { organizationId: string; parentId: string } }) => Promise<number> } },
  organizationId: string,
  inventoryId: string,
): Promise<boolean> {
  return (await client.inventoryComponent.count({ where: { organizationId, parentId: inventoryId } })) > 0;
}

/** ¿La asignación es la fila de un combo? Acotado a la empresa. */
export async function isComboAssignment(options: { organizationId: string; assignmentId: string }): Promise<boolean> {
  const row = await db.eventInventory.findFirst({
    where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
    select: { inventoryId: true },
  });
  return row ? isComboItem(db, options.organizationId, row.inventoryId) : false;
}

/** Vigencia por defecto de una retención: 48 h. */
export const DEFAULT_HOLD_TTL_MINUTES = 2880;

export type CommitAssignmentResult =
  | { ok: true; assignment: AssignmentWrite; previous: { id: string; quantity: number; startsAt: Date | null; endsAt: Date | null } | null; item: { id: string; name: string }; event: { id: string; name: string }; /** Combos: cuántos se podían armar en el rango (con lo propio ya reservado). */ capacity?: number }
  | { ok: false; reason: "event-missing" }
  | { ok: false; reason: "item-missing" }
  | { ok: false; reason: "blocked"; item: { id: string; name: string; status: InventoryStatus } }
  /** Choque con otra asignación del mismo evento (combo, movimiento o rango distinto). */
  | { ok: false; reason: "conflict"; message: string }
  | { ok: false; reason: "insufficient"; quantity: number; item: { id: string; name: string }; availability: RangeAvailability; open: boolean };

type AssignmentWrite = { id: string; eventId: string; inventoryId: string; quantity: number; startsAt: Date | null; endsAt: Date | null; holdExpiresAt?: Date | null; releasedAt?: Date | null };

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
  /**
   * `true`: la asignación es una retención que vence a los `holdTtlMinutes` de la
   * empresa. `false`: firme (confirma una retención existente). `undefined`: una
   * asignación nueva es firme y una existente conserva su estado.
   */
  hold?: boolean;
  budgetId?: string | null;
}): Promise<CommitAssignmentResult> {
  // Un combo no tiene stock propio: se expande en sus componentes (fase 2c).
  if (await isComboItem(db, options.organizationId, options.inventoryId)) {
    const { commitComboAssignment } = await import("./inventory-combos");
    return commitComboAssignment({ ...options });
  }
  return db.$transaction(
    async (tx) => {
      const now = new Date();
      const locked = await lockInventoryItems(tx, options.organizationId, [options.inventoryId]);
      if (!(await lockLiveEvent(tx, options.organizationId, options.eventId))) return { ok: false, reason: "event-missing" } as const;
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
        select: { id: true, quantity: true, startsAt: true, endsAt: true, holdExpiresAt: true, releasedAt: true, comboQuantity: true, checkoutQuantity: true },
      });
      // La parte que vino de combos no se pisa desde una edición suelta.
      const previousCounted = Boolean(previous && assignmentCountsAt(previous, now));
      if (previousCounted && previous && options.quantity < previous.comboQuantity) {
        return {
          ok: false,
          reason: "conflict",
          message: `${previous.comboQuantity} unidad${previous.comboQuantity === 1 ? "" : "es"} de «${item.name}» vienen de combos de este evento: la cantidad no puede ser menor; liberá el combo para quitarlas.`,
        } as const;
      }
      if (previousCounted && previous && options.quantity < previous.checkoutQuantity) {
        return {
          ok: false,
          reason: "conflict",
          message: `Ya salieron ${previous.checkoutQuantity} unidad${previous.checkoutQuantity === 1 ? "" : "es"} de «${item.name}»: la cantidad no puede ser menor.`,
        } as const;
      }
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
      const settings = await loadRentalSettings(options.organizationId, tx);
      const holdTtlMinutes = settings?.holdTtlMinutes ?? DEFAULT_HOLD_TTL_MINUTES;
      const holdExpiresAt = new Date(now.getTime() + holdTtlMinutes * 60_000);
      // Con `hold` undefined sobre una retención ya vencida (<= ahora), el stock se
      // validó bajo el lock como compromiso firme: se escribe `holdExpiresAt: null`.
      // Una retención vigente con `hold` undefined conserva su vencimiento.
      const previousHoldExpired = Boolean(previous?.holdExpiresAt && previous.holdExpiresAt.getTime() <= now.getTime());
      const holdData =
        options.hold === true
          ? {
              // Una retención suelta nunca acorta la de un combo vivo que comparte la fila.
              holdExpiresAt: previous && previous.holdExpiresAt === null
                ? null
                : previous?.holdExpiresAt && (previous.comboQuantity ?? 0) > 0 && previous.holdExpiresAt > holdExpiresAt
                  ? previous.holdExpiresAt
                  : holdExpiresAt,
            }
          : options.hold === false || !previous || previousHoldExpired
            ? { holdExpiresAt: null }
            : {};
      const budgetData = options.budgetId !== undefined ? { budgetId: options.budgetId } : {};
      const assignment = await tx.eventInventory.upsert({
        where: { eventId_inventoryId: { eventId: event.id, inventoryId: item.id } },
        create: {
          id: randomUUID(),
          eventId: event.id,
          inventoryId: item.id,
          quantity: options.quantity,
          startsAt: options.startsAt ?? null,
          endsAt: options.endsAt ?? null,
          organizationId: options.organizationId,
          holdExpiresAt: options.hold === true ? holdExpiresAt : null,
          budgetId: options.budgetId ?? null,
        },
        update: {
          quantity: options.quantity,
          ...rangeData,
          ...holdData,
          ...budgetData,
          organizationId: options.organizationId,
          releasedAt: null,
          // Una fila liberada o vencida ya no arrastra unidades de combos.
          ...(previousCounted ? {} : { comboQuantity: 0 }),
        },
      });
      return {
        ok: true,
        assignment,
        previous: previous ? { id: previous.id, quantity: previous.quantity, startsAt: previous.startsAt, endsAt: previous.endsAt } : null,
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

export type HoldResult =
  | { ok: true; assignment: AssignmentWrite; /** Ya era firme: no cambió nada. */ unchanged: boolean; /** Estaba vencida y se revalidó el stock. */ revalidated: boolean }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "released" }
  | { ok: false; reason: "in-movement" }
  | { ok: false; reason: "blocked"; item: { id: string; name: string; status: InventoryStatus } }
  | { ok: false; reason: "conflict"; message: string }
  | { ok: false; reason: "insufficient"; quantity: number; item: { id: string; name: string }; availability: RangeAvailability; open: boolean };

/**
 * Confirma una retención (`holdExpiresAt` → NULL) con el mismo lock del ítem. Si
 * ya venció dejó de contar, así que antes de volverla firme se revalida el stock
 * como si fuera una asignación nueva: sin lugar, 409 («insufficient»).
 */
export async function confirmHold(options: { organizationId: string; assignmentId: string }): Promise<HoldResult> {
  if (await isComboAssignment(options)) {
    const { confirmComboHold } = await import("./inventory-combos");
    return confirmComboHold(options);
  }
  return db.$transaction(
    async (tx) => {
      const now = new Date();
      const found = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        select: { inventoryId: true },
      });
      if (!found) return { ok: false, reason: "not-found" } as const;
      const locked = await lockInventoryItems(tx, options.organizationId, [found.inventoryId]);
      if (!locked.has(found.inventoryId)) return { ok: false, reason: "not-found" } as const;
      // Releída bajo el lock: otra transacción pudo liberarla o confirmarla.
      const row = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        include: { event: { select: EVENT_RANGE_SELECT } },
      });
      if (!row) return { ok: false, reason: "not-found" } as const;
      if (row.releasedAt) return { ok: false, reason: "released" } as const;
      if (row.holdExpiresAt === null) return { ok: true, assignment: row, unchanged: true, revalidated: false } as const;

      const expired = row.holdExpiresAt.getTime() <= now.getTime();
      if (expired) {
        const item = await tx.inventoryItem.findFirst({
          where: { id: row.inventoryId, organizationId: options.organizationId },
          omit: { imageData: true },
          include: { _count: { select: MAINTENANCE_UNITS_SELECT } },
        });
        if (!item) return { ok: false, reason: "not-found" } as const;
        if (BLOCKED_INVENTORY_STATUSES.includes(item.status)) {
          return { ok: false, reason: "blocked", item: { id: item.id, name: item.name, status: item.status } } as const;
        }
        const { start, end } = assignmentRange(row);
        const availability = await availabilityForRange({
          organizationId: options.organizationId,
          item: { ...item, maintenance: maintenanceUnits(item) },
          startsAt: start ?? OPEN_RANGE_START,
          endsAt: end ?? OPEN_RANGE_END,
          excludeId: row.id,
          client: tx,
        });
        if (row.quantity > availability.available) {
          return {
            ok: false,
            reason: "insufficient",
            quantity: row.quantity,
            item: { id: item.id, name: item.name },
            availability,
            open: !start || !end,
          } as const;
        }
      }
      const assignment = await tx.eventInventory.update({
        where: { id: row.id },
        data: { holdExpiresAt: null, organizationId: options.organizationId },
      });
      return { ok: true, assignment, unchanged: false, revalidated: expired } as const;
    },
    { timeout: 15_000 },
  );
}

/**
 * Libera una asignación (`releasedAt`): deja de comprometer stock. Un equipo que
 * ya salió y no volvió no se libera (siempre cuenta hasta su devolución).
 */
export async function releaseAssignment(options: { organizationId: string; assignmentId: string }): Promise<HoldResult> {
  if (await isComboAssignment(options)) {
    const { releaseComboAssignment } = await import("./inventory-combos");
    return releaseComboAssignment(options);
  }
  return db.$transaction(
    async (tx) => {
      const found = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        select: { inventoryId: true },
      });
      if (!found) return { ok: false, reason: "not-found" } as const;
      const locked = await lockInventoryItems(tx, options.organizationId, [found.inventoryId]);
      if (!locked.has(found.inventoryId)) return { ok: false, reason: "not-found" } as const;
      const row = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
      });
      if (!row) return { ok: false, reason: "not-found" } as const;
      if (row.checkedOut && !row.checkedIn && !row.checkedInAt) return { ok: false, reason: "in-movement" } as const;
      if (row.releasedAt) return { ok: true, assignment: row, unchanged: true, revalidated: false } as const;
      if (row.comboQuantity > 0 && assignmentCountsAt(row, new Date())) {
        return { ok: false, reason: "conflict", message: "Hay unidades de esta asignación que vienen de un combo del evento: liberá el combo en lugar del componente." } as const;
      }
      const assignment = await tx.eventInventory.update({
        where: { id: row.id },
        data: { releasedAt: new Date(), organizationId: options.organizationId },
      });
      return { ok: true, assignment, unchanged: false, revalidated: false } as const;
    },
    { timeout: 15_000 },
  );
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
  const settings = await loadRentalSettings(options.organizationId);
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
        { ...candidate, maintenance: maintenanceUnits(candidate), buffers: resolveRentalBuffers(settings, candidate) },
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
  /**
   * Solo en combos con faltante: cada pieza que no alcanza con sus alternativas (misma categoría,
   * con stock real) y la diferencia de precio de reemplazarla (`lib/server/combo-quote.ts`).
   */
  comboParts?: ComboShortagePart[];
  /** Motivo legible cuando la reserva no quedó completa. */
  reason: string | null;
};

export type ComboShortagePart = {
  componentId: string;
  name: string;
  needed: number;
  available: number;
  alternatives: Array<{ id: string; name: string; available: number; enough: boolean; priceDelta: number | null; newPackageTotal: number | null }>;
};

/**
 * Piezas faltantes de un combo con sus alternativas y diferencia de precio. Nunca lanza: si el
 * detalle no se puede armar, queda logueado y el faltante se informa igual sin alternativas.
 */
async function comboShortageParts(organizationId: string, comboId: string, quantity: number, range: { startsAt: Date; endsAt: Date }): Promise<ComboShortagePart[] | undefined> {
  try {
    const { comboQuote } = await import("./combo-quote");
    const { rentalDaysBetween } = await import("../catalog-public");
    const { dayKeyOf } = await import("./notifications");
    const quote = await comboQuote({ organizationId, comboId, quantity, days: rentalDaysBetween(dayKeyOf(range.startsAt), dayKeyOf(range.endsAt)), audience: "RETAIL", range });
    const parts = quote?.components.filter((part) => part.short).map((part) => ({
      componentId: part.componentId,
      name: part.name,
      needed: part.needed,
      available: part.available ?? 0,
      alternatives: part.alternatives.map(({ id, name, available, enough, priceDelta, newPackageTotal }) => ({ id, name, available, enough, priceDelta, newPackageTotal })),
    }));
    return parts && parts.length ? parts : undefined;
  } catch (error) {
    console.error("[reserva] no se pudieron calcular las alternativas del combo", { comboId, error });
    return undefined;
  }
}

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
  /**
   * Solo con `strict`: faltaba stock, se deshizo todo y NO se reservó nada. Los
   * `outcomes` son únicamente los ítems que no alcanzan.
   */
  blocked?: boolean;
};

/** Se lanza dentro de la transacción de una reserva estricta para deshacerla entera. */
class StrictStockShortage extends Error {}
/** Verificación de solo lectura: se deshace la transacción aunque alcance el stock. */
class DryRunRollback extends Error {}

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
    incidentHold: number;
    _count: { units: number; components: number };
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

/** Disponibilidad sintética de un combo (capacidad de sus componentes) para el resultado de la reserva. */
function comboAvailability(
  inventory: { id: string; name: string; status: InventoryStatus },
  capacity: number,
  range: { startsAt: Date; endsAt: Date },
  conflicts: AvailabilityConflict[],
): RangeAvailability {
  return {
    inventoryId: inventory.id,
    name: inventory.name,
    status: inventory.status,
    total: capacity,
    committed: 0,
    maintenance: 0,
    available: capacity,
    blocked: false,
    startsAt: range.startsAt,
    endsAt: range.endsAt,
    conflicts,
  };
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
  /**
   * Todo o nada: si algún ítem no alcanza (o está bloqueado), la transacción se
   * deshace y devuelve `blocked: true` sin reservar nada. Es la verificación previa
   * a aprobar (bajo el mismo lock de ítems que el resto de los compromisos). Sin
   * evento o sin rango no hay nada que verificar y no bloquea.
   */
  strict?: boolean;
  /**
   * Solo lectura (implica `strict`): calcula bajo el mismo lock si alcanza el stock
   * y SIEMPRE deshace la transacción. No reserva, no audita. `blocked` indica faltante.
   */
  dryRun?: boolean;
}): Promise<BudgetReservation> {
  if (options.dryRun) options = { ...options, strict: true };
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
                incidentHold: true,
                _count: { select: { ...MAINTENANCE_UNITS_SELECT, components: true } },
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
      /** Unidades totales de la fila después de la operación (incluye la parte de combos). */
      total: number;
      assignment: AssignmentWrite | null;
    };
    const commits = new Map<string, GroupCommit>();
    let atomicPhaseFailed = false;
    let strictBlocked = false;
    if (event && range) {
      try {
      await db.$transaction(
        async (tx) => {
          // Los combos bloquean también todos sus componentes (una sola sentencia, por id).
          const comboIds = groups.filter((group) => group.inventory._count.components > 0).map((group) => group.inventory.id);
          const comboParts = comboIds.length
            ? await tx.inventoryComponent.findMany({ where: { organizationId: options.organizationId, parentId: { in: comboIds } }, select: { componentId: true } })
            : [];
          await lockInventoryItems(tx, options.organizationId, [...groups.map((group) => group.inventory.id), ...comboParts.map((part) => part.componentId)]);
          // Primero los combos: su expansión es parte de lo comprometido que ven los sueltos.
          const ordered = [...groups].sort((a, b) => Number(b.inventory._count.components > 0) - Number(a.inventory._count.components > 0));
          for (const group of ordered) {
            if (group.inventory._count.components > 0) {
              const { commitComboInTx } = await import("./inventory-combos");
              const comboRow = await tx.eventInventory.findUnique({
                where: { eventId_inventoryId: { eventId: event.id, inventoryId: group.inventory.id } },
                select: { id: true, quantity: true, startsAt: true, endsAt: true, holdExpiresAt: true, releasedAt: true },
              });
              const committed = await commitComboInTx(
                tx,
                {
                  organizationId: options.organizationId,
                  eventId: event.id,
                  inventoryId: group.inventory.id,
                  quantity: group.quantity,
                  startsAt: range.startsAt,
                  endsAt: range.endsAt,
                  hold: false,
                  budgetId: options.budgetId,
                  partial: true,
                },
                false,
              );
              if (committed.ok) {
                const capacity = committed.capacity ?? committed.assignment.quantity;
                commits.set(group.inventory.id, {
                  existing: comboRow,
                  movement: false,
                  availability: comboAvailability(group.inventory, capacity, range, []),
                  reserved: committed.assignment.quantity,
                  total: committed.assignment.quantity,
                  assignment:
                    comboRow && comboRow.quantity === committed.assignment.quantity && !comboRow.holdExpiresAt && !comboRow.releasedAt ? null : committed.assignment,
                });
              } else if (committed.reason === "insufficient") {
                commits.set(group.inventory.id, { existing: comboRow, movement: false, availability: committed.availability, reserved: 0, total: 0, assignment: null });
              } else if (committed.reason === "conflict") {
                commits.set(group.inventory.id, { existing: comboRow, movement: true, availability: null, reserved: comboRow?.quantity ?? 0, total: comboRow?.quantity ?? 0, assignment: null });
              }
              continue;
            }
            const fresh = await tx.inventoryItem.findFirst({
              where: { id: group.inventory.id, organizationId: options.organizationId },
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                quantity: true,
                status: true,
                incidentHold: true,
                _count: { select: { ...MAINTENANCE_UNITS_SELECT, components: true } },
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
                releasedAt: true,
                holdExpiresAt: true,
                comboQuantity: true,
              },
            });
            if (existing && inMovement(existing)) {
              commits.set(fresh.id, { existing, movement: true, availability: null, reserved: existing.quantity, total: existing.quantity, assignment: null });
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
            // Una asignación liberada o con retención vencida no contaba: no hay nada que mantener.
            // Una fila vencida/liberada no tiene aportes de combos vivos (los combos cuyo
            // aporte venció ya se descontaron al tomar el lock): reactivarla en cero es coherente.
            const stale = Boolean(existing && !assignmentCountsAt(existing, new Date()));
            // La parte de la fila que viene de combos del evento no es de este ítem de presupuesto.
            const comboPart = existing && !stale ? existing.comboQuantity : 0;
            const kept = existing && !stale ? existing.quantity - comboPart : 0;
            const target = Math.max(group.quantity, kept);
            const reserved = Math.max(kept, Math.min(target, Math.max(0, availability.available - comboPart)));
            const rangeChanged = existing
              ? existing.startsAt?.getTime() !== range.startsAt.getTime() || existing.endsAt?.getTime() !== range.endsAt.getTime()
              : false;
            // Nunca se crea una asignación en cero: sin unidades libres solo se reporta
            // el conflicto (y si ya había una reserva, esa se mantiene).
            // La aprobación vuelve firme la retención y reactiva la liberada.
            const toFirm = Boolean(existing && (existing.releasedAt || existing.holdExpiresAt));
            const mustWrite = reserved > 0 && (!existing || existing.quantity !== reserved + comboPart || rangeChanged || toFirm);
            let assignment: AssignmentWrite | null = null;
            if (mustWrite) {
              assignment = existing
                ? await tx.eventInventory.update({
                    where: { id: existing.id },
                    data: {
                      quantity: reserved + comboPart,
                      startsAt: range.startsAt,
                      endsAt: range.endsAt,
                      holdExpiresAt: null,
                      releasedAt: null,
                      organizationId: options.organizationId,
                      budgetId: options.budgetId,
                      ...(stale ? { comboQuantity: 0 } : {}),
                    },
                  })
                : await tx.eventInventory.create({
                    data: {
                      id: randomUUID(),
                      eventId: event.id,
                      inventoryId: fresh.id,
                      quantity: reserved,
                      startsAt: range.startsAt,
                      endsAt: range.endsAt,
                      organizationId: options.organizationId,
                      budgetId: options.budgetId,
                    },
                  });
            }
            commits.set(fresh.id, {
              existing: existing ? { id: existing.id, quantity: existing.quantity, startsAt: existing.startsAt, endsAt: existing.endsAt } : null,
              movement: false,
              availability,
              reserved,
              total: reserved + comboPart,
              assignment,
            });
          }
          if (options.strict) {
            const short = groups.some((group) => {
              const commit = commits.get(group.inventory.id);
              if (!commit) return true; // bloqueado, retirado o inexistente
              if (commit.movement) return false; // ya tiene salida o devolución: no se toca
              return commit.reserved < group.quantity;
            });
            // El rollback deshace también lo que se escribió en las filas que sí alcanzaban.
            if (short) throw new StrictStockShortage();
            if (options.dryRun) throw new DryRunRollback();
          }
        },
        { timeout: Math.min(60_000, 15_000 + groups.length * 100) },
      );
      } catch (error) {
        if (error instanceof DryRunRollback) {
          return { eventId: event.id, eventName: event.name, range, outcomes: [], requested, reserved: 0, conflicts: 0, failed: false };
        }
        if (error instanceof StrictStockShortage) {
          strictBlocked = true;
        } else {
        // La aprobación nunca se rompe: sin la fase atómica no se reservó nada
        // (la transacción hizo rollback) y todo queda pendiente de reservar.
        atomicPhaseFailed = true;
        commits.clear();
        console.error("[reserva] Falló la fase atómica de la reserva; queda pendiente:", error instanceof Error ? error.message : error);
        }
      }
    }

    if (strictBlocked && event && range) {
      const shortOutcomes: ReservationOutcome[] = [];
      for (const group of groups) {
        const commit = commits.get(group.inventory.id);
        if (commit?.movement || (commit && commit.reserved >= group.quantity)) continue;
        const available = commit?.availability?.available ?? 0;
        shortOutcomes.push({
          itemId: group.itemIds[0],
          itemName: group.names.join(" · "),
          quantity: group.quantity,
          inventoryId: group.inventory.id,
          inventoryName: group.inventory.name,
          inventorySku: group.inventory.sku,
          status: commit ? "conflict" : "blocked",
          reserved: 0,
          available,
          total: group.inventory._count.components > 0 ? 0 : group.inventory.quantity,
          conflicts: commit?.availability?.conflicts ?? [],
          substitutes: await findSubstitutes({
            organizationId: options.organizationId,
            item: { id: group.inventory.id, category: group.inventory.category, status: group.inventory.status },
            startsAt: range.startsAt,
            endsAt: range.endsAt,
          }),
          comboParts: group.inventory._count.components > 0 ? await comboShortageParts(options.organizationId, group.inventory.id, group.quantity, range) : undefined,
          reason: commit
            ? `Se piden ${group.quantity} y ${available > 0 ? `solo hay ${available} libres` : "no hay unidades libres"} en ${rangeLabel(range.startsAt, range.endsAt)}${
                commit.availability && commit.availability.conflicts.length > 0
                  ? ` · ocupado por ${commit.availability.conflicts.map((conflict) => `${conflict.eventName} (${conflict.quantity})`).join(", ")}`
                  : ""
              }.`
            : `«${group.inventory.name}» no está disponible (mantenimiento, retirado o ya no existe).`,
        });
      }
      return {
        eventId: event.id,
        eventName: event.name,
        range,
        outcomes: shortOutcomes,
        requested,
        reserved: 0,
        conflicts: shortOutcomes.length,
        failed: false,
        blocked: true,
      };
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
        total: group.inventory._count.components > 0 ? 0 : group.inventory.quantity,
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
            ? `Actualizó la reserva de «${group.inventory.name}» (${existing.quantity} → ${commit.total} u.) en «${event.name}» al aprobar el presupuesto «${budget.title}»`
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
        comboParts: shortfall > 0 && group.inventory._count.components > 0 ? await comboShortageParts(options.organizationId, group.inventory.id, group.quantity, range) : undefined,
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
