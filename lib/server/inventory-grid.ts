import { pendingStockCount } from "@/lib/stock-count";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { inventoryImageUrl } from "./inventory-images";
import { comboCapacitiesForRange, loadComboDefinitions, withComboAvailability } from "./inventory-combos";
import {
  BLOCKED_INVENTORY_STATUSES,
  EVENT_RANGE_SELECT,
  MAINTENANCE_UNITS_SELECT,
  assignmentCountsAt,
  assignmentIsActiveNow,
  assignmentRange,
  buildAvailability,
  committedAssignmentWhere,
  loadRentalSettings,
  maintenanceUnits,
  resolveRentalBuffers,
} from "./inventory-availability";
import { overdueReturnOf } from "./rental-alerts";

/**
 * Payload liviano del inventario (rediseño E2, `GET /api/admin/inventory?fields=grid`): una fila por
 * producto con su disponibilidad de hoy y los agregados de estado (`unitsByStatus`, `holdByKind`,
 * `nextCommittedAt`, atraso de P1-3), SIN unidades ni asignaciones. Paginado por cursor (el id del
 * último producto), sin el tope de 300 de la lista vieja. Todo acotado a la empresa activa.
 */

export const GRID_DEFAULT_LIMIT = 150;
export const GRID_MAX_LIMIT = 300;
/** Tope de asignaciones vivas que se leen por página (una página trae a lo sumo `GRID_MAX_LIMIT` productos). */
const LIVE_ASSIGNMENTS_CAP = 5000;
/** Tope de reservas sin devolver que se leen para calcular los atrasos. */
export const OVERDUE_ROWS_CAP = 2000;
/** Tope de coincidencias de «código de unidad». */
export const UNIT_MATCH_CAP = 200;

/** Reserva viva: sin liberar y con fin (propio o del evento) desde `since` en adelante, o sin fin. */
export function liveAssignmentSince(since: Date): Prisma.EventInventoryWhereInput {
  return {
    releasedAt: null,
    OR: [
      { endsAt: { gte: since } },
      {
        endsAt: null,
        OR: [
          { event: { endsAt: { gte: since } } },
          { event: { endsAt: null, startsAt: { gte: since } } },
          { event: { endsAt: null, startsAt: null } },
        ],
      },
    ],
  };
}

export type GridExtras = {
  unitsByStatus: Record<string, number>;
  holdByKind: Record<string, number>;
  nextCommittedAt: string | null;
  overduePending: number;
  /** `true` si se llegó al tope de `OVERDUE_ROWS_CAP` y los atrasos pueden estar incompletos. */
  overdueTruncated: boolean;
  stock: { unitCount: number; locations: Array<{ warehouseId: string | null; location: string | null; units: number }>; supplierIds: string[] };
};

type LiveAssignment = {
  inventoryId: string;
  quantity: number;
  startsAt: Date | null;
  endsAt: Date | null;
  checkedIn: boolean;
  checkedInAt: Date | null;
  releasedAt: Date | null;
  holdExpiresAt: Date | null;
  event: { id: string; name: string; startsAt: Date | null; endsAt: Date | null; setupAt: Date | null; strikeAt: Date | null };
};

/**
 * Agregados por `groupBy` de los productos dados: unidades por estado, retenciones por tipo,
 * ubicaciones, proveedores, la próxima reserva y las unidades con devolución vencida. Las
 * reservas vivas ya leídas se pasan para no pedirlas dos veces.
 */
export async function loadGridExtras(options: {
  organizationId: string;
  itemIds: readonly string[];
  assignments: ReadonlyArray<Pick<LiveAssignment, "inventoryId" | "startsAt" | "endsAt" | "releasedAt" | "holdExpiresAt" | "event"> & { checkedIn: boolean; checkedInAt: Date | null }>;
  now: Date;
}): Promise<Map<string, GridExtras>> {
  const { organizationId, itemIds, assignments, now } = options;
  const out = new Map<string, GridExtras>();
  for (const id of itemIds) {
    out.set(id, { unitsByStatus: {}, holdByKind: {}, nextCommittedAt: null, overduePending: 0, overdueTruncated: false, stock: { unitCount: 0, locations: [], supplierIds: [] } });
  }
  if (itemIds.length === 0) return out;
  const ids = [...itemIds];

  const [unitGroups, holdGroups, overdueRows] = await Promise.all([
    db.inventoryUnit.groupBy({
      by: ["inventoryId", "status", "warehouseId", "location", "supplierId"],
      where: { organizationId, inventoryId: { in: ids } },
      _count: { _all: true },
    }),
    db.inventoryIncident.groupBy({
      by: ["inventoryId", "kind"],
      where: { organizationId, inventoryId: { in: ids }, status: { in: ["OPEN", "IN_REPAIR"] }, heldByQuantity: true },
      _sum: { quantity: true },
    }),
    db.eventInventory.findMany({
      where: {
        inventoryId: { in: ids },
        event: { organizationId, deletedAt: null },
        checkedOut: true,
        checkedIn: false,
        checkedInAt: null,
      },
      // Orden determinista (las más viejas primero) y una fila de más para saber si se llegó al tope.
      orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: OVERDUE_ROWS_CAP + 1,
      select: {
        id: true,
        inventoryId: true,
        quantity: true,
        checkoutQuantity: true,
        returnedQuantity: true,
        checkedOut: true,
        checkedIn: true,
        checkedInAt: true,
        startsAt: true,
        endsAt: true,
        inventory: { select: { name: true } },
        event: { select: { ...EVENT_RANGE_SELECT, client: { select: { name: true, company: true } } } },
      },
    }),
  ]);

  const places = new Map<string, Map<string, { warehouseId: string | null; location: string | null; units: number }>>();
  const suppliers = new Map<string, Set<string>>();
  for (const group of unitGroups) {
    const extra = out.get(group.inventoryId);
    if (!extra) continue;
    const count = group._count._all;
    extra.unitsByStatus[group.status] = (extra.unitsByStatus[group.status] ?? 0) + count;
    if (group.supplierId) {
      const set = suppliers.get(group.inventoryId) ?? new Set<string>();
      set.add(group.supplierId);
      suppliers.set(group.inventoryId, set);
    }
    // Donde están físicamente: sin las retiradas ni las perdidas.
    if (group.status === "RETIRED" || group.status === "LOST") continue;
    extra.stock.unitCount += count;
    const byPlace = places.get(group.inventoryId) ?? new Map();
    const key = `${group.warehouseId ?? ""}|${group.location ?? ""}`;
    const entry = byPlace.get(key) ?? { warehouseId: group.warehouseId, location: group.location, units: 0 };
    entry.units += count;
    byPlace.set(key, entry);
    places.set(group.inventoryId, byPlace);
  }
  for (const [inventoryId, byPlace] of places) out.get(inventoryId)!.stock.locations = [...byPlace.values()].sort((a, b) => b.units - a.units);
  for (const [inventoryId, set] of suppliers) out.get(inventoryId)!.stock.supplierIds = [...set];

  for (const group of holdGroups) {
    const extra = out.get(group.inventoryId);
    if (extra) extra.holdByKind[group.kind] = (extra.holdByKind[group.kind] ?? 0) + (group._sum.quantity ?? 0);
  }

  for (const row of assignments) {
    if (!assignmentCountsAt(row, now) || row.checkedIn || row.checkedInAt) continue;
    const { start } = assignmentRange(row);
    if (!start || start.getTime() <= now.getTime()) continue;
    const extra = out.get(row.inventoryId);
    if (!extra) continue;
    if (!extra.nextCommittedAt || start.toISOString() < extra.nextCommittedAt) extra.nextCommittedAt = start.toISOString();
  }

  const overdueTruncated = overdueRows.length > OVERDUE_ROWS_CAP;
  if (overdueTruncated) {
    console.warn(`[inventory/grid] atrasos truncados: más de ${OVERDUE_ROWS_CAP} reservas sin devolver en esta página`);
    for (const extra of out.values()) extra.overdueTruncated = true;
  }
  for (const row of overdueTruncated ? overdueRows.slice(0, OVERDUE_ROWS_CAP) : overdueRows) {
    const overdue = overdueReturnOf(row, now);
    const extra = overdue ? out.get(overdue.inventoryId) : null;
    if (overdue && extra) extra.overduePending += overdue.pending;
  }
  return out;
}

export type GridPageOptions = {
  organizationId: string;
  cursor?: string | null;
  query?: string;
  limit?: number;
  /** Rango opcional de «Disponible desde/hasta»: suma la disponibilidad de ese rango. */
  range?: { start: Date; end: Date } | null;
  now?: Date;
  /** Descubrimiento de selección masiva: excluir filas creadas después de la primera página. */
  createdBefore?: Date;
};

export class GridCursorError extends Error {}

/** Cursor opaco por `(name, id)`: no depende de que el último producto siga existiendo. */
export function encodeGridCursor(item: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify([item.name, item.id]), "utf8").toString("base64url");
}

export function decodeGridCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && typeof parsed[1] === "string") return { name: parsed[0], id: parsed[1] };
  } catch {
    // cae al error de abajo
  }
  throw new GridCursorError("El cursor no es válido. Recargá el inventario.");
}

export function readGridLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return GRID_DEFAULT_LIMIT;
  return Math.min(Math.floor(value), GRID_MAX_LIMIT);
}

/** Una página de productos (orden por nombre y id) con disponibilidad de hoy y agregados. */
export async function listInventoryGrid(options: GridPageOptions) {
  const { organizationId, range = null } = options;
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? GRID_DEFAULT_LIMIT)), GRID_MAX_LIMIT);

  // El cursor lleva (nombre, id) del último producto: sigue desde el siguiente aunque ese producto
  // se haya borrado entre dos páginas, y siempre dentro de la empresa pedida.
  const after = options.cursor ? decodeGridCursor(options.cursor) : null;
  const query = options.query?.trim() ?? "";
  const search: Prisma.InventoryItemWhereInput = query ? { OR: ["name", "sku", "category"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {};
  const [rows, total] = await Promise.all([
    db.inventoryItem.findMany({
      where: {
        organizationId,
        AND: [search],
        ...(options.createdBefore ? { createdAt: { lte: options.createdBefore } } : {}),
        ...(after ? { OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      omit: { imageData: true },
      include: {
        priceTiers: { orderBy: [{ audience: "asc" }, { fromDays: "asc" }], select: { audience: true, fromDays: true, mode: true, price: true } },
        _count: { select: MAINTENANCE_UNITS_SELECT },
      },
    }),
    after ? Promise.resolve(undefined) : db.inventoryItem.count({ where: { organizationId, ...search, ...(options.createdBefore ? { createdAt: { lte: options.createdBefore } } : {}) } }),
  ]);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const ids = items.map((item) => item.id);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const since = range && range.start.getTime() < startOfToday.getTime() ? range.start : startOfToday;
  const assignments: Array<LiveAssignment & { id: string; checkedOut: boolean }> = ids.length
    ? ((await db.eventInventory.findMany({
        where: { inventoryId: { in: ids }, event: { organizationId, deletedAt: null }, checkedIn: false, ...liveAssignmentSince(since) },
        orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: LIVE_ASSIGNMENTS_CAP,
        include: { event: { select: EVENT_RANGE_SELECT } },
      })) as unknown as Array<LiveAssignment & { id: string; checkedOut: boolean }>)
    : [];

  const committedIds =
    range && assignments.length
      ? new Set(
          (await db.eventInventory.findMany({ where: { id: { in: assignments.map((row) => row.id) }, ...committedAssignmentWhere(organizationId) }, select: { id: true } })).map((row) => row.id),
        )
      : null;
  const rentalSettings = range ? await loadRentalSettings(organizationId) : null;
  const extras = await loadGridExtras({ organizationId, itemIds: ids, assignments, now });
  // Familia de las variantes de la página (nombre y código para el chip y el filtro); una sola consulta.
  const familyIds = [...new Set(items.flatMap((item) => (item.familyId ? [item.familyId] : [])))];
  const families = new Map(
    (familyIds.length
      ? await db.inventoryFamily.findMany({ where: { organizationId, id: { in: familyIds }, deletedAt: null }, select: { id: true, name: true, code: true } })
      : []
    ).map((family) => [family.id, family]),
  );

  const inventory = items.map((item) => {
    const { imageMime, _count, priceTiers, ...row } = item;
    const mine = assignments.filter((assignment) => assignment.inventoryId === item.id);
    const committedNow = mine.filter((assignment) => assignmentIsActiveNow(assignment, now)).reduce((sum, assignment) => sum + assignment.quantity, 0);
    const blocked = pendingStockCount(item) || BLOCKED_INVENTORY_STATUSES.includes(item.status);
    const maintenanceNow = maintenanceUnits(item);
    const usable = Math.max(0, item.quantity - maintenanceNow);
    const rangeAvailability = range
      ? buildAvailability(
          { ...item, maintenance: maintenanceNow, buffers: resolveRentalBuffers(rentalSettings, item) },
          mine.filter((assignment) => committedIds?.has(assignment.id) && assignmentCountsAt(assignment, now)) as never,
          range.start,
          range.end,
        )
      : null;
    const extra = extras.get(item.id)!;
    const family = item.familyId ? families.get(item.familyId) : undefined;
    return {
      ...row,
      familyName: family?.name ?? null,
      familyCode: family?.code ?? null,
      priceTiers,
      imageUrl: inventoryImageUrl(item),
      imageUploaded: Boolean(imageMime),
      stock: extra.stock,
      availability: {
        committedNow,
        availableNow: blocked ? 0 : Math.max(0, usable - committedNow),
        overcommittedNow: committedNow > usable,
        maintenanceNow,
        unitsByStatus: extra.unitsByStatus,
        holdByKind: extra.holdByKind,
        nextCommittedAt: extra.nextCommittedAt,
        overduePending: extra.overduePending,
        overdueTruncated: extra.overdueTruncated,
        range: rangeAvailability
          ? {
              startsAt: rangeAvailability.startsAt,
              endsAt: rangeAvailability.endsAt,
              committed: rangeAvailability.committed,
              maintenance: rangeAvailability.maintenance,
              available: rangeAvailability.available,
              overcommitted: rangeAvailability.committed > usable,
              conflicts: rangeAvailability.conflicts,
            }
          : null,
      },
    };
  });

  // Combos: sin stock propio; «libres» es la capacidad de sus componentes.
  const definitions = await loadComboDefinitions(organizationId, ids);
  const rangeCapacities = range && definitions.size > 0 ? await comboCapacitiesForRange({ organizationId, comboIds: [...definitions.keys()], startsAt: range.start, endsAt: range.end }) : null;
  return {
    inventory: withComboAvailability(inventory, definitions, rangeCapacities),
    // Los atrasos se calcularon con un tope: la pantalla avisa que pueden faltar.
    truncated: [...extras.values()].some((extra) => extra.overdueTruncated),
    nextCursor: hasMore ? encodeGridCursor(items[items.length - 1]) : null,
    ...(total === undefined ? {} : { total }),
  };
}

/** Productos de la empresa con alguna unidad cuyo código contiene el texto (búsqueda por código de unidad). */
export async function matchInventoryByUnitCode(organizationId: string, text: string, itemIds?: readonly string[]): Promise<string[]> {
  const query = text.trim();
  if (query.length < 2 || itemIds?.length === 0) return [];
  const rows = await db.inventoryUnit.findMany({
    where: { organizationId, ...(itemIds ? { inventoryId: { in: [...itemIds] } } : {}), code: { contains: query, mode: "insensitive" } },
    distinct: ["inventoryId"],
    select: { inventoryId: true },
    take: itemIds ? itemIds.length : UNIT_MATCH_CAP,
  });
  return rows.map((row) => row.inventoryId);
}
