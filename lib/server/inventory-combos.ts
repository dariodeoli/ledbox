import { randomUUID } from "node:crypto";
import { Prisma, type InventoryStatus } from "@prisma/client";
import { db } from "./db";
import { live } from "./trash-filter";
import { skuConflictMessage } from "./trash-ops";
import {
  BLOCKED_INVENTORY_STATUSES,
  DEFAULT_HOLD_TTL_MINUTES,
  EVENT_RANGE_SELECT,
  MAINTENANCE_UNITS_SELECT,
  loadCommittedAssignments,
  assignmentCountsAt,
  availabilityForRange,
  buildAvailability,
  committedAssignmentWhere,
  isComboItem,
  effectiveComponents,
  loadRentalSettings,
  parseComboSubstitutions,
  lockInventoryItems,
  lockLiveEvent,
  maintenanceUnits,
  resolveRentalBuffers,
  type AssignmentRecord,
  type CommitAssignmentResult,
  type HoldResult,
  type RangeAvailability,
} from "./inventory-availability";
import { isUniqueConstraintError } from "./inventory-units";
import { replacePriceTiers } from "./price-tier-store";
import { loadPricedItems, pricedProduct } from "./line-pricing";
import { dayKeyOf } from "./notifications";
import { rentalDaysBetween } from "../catalog-public";
import { priceLine, repricedPackageTotal, substitutionPrice } from "../price-tiers";
import type { AudiencePriceTier } from "../price-tiers";
import { categoryWriteData, resolveInventoryCategory } from "./inventory-categories";
import {
  comboCapacity,
  readComboComponents,
  type ComboCapacity,
  type ComboComponentDef,
  type ComboComponentInput,
} from "../inventory-combos";

/**
 * Motor de combos (alquileres fase 2c).
 *
 * Un combo es un `InventoryItem` con componentes (`InventoryComponent`) y sin
 * unidades propias. Comprometerlo NO reserva «unidades del combo»: expande sus
 * componentes sobre las asignaciones existentes (`EventInventory`), de modo que el
 * combo y el producto suelto comparten el mismo stock.
 *
 * Modelo de asignación:
 * - La fila del combo (`inventoryId` = combo) lleva la cantidad de combos, el rango,
 *   la retención y las sustituciones autorizadas. No compromete stock por sí misma.
 * - Cada componente tiene su fila de siempre (única por evento + ítem). `quantity`
 *   es el total del evento y `comboQuantity` la parte que viene de combos; el resto
 *   es asignación suelta. Liberar un combo resta solo `cantidad × combos` de esa
 *   parte.
 * - Toda la expansión ocurre en una transacción con `FOR UPDATE` sobre el combo y
 *   TODOS sus componentes, en una sola sentencia ordenada por id (sin deadlocks
 *   entre combos y sueltos).
 */

type Tx = Prisma.TransactionClient;

const COMPONENT_ITEM_SELECT = {
  id: true,
  name: true,
  sku: true,
  category: true,
  categoryId: true,
  quantity: true,
  status: true,
  bufferBeforeMin: true,
  bufferAfterMin: true,
  incidentHold: true,
  _count: { select: MAINTENANCE_UNITS_SELECT },
} satisfies Prisma.InventoryItemSelect;

type ComponentItem = Prisma.InventoryItemGetPayload<{ select: typeof COMPONENT_ITEM_SELECT }>;

type DefinitionRow = { componentId: string; quantity: number };

export { effectiveComponents, parseComboSubstitutions };

type ComboState = {
  combo: { id: string; name: string; status: InventoryStatus };
  definition: DefinitionRow[];
  row: Awaited<ReturnType<typeof readComboRow>>;
};

function readComboRow(tx: Tx, eventId: string, comboId: string) {
  return tx.eventInventory.findUnique({ where: { eventId_inventoryId: { eventId, inventoryId: comboId } } });
}

async function readComboState(tx: Tx, organizationId: string, eventId: string | null, comboId: string): Promise<ComboState | null> {
  const combo = await tx.inventoryItem.findFirst({ where: { id: comboId, organizationId }, select: { id: true, name: true, status: true } });
  if (!combo) return null;
  const definition = await tx.inventoryComponent.findMany({
    where: { parentId: comboId, organizationId },
    orderBy: { componentId: "asc" },
    select: { componentId: true, quantity: true },
  });
  if (definition.length === 0) return null;
  const row = eventId ? await readComboRow(tx, eventId, comboId) : null;
  return { combo, definition, row };
}

/**
 * Bloquea el combo y todos sus componentes (los de la definición y los
 * sustitutos) en una sola sentencia ordenada por id y devuelve el estado releído
 * ya con el lock. Si entre la lectura previa y el lock cambió el conjunto de
 * componentes, se vuelve a bloquear la unión (caso raro: edición concurrente).
 */
async function lockComboState(tx: Tx, organizationId: string, eventId: string | null, comboId: string): Promise<ComboState | null> {
  const idsOf = (state: ComboState) => [
    state.combo.id,
    ...state.definition.map((row) => row.componentId),
    ...effectiveComponents(state.definition, state.row?.comboSubstitutions).map((row) => row.componentId),
  ];
  const before = await readComboState(tx, organizationId, eventId, comboId);
  if (!before) return null;
  const lockedIds = new Set(idsOf(before));
  await lockInventoryItems(tx, organizationId, [...lockedIds]);
  const after = await readComboState(tx, organizationId, eventId, comboId);
  if (!after) return null;
  const extra = idsOf(after).filter((id) => !lockedIds.has(id));
  if (extra.length > 0) await lockInventoryItems(tx, organizationId, [...lockedIds, ...extra]);
  return after;
}

function inMovement(row: { checkedOut: boolean; checkedOutAt: Date | null; checkedIn: boolean; checkedInAt: Date | null }): boolean {
  return Boolean(row.checkedOutAt || row.checkedOut || row.checkedInAt || row.checkedIn);
}

const OPEN_RANGE_START = new Date(-8.64e15);
const OPEN_RANGE_END = new Date(8.64e15);

export type ComboCommitOptions = {
  organizationId: string;
  eventId: string;
  inventoryId: string;
  quantity: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  hold?: boolean;
  budgetId?: string | null;
  /** Reserva lo que entre (nunca menos de lo ya reservado) en vez de rechazar. */
  partial?: boolean;
};

/**
 * Compromete `quantity` combos para un evento dentro de la transacción `tx`. Con
 * `locked` el llamador ya tomó los locks (reserva de un presupuesto).
 */
export async function commitComboInTx(tx: Tx, options: ComboCommitOptions, locked = false): Promise<CommitAssignmentResult> {
  const now = new Date();
  const { organizationId } = options;
  const event = await tx.event.findFirst({ where: { id: options.eventId, organizationId }, select: EVENT_RANGE_SELECT });
  if (!event) return { ok: false, reason: "event-missing" };
  const state = locked
    ? await readComboState(tx, organizationId, event.id, options.inventoryId)
    : await lockComboState(tx, organizationId, event.id, options.inventoryId);
  // Lock autoritativo del evento, siempre después de los ítems (mismo orden que la ruta simple).
  // La lectura de arriba es solo una validación previa sin lock.
  if (!(await lockLiveEvent(tx, organizationId, event.id))) return { ok: false, reason: "event-missing" };
  if (!state) return { ok: false, reason: "item-missing" };
  const { combo, definition } = state;
  if (BLOCKED_INVENTORY_STATUSES.includes(combo.status)) {
    return { ok: false, reason: "blocked", item: { id: combo.id, name: combo.name, status: combo.status } };
  }

  const previous = state.row;
  const effective = effectiveComponents(definition, previous?.comboSubstitutions);
  const items = await tx.inventoryItem.findMany({ where: { id: { in: effective.map((row) => row.componentId) }, organizationId }, select: COMPONENT_ITEM_SELECT });
  const itemById = new Map(items.map((item) => [item.id, item]));
  if (effective.some((row) => !itemById.has(row.componentId))) return { ok: false, reason: "item-missing" };

  const eventStart = event.setupAt ?? event.startsAt;
  const eventEnd = event.strikeAt ?? event.endsAt;
  const effectiveRange = {
    start: options.startsAt === undefined ? (previous?.startsAt ?? eventStart) : (options.startsAt ?? eventStart),
    end: options.endsAt === undefined ? (previous?.endsAt ?? eventEnd) : (options.endsAt ?? eventEnd),
  };
  const open = !effectiveRange.start || !effectiveRange.end;
  const checkStart = effectiveRange.start ?? OPEN_RANGE_START;
  const checkEnd = effectiveRange.end ?? OPEN_RANGE_END;
  const settings = await loadRentalSettings(organizationId, tx);

  const previousCounted = Boolean(previous && assignmentCountsAt(previous, now));
  const previousQuantity = previousCounted && previous ? previous.quantity : 0;

  type Plan = {
    definitionId: string;
    item: ComponentItem;
    per: number;
    existing: Awaited<ReturnType<typeof readComboRow>>;
    counted: boolean;
    other: number;
    otherCombo: number;
    availability: RangeAvailability;
    canMake: number;
  };
  const plans: Plan[] = [];
  for (const row of effective) {
    const item = itemById.get(row.componentId)!;
    const existing = await readComboRow(tx, event.id, item.id);
    if (existing && inMovement(existing)) {
      return { ok: false, reason: "conflict", message: `«${item.name}» ya tiene salida o devolución registrada en «${event.name}»: no se puede cambiar el combo «${combo.name}».` };
    }
    const counted = Boolean(existing && assignmentCountsAt(existing, now));
    const ownPrevious = previousQuantity * row.quantity;
    const other = counted && existing ? Math.max(0, existing.quantity - ownPrevious) : 0;
    const otherCombo = counted && existing ? Math.max(0, existing.comboQuantity - ownPrevious) : 0;
    if (counted && existing && other > 0) {
      const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
      const existingStart = existing.startsAt ?? eventStart;
      const existingEnd = existing.endsAt ?? eventEnd;
      if (!sameTime(existingStart, effectiveRange.start) || !sameTime(existingEnd, effectiveRange.end)) {
        return {
          ok: false,
          reason: "conflict",
          message: `«${item.name}» ya está asignado en «${event.name}» con otro rango de fechas: alineá las fechas antes de armar el combo «${combo.name}».`,
        };
      }
    }
    const availability = await availabilityForRange({
      organizationId,
      item: { ...item, maintenance: maintenanceUnits(item), buffers: resolveRentalBuffers(settings, item) },
      startsAt: checkStart,
      endsAt: checkEnd,
      excludeId: existing?.id ?? null,
      client: tx,
    });
    const canMake = Math.floor(Math.max(0, availability.available - other) / row.quantity);
    plans.push({ definitionId: row.definitionId, item, per: row.quantity, existing, counted, other, otherCombo, availability, canMake });
  }

  const capacity = plans.reduce((min, plan) => Math.min(min, plan.canMake), Number.POSITIVE_INFINITY);
  const limiting = plans.reduce((min, plan) => (plan.canMake < min.canMake ? plan : min), plans[0]);
  // Con `partial` nunca se achica lo ya reservado y se reserva lo que entra.
  const quantity = options.partial ? Math.max(previousQuantity, Math.min(options.quantity, capacity)) : options.quantity;
  if (quantity > capacity || quantity < 1) {
    const total = plans.reduce((min, plan) => Math.min(min, Math.floor(Math.max(0, plan.availability.total - plan.availability.maintenance) / plan.per)), Number.POSITIVE_INFINITY);
    return {
      ok: false,
      reason: "insufficient",
      quantity: options.quantity,
      item: { id: combo.id, name: combo.name },
      availability: {
        inventoryId: combo.id,
        name: combo.name,
        status: combo.status,
        total,
        committed: Math.max(0, total - capacity),
        maintenance: 0,
        available: capacity,
        blocked: false,
        startsAt: checkStart,
        endsAt: checkEnd,
        conflicts: limiting.availability.conflicts,
      },
      open,
    };
  }

  const holdTtlMinutes = settings?.holdTtlMinutes ?? DEFAULT_HOLD_TTL_MINUTES;
  const holdExpiresAt = new Date(now.getTime() + holdTtlMinutes * 60_000);
  const live = previous && !previous.releasedAt ? previous : null;
  const previousHoldExpired = Boolean(live?.holdExpiresAt && live.holdExpiresAt.getTime() <= now.getTime());
  const comboHold: Date | null =
    options.hold === true
      ? live && live.holdExpiresAt === null
        ? null
        : holdExpiresAt
      : options.hold === false || !live || previousHoldExpired
        ? null
        : live.holdExpiresAt;

  const rangeData = {
    ...(options.startsAt !== undefined ? { startsAt: options.startsAt } : {}),
    ...(options.endsAt !== undefined ? { endsAt: options.endsAt } : {}),
  };
  const budgetData = options.budgetId !== undefined ? { budgetId: options.budgetId } : {};
  const assignment = await tx.eventInventory.upsert({
    where: { eventId_inventoryId: { eventId: event.id, inventoryId: combo.id } },
    create: {
      id: randomUUID(),
      eventId: event.id,
      inventoryId: combo.id,
      quantity,
      startsAt: options.startsAt ?? null,
      endsAt: options.endsAt ?? null,
      organizationId,
      holdExpiresAt: comboHold,
      budgetId: options.budgetId ?? null,
    },
    update: { quantity, ...rangeData, holdExpiresAt: comboHold, ...budgetData, organizationId, releasedAt: null },
  });

  for (const plan of plans) {
    const contributes = plan.per * quantity;
    const ownBefore = plan.counted ? previousQuantity * plan.per : 0;
    const comboQuantity = (plan.counted && plan.existing ? Math.max(0, plan.existing.comboQuantity - ownBefore) : 0) + contributes;
    // Con asignación suelta (u otro combo) en la misma fila gana lo firme. Si este combo
    // vence antes, su aporte se descuenta solo (ver `settleExpiredComboContributions`).
    let rowHold: Date | null = comboHold;
    if (plan.counted && plan.existing && plan.other > 0) {
      const existingHold = plan.existing.holdExpiresAt;
      rowHold = existingHold === null || comboHold === null ? null : existingHold.getTime() >= comboHold.getTime() ? existingHold : comboHold;
    }
    const shared = plan.counted && plan.existing && plan.other > 0;
    await tx.eventInventory.upsert({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: plan.item.id } },
      create: {
        id: randomUUID(),
        eventId: event.id,
        inventoryId: plan.item.id,
        quantity: contributes,
        comboQuantity: contributes,
        startsAt: options.startsAt ?? previous?.startsAt ?? null,
        endsAt: options.endsAt ?? previous?.endsAt ?? null,
        organizationId,
        holdExpiresAt: rowHold,
        budgetId: options.budgetId ?? null,
      },
      update: {
        quantity: plan.other + contributes,
        comboQuantity,
        holdExpiresAt: rowHold,
        organizationId,
        releasedAt: null,
        ...(shared
          ? {}
          : {
              startsAt: options.startsAt === undefined ? (previous?.startsAt ?? null) : options.startsAt,
              endsAt: options.endsAt === undefined ? (previous?.endsAt ?? null) : options.endsAt,
              ...(options.budgetId !== undefined ? { budgetId: options.budgetId } : {}),
            }),
      },
    });
  }

  return {
    ok: true,
    assignment,
    previous: previous ? { id: previous.id, quantity: previous.quantity, startsAt: previous.startsAt, endsAt: previous.endsAt } : null,
    item: { id: combo.id, name: combo.name },
    event: { id: event.id, name: event.name },
    capacity,
  };
}

/** Compromete combos de forma atómica (la misma firma que `commitInventoryAssignment`). */
export async function commitComboAssignment(options: ComboCommitOptions): Promise<CommitAssignmentResult> {
  return db.$transaction((tx) => commitComboInTx(tx, options), { timeout: 20_000 });
}

/**
 * Devuelve al stock los componentes de una fila de combo: resta `cantidad × combos`
 * de la parte de combos de cada componente (y borra la fila si queda en cero). No
 * toca lo asignado suelto. Si algún componente ya salió o volvió, no cambia nada.
 */
async function releaseComboRows(
  tx: Tx,
  organizationId: string,
  row: NonNullable<Awaited<ReturnType<typeof readComboRow>>>,
  definition: DefinitionRow[],
): Promise<{ ok: true } | { ok: false; name: string }> {
  const effective = effectiveComponents(definition, row.comboSubstitutions);
  const now = new Date();
  // Una fila liberada ya no suma. Con retención vencida, el aporte ya se descontó al
  // tomar el lock (`settleExpiredComboContributions`): no hay nada más que restar.
  if (!assignmentCountsAt(row, now)) return { ok: true };
  const rows = [];
  for (const component of effective) {
    const existing = await readComboRow(tx, row.eventId, component.componentId);
    if (!existing || !assignmentCountsAt(existing, now)) continue;
    if (inMovement(existing)) {
      const item = await tx.inventoryItem.findFirst({ where: { id: component.componentId, organizationId }, select: { name: true } });
      return { ok: false, name: item?.name ?? "un componente" };
    }
    rows.push({ existing, sub: Math.min(existing.comboQuantity, component.quantity * row.quantity) });
  }
  for (const { existing, sub } of rows) {
    const left = existing.quantity - sub;
    if (left <= 0) await tx.eventInventory.delete({ where: { id: existing.id } });
    else await tx.eventInventory.update({ where: { id: existing.id }, data: { quantity: left, comboQuantity: existing.comboQuantity - sub } });
  }
  return { ok: true };
}

async function comboRowById(tx: Tx, organizationId: string, assignmentId: string) {
  return tx.eventInventory.findFirst({ where: { id: assignmentId, event: { organizationId } } });
}

/** Libera una fila de combo y sus componentes (solo los de ese combo). */
export async function releaseComboAssignment(options: { organizationId: string; assignmentId: string; remove?: boolean }): Promise<HoldResult> {
  return db.$transaction(
    async (tx) => {
      const found = await comboRowById(tx, options.organizationId, options.assignmentId);
      if (!found) return { ok: false, reason: "not-found" } as const;
      const state = await lockComboState(tx, options.organizationId, found.eventId, found.inventoryId);
      if (!state?.row || state.row.id !== found.id) return { ok: false, reason: "not-found" } as const;
      const row = state.row;
      if (row.releasedAt && !options.remove) return { ok: true, assignment: row, unchanged: true, revalidated: false } as const;
      const released = await releaseComboRows(tx, options.organizationId, row, state.definition);
      if (!released.ok) return { ok: false, reason: "in-movement" } as const;
      if (options.remove) {
        await tx.eventInventory.delete({ where: { id: row.id } });
        return { ok: true, assignment: row, unchanged: false, revalidated: false } as const;
      }
      const assignment = await tx.eventInventory.update({ where: { id: row.id }, data: { releasedAt: new Date(), organizationId: options.organizationId } });
      return { ok: true, assignment, unchanged: false, revalidated: false } as const;
    },
    { timeout: 20_000 },
  );
}

/** Confirma la retención de un combo: revalida el stock de todos sus componentes y la vuelve firme. */
export async function confirmComboHold(options: { organizationId: string; assignmentId: string }): Promise<HoldResult> {
  return db.$transaction(
    async (tx) => {
      const found = await comboRowById(tx, options.organizationId, options.assignmentId);
      if (!found) return { ok: false, reason: "not-found" } as const;
      const state = await lockComboState(tx, options.organizationId, found.eventId, found.inventoryId);
      if (!state?.row || state.row.id !== found.id) return { ok: false, reason: "not-found" } as const;
      const row = state.row;
      if (row.releasedAt) return { ok: false, reason: "released" } as const;
      if (row.holdExpiresAt === null) return { ok: true, assignment: row, unchanged: true, revalidated: false } as const;
      const expired = row.holdExpiresAt.getTime() <= Date.now();
      const result = await commitComboInTx(
        tx,
        { organizationId: options.organizationId, eventId: row.eventId, inventoryId: row.inventoryId, quantity: row.quantity, hold: false },
        true,
      );
      if (!result.ok) {
        if (result.reason === "insufficient") return result;
        if (result.reason === "blocked") return result;
        if (result.reason === "conflict") return result;
        return { ok: false, reason: "not-found" } as const;
      }
      return { ok: true, assignment: result.assignment, unchanged: false, revalidated: expired } as const;
    },
    { timeout: 20_000 },
  );
}

/**
 * Precio de la sustitución para los días del rango de la asignación (frente cliente final):
 * `delta` por paquete y `packageAfter` = precio del paquete + diferencia (regla de `lib/price-tiers.ts`).
 * `known: false` si falta el precio de alguna pieza o el rango; el presupuesto NO se modifica solo.
 */
export type SubstitutionPriceReport =
  | { known: true; days: number; delta: number; packageBefore: number; packageAfter: number }
  | { known: false; days: number | null };

async function substitutionPriceReport(
  tx: Tx,
  organizationId: string,
  comboId: string,
  fromId: string,
  toId: string,
  perCombo: number,
  start: Date | null,
  end: Date | null,
): Promise<SubstitutionPriceReport> {
  if (!start || !end || end.getTime() < start.getTime()) return { known: false, days: null };
  const days = rentalDaysBetween(dayKeyOf(start), dayKeyOf(end));
  const priced = await loadPricedItems(organizationId, [comboId, fromId, toId], tx);
  const combo = priced.get(comboId), from = priced.get(fromId), to = priced.get(toId);
  if (!combo || !from || !to) return { known: false, days };
  const diff = substitutionPrice(pricedProduct(from, "RETAIL", true), pricedProduct(to, "RETAIL", true), perCombo, days);
  const packageBefore = priceLine(pricedProduct(combo, "RETAIL", true), days).total;
  if (!diff.known || packageBefore <= 0) return { known: false, days };
  return { known: true, days, delta: diff.delta, packageBefore, packageAfter: repricedPackageTotal(packageBefore, diff.delta) };
}

export type SubstituteResult =
  | { ok: true; combo: { id: string; name: string }; event: { id: string; name: string }; from: { id: string; name: string }; to: { id: string; name: string }; units: number; price: SubstitutionPriceReport }
  | { ok: false; reason: "not-found"; message: string }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "conflict"; message: string }
  | { ok: false; reason: "insufficient"; message: string; available: number; needed: number };

/**
 * Sustitución autorizada de un componente en un combo ya comprometido: se libera
 * el componente original y se compromete otro ítem de la MISMA categoría, con el
 * stock del sustituto validado bajo lock. El permiso (`inventory.write`) y la
 * auditoría los pone el endpoint; acá se garantiza la regla de negocio.
 */
export async function substituteComboComponent(options: {
  organizationId: string;
  assignmentId: string;
  /** Componente de la definición del combo que se reemplaza. */
  componentId: string;
  /** Ítem sustituto (el propio original revierte la sustitución). */
  substituteId: string;
}): Promise<SubstituteResult> {
  return db.$transaction(
    async (tx) => {
      const found = await comboRowById(tx, options.organizationId, options.assignmentId);
      if (!found) return { ok: false, reason: "not-found", message: "La asignación no existe en esta empresa." } as const;
      const state0 = await readComboState(tx, options.organizationId, found.eventId, found.inventoryId);
      if (!state0) return { ok: false, reason: "not-found", message: "La asignación no es un combo." } as const;
      // Se bloquean también el sustituto y el reemplazo actual (si ya hubo uno).
      const subs0 = parseComboSubstitutions(state0.row?.comboSubstitutions);
      await lockInventoryItems(tx, options.organizationId, [
        state0.combo.id,
        ...state0.definition.map((row) => row.componentId),
        ...Object.values(subs0),
        options.substituteId,
      ]);
      const state = await readComboState(tx, options.organizationId, found.eventId, found.inventoryId);
      if (!state?.row || state.row.id !== found.id) return { ok: false, reason: "not-found", message: "La asignación no existe en esta empresa." } as const;
      const row = state.row;
      const now = new Date();
      if (!assignmentCountsAt(row, now)) return { ok: false, reason: "conflict", message: "El combo está liberado o su retención venció: volvé a asignarlo." } as const;
      const event = await tx.event.findFirst({ where: { id: row.eventId, organizationId: options.organizationId }, select: EVENT_RANGE_SELECT });
      if (!event) return { ok: false, reason: "not-found", message: "El evento no existe en esta empresa." } as const;

      const definition = state.definition.find((entry) => entry.componentId === options.componentId);
      if (!definition) return { ok: false, reason: "invalid", message: "Ese ítem no es un componente del combo." } as const;
      const subs = parseComboSubstitutions(row.comboSubstitutions);
      const currentId = subs[options.componentId] ?? options.componentId;
      if (currentId === options.substituteId) return { ok: false, reason: "invalid", message: "Ese ítem ya es el componente actual." } as const;
      // El sustituto no puede ser otro componente en uso (se duplicaría la fila).
      const inUse = new Set(effectiveComponents(state.definition, subs).map((entry) => entry.componentId));
      if (inUse.has(options.substituteId)) return { ok: false, reason: "invalid", message: "Ese ítem ya forma parte del combo." } as const;

      const [current, substitute] = await Promise.all([
        tx.inventoryItem.findFirst({ where: { id: currentId, organizationId: options.organizationId }, select: COMPONENT_ITEM_SELECT }),
        tx.inventoryItem.findFirst({ where: { id: options.substituteId, organizationId: options.organizationId }, select: COMPONENT_ITEM_SELECT }),
      ]);
      if (!current) return { ok: false, reason: "not-found", message: "El componente actual no existe en esta empresa." } as const;
      if (!substitute) return { ok: false, reason: "not-found", message: "El ítem sustituto no existe en esta empresa." } as const;
      if (current.categoryId && substitute.categoryId ? substitute.categoryId !== current.categoryId : substitute.category !== current.category) {
        return { ok: false, reason: "invalid", message: `Solo se puede sustituir por un ítem de la misma categoría («${current.category}»).` } as const;
      }
      if (await isComboItem(tx, options.organizationId, substitute.id)) {
        return { ok: false, reason: "invalid", message: "Un combo no puede ser componente de otro combo." } as const;
      }
      if (BLOCKED_INVENTORY_STATUSES.includes(substitute.status)) {
        return { ok: false, reason: "conflict", message: `«${substitute.name}» está ${substitute.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede usar.` } as const;
      }

      const units = definition.quantity * row.quantity;
      const [fromRow, toRow] = await Promise.all([readComboRow(tx, row.eventId, current.id), readComboRow(tx, row.eventId, substitute.id)]);
      if (!fromRow || !assignmentCountsAt(fromRow, now) || fromRow.comboQuantity < units) {
        return { ok: false, reason: "conflict", message: `Las unidades de «${current.name}» ya no coinciden con el combo: volvé a asignarlo.` } as const;
      }
      if (inMovement(fromRow) || (toRow && inMovement(toRow))) {
        return { ok: false, reason: "conflict", message: "Un componente ya tiene salida o devolución registrada: no se puede sustituir." } as const;
      }
      const toCounted = Boolean(toRow && assignmentCountsAt(toRow, now));
      const toOther = toCounted && toRow ? toRow.quantity : 0;
      const start = row.startsAt ?? event.setupAt ?? event.startsAt;
      const end = row.endsAt ?? event.strikeAt ?? event.endsAt;
      // La fila del sustituto es única por evento: si ya tiene unidades en otro rango, no se mezclan.
      if (toCounted && toRow && toOther > 0) {
        const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
        const toStart = toRow.startsAt ?? event.setupAt ?? event.startsAt;
        const toEnd = toRow.endsAt ?? event.strikeAt ?? event.endsAt;
        if (!sameTime(toStart, start) || !sameTime(toEnd, end)) {
          return {
            ok: false,
            reason: "conflict",
            message: `«${substitute.name}» ya está asignado en «${event.name}» con otro rango de fechas: alineá las fechas antes de sustituir.`,
          } as const;
        }
      }
      const settings = await loadRentalSettings(options.organizationId, tx);
      const availability = await availabilityForRange({
        organizationId: options.organizationId,
        item: { ...substitute, maintenance: maintenanceUnits(substitute), buffers: resolveRentalBuffers(settings, substitute) },
        startsAt: start ?? OPEN_RANGE_START,
        endsAt: end ?? OPEN_RANGE_END,
        excludeId: toRow?.id ?? null,
        client: tx,
      });
      if (units > Math.max(0, availability.available - toOther)) {
        const free = Math.max(0, availability.available - toOther);
        return {
          ok: false,
          reason: "insufficient",
          message: `Sin disponibilidad de «${substitute.name}»: hacen falta ${units} y hay ${free} libres en el rango del evento.`,
          available: free,
          needed: units,
        } as const;
      }

      // Origen: resta la parte del combo (borra la fila si queda en cero).
      const left = fromRow.quantity - units;
      if (left <= 0) await tx.eventInventory.delete({ where: { id: fromRow.id } });
      else await tx.eventInventory.update({ where: { id: fromRow.id }, data: { quantity: left, comboQuantity: fromRow.comboQuantity - units } });
      // Destino: suma la parte del combo sobre lo que ya hubiera (suelto u otros combos).
      await tx.eventInventory.upsert({
        where: { eventId_inventoryId: { eventId: row.eventId, inventoryId: substitute.id } },
        create: {
          id: randomUUID(),
          eventId: row.eventId,
          inventoryId: substitute.id,
          quantity: units,
          comboQuantity: units,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          organizationId: options.organizationId,
          holdExpiresAt: row.holdExpiresAt,
          budgetId: row.budgetId,
        },
        update: {
          quantity: toOther + units,
          comboQuantity: (toCounted && toRow ? toRow.comboQuantity : 0) + units,
          organizationId: options.organizationId,
          releasedAt: null,
          ...(toCounted && toRow && toRow.holdExpiresAt !== null && row.holdExpiresAt === null ? { holdExpiresAt: null } : {}),
          ...(toCounted ? {} : { holdExpiresAt: row.holdExpiresAt, startsAt: row.startsAt, endsAt: row.endsAt }),
        },
      });
      const nextSubs = { ...subs };
      if (options.substituteId === options.componentId) delete nextSubs[options.componentId];
      else nextSubs[options.componentId] = options.substituteId;
      await tx.eventInventory.update({
        where: { id: row.id },
        data: { comboSubstitutions: Object.keys(nextSubs).length ? nextSubs : Prisma.DbNull },
      });
      const price = await substitutionPriceReport(tx, options.organizationId, state.combo.id, current.id, substitute.id, definition.quantity, start, end);
      return {
        ok: true,
        combo: { id: state.combo.id, name: state.combo.name },
        event: { id: event.id, name: event.name },
        from: { id: current.id, name: current.name },
        to: { id: substitute.id, name: substitute.name },
        units,
        price,
      } as const;
    },
    { timeout: 20_000 },
  );
}

// ── Lectura: definición y capacidad ───────────────────────────────────────────

export type ComboDefinition = {
  id: string;
  components: Array<ComboComponentDef & { category: string; status: InventoryStatus }>;
};

/** Definiciones de combos de la empresa (todas o las pedidas). Los ajenos no aparecen. */
export async function loadComboDefinitions(organizationId: string, comboIds?: ReadonlyArray<string>): Promise<Map<string, ComboDefinition>> {
  const rows = await db.inventoryComponent.findMany({
    where: { organizationId, parent: live, ...(comboIds ? { parentId: { in: [...comboIds] } } : {}) },
    orderBy: [{ parentId: "asc" }, { component: { name: "asc" } }],
    select: { parentId: true, componentId: true, quantity: true, component: { select: { name: true, category: true, status: true } } },
  });
  const map = new Map<string, ComboDefinition>();
  for (const row of rows) {
    const entry = map.get(row.parentId) ?? { id: row.parentId, components: [] };
    entry.components.push({ componentId: row.componentId, name: row.component.name, quantity: row.quantity, category: row.component.category, status: row.component.status });
    map.set(row.parentId, entry);
  }
  // Juegos incompletos (importados sin piezas): son combos sin componentes, sin stock propio.
  const incomplete = await db.inventoryItem.findMany({
    where: { organizationId, comboIncomplete: true, ...(comboIds ? { id: { in: [...comboIds] } } : {}) },
    select: { id: true },
  });
  for (const row of incomplete) if (!map.has(row.id)) map.set(row.id, { id: row.id, components: [] });
  return map;
}

/**
 * Capacidad de combos en un rango (misma disponibilidad que el resto del
 * módulo, con tiempos de preparación y unidades fuera de servicio). Una sola
 * lectura de asignaciones para todos los componentes.
 */
export async function comboCapacitiesForRange(options: {
  organizationId: string;
  comboIds?: ReadonlyArray<string>;
  startsAt: Date;
  endsAt: Date;
}): Promise<Map<string, ComboCapacity>> {
  const definitions = await loadComboDefinitions(options.organizationId, options.comboIds);
  const componentIds = [...new Set([...definitions.values()].flatMap((definition) => definition.components.map((component) => component.componentId)))];
  const result = new Map<string, ComboCapacity>();
  if (componentIds.length === 0) return result;
  const [items, settings] = await Promise.all([
    db.inventoryItem.findMany({ where: { id: { in: componentIds }, organizationId: options.organizationId }, select: COMPONENT_ITEM_SELECT }),
    loadRentalSettings(options.organizationId),
  ]);
  const rows = await loadCommittedAssignments({
    organizationId: options.organizationId, inventoryIds: componentIds,
    range: { startsAt: options.startsAt, endsAt: options.endsAt, bufferMinutes: Math.max(0, ...items.map((item) => {
      const buffers = resolveRentalBuffers(settings, item);
      return buffers.beforeMin + buffers.afterMin;
    })) },
  });

  const availableById = new Map<string, number>();
  for (const item of items) {
    const availability = buildAvailability(
      { ...item, maintenance: maintenanceUnits(item), buffers: resolveRentalBuffers(settings, item) },
      rows.filter((row) => row.inventoryId === item.id) as AssignmentRecord[],
      options.startsAt,
      options.endsAt,
    );
    availableById.set(item.id, availability.available);
  }
  for (const [id, definition] of definitions) result.set(id, comboCapacity(definition.components, availableById));
  return result;
}

// ── Alta y edición de la definición ──────────────────────────────────────────

export type SaveComboResult =
  | { ok: true; created: boolean; combo: { id: string; name: string; category: string }; components: ComboComponentInput[]; before: ComboComponentInput[] }
  | { ok: false; reason: "invalid" | "not-found" | "component-missing" | "nested" | "has-reservations" | "duplicate-sku"; message: string };


/** A domain failure inside a transaction must roll back too: lock cleanup and
 * category resolution can write before the final combo mutation. */
class ComboSaveRejected extends Error {
  constructor(readonly result: Extract<SaveComboResult, { ok: false }>) {
    super(result.message);
  }
}
function rejectComboSave(result: Extract<SaveComboResult, { ok: false }>): never {
  throw new ComboSaveRejected(result);
}

export type ComboItemData = {
  name: string;
  /** Categoría o ruta («Combos», «Mobiliario / Sofás»); el helper único resuelve el id y el espejo. */
  category: string;
  subcategory?: string | null;
  sku: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  prices?: Partial<Record<"listPrice" | "wholesalePrice" | "minimumPrice", number>>;
  /** Precio del paquete por días (escalones); ausente = no cambia, lista = reemplaza. */
  priceTiers?: AudiencePriceTier[];
};

/**
 * Crea o edita un combo. Sin unidades propias (`quantity` 0), sin anidar combos y
 * con todos los componentes de la misma empresa (uno ajeno es «no existe»). Un
 * combo con reservas activas no cambia de composición.
 */
export async function saveCombo(options: {
  organizationId: string;
  id?: string | null;
  data: ComboItemData;
  components: unknown;
  /**
   * Importación: convierte una unidad existente en combo. Solo si no tiene reservas (ninguna
   * asignación a eventos) ni unidades con historial (fuera de servicio o con incidentes); sus
   * unidades «limpias» se retiran dentro de la misma transacción.
   */
  convertFromUnit?: boolean;
}): Promise<SaveComboResult> {
  const parsed = readComboComponents(options.components);
  if (!parsed.ok) return { ok: false, reason: "invalid", message: parsed.error };
  const { organizationId } = options;
  try {
    return await db.$transaction(
      async (tx): Promise<SaveComboResult> => {
        const created = !options.id;
        const comboId = options.id || randomUUID();
        const componentIds = parsed.components.map((component) => component.componentId);
        // Topology edits lock parent and proposed pieces together in the same
        // ordered lock as stock writers. Concurrent A→B / B→A cannot both pass.
        const lockedIds = await lockInventoryItems(tx, organizationId, [comboId, ...componentIds]);
        let before: ComboComponentInput[] = [];
        let removeCleanUnits = false;
        if (!created) {
          if (!lockedIds.has(comboId)) rejectComboSave({ ok: false, reason: "not-found", message: "El combo no existe en esta empresa." });
          const existing = await tx.inventoryItem.findFirst({ where: { id: comboId, organizationId }, select: { id: true, comboIncomplete: true, _count: { select: { units: true } } } });
          if (!existing) rejectComboSave({ ok: false, reason: "not-found", message: "El combo no existe en esta empresa." });
          before = (await tx.inventoryComponent.findMany({ where: { parentId: comboId, organizationId }, select: { componentId: true, quantity: true } })).map((row) => ({ componentId: row.componentId, quantity: row.quantity }));
          // Un juego incompleto (sin piezas) se puede completar; una unidad solo si la importación la convierte.
          if (before.length === 0 && !existing.comboIncomplete) {
            if (!options.convertFromUnit) rejectComboSave({ ok: false, reason: "invalid", message: "Ese ítem no es un combo." });
            const reservations = await tx.eventInventory.count({ where: { inventoryId: comboId, event: { organizationId } } });
            if (reservations > 0) rejectComboSave({ ok: false, reason: "has-reservations", message: "El producto tiene reservas: no se puede convertir en juego." });
            const withHistory = await tx.inventoryUnit.count({
              where: { inventoryId: comboId, organizationId, OR: [{ status: { not: "AVAILABLE" } }, { incidents: { some: {} } }] },
            });
            if (withHistory > 0) rejectComboSave({ ok: false, reason: "invalid", message: "El producto tiene unidades con historial (mantenimiento, daños o retiros): no se puede convertir en juego." });
            removeCleanUnits = true;
          }
          const active = await tx.eventInventory.count({ where: { inventoryId: comboId, ...committedAssignmentWhere(organizationId) } });
          if (active > 0) {
            rejectComboSave({ ok: false, reason: "has-reservations", message: "El combo tiene reservas activas: liberalas antes de cambiar sus componentes." });
          }
        }

        if (componentIds.includes(comboId)) rejectComboSave({ ok: false, reason: "nested", message: "Un combo no puede contenerse a sí mismo." });
        const items = await tx.inventoryItem.findMany({ where: { id: { in: componentIds }, organizationId }, select: { id: true, name: true, comboIncomplete: true } });
        if (items.length !== componentIds.length) {
          rejectComboSave({ ok: false, reason: "component-missing", message: "Algún componente no existe en esta empresa." });
        }
        // An incomplete game is still a combo, even before it has edges.
        const incomplete = items.find((item) => item.comboIncomplete);
        if (incomplete) rejectComboSave({ ok: false, reason: "nested", message: `«${incomplete.name}» es un juego incompleto: un combo no puede contener otro combo.` });
        // Sin combos dentro de combos: ni un componente que sea combo ni un combo que ya sea componente.
        const nestedComponent = await tx.inventoryComponent.findFirst({ where: { organizationId, parentId: { in: componentIds } }, select: { parentId: true } });
        if (nestedComponent) {
          const name = items.find((item) => item.id === nestedComponent.parentId)?.name ?? "un componente";
          rejectComboSave({ ok: false, reason: "nested", message: `«${name}» es un combo: un combo no puede contener otro combo.` });
        }
        if (!created) {
          const usedAsComponent = await tx.inventoryComponent.count({ where: { organizationId, componentId: comboId } });
          if (usedAsComponent > 0) {
            rejectComboSave({ ok: false, reason: "nested", message: "Este ítem ya es componente de otro combo: no puede ser a la vez un combo." });
          }
        }

        const resolvedCategory = await resolveInventoryCategory(tx, organizationId, { category: options.data.category, subcategory: options.data.subcategory });
        if (!resolvedCategory) rejectComboSave({ ok: false, reason: "invalid", message: "La categoría no es válida." });
        const itemData = {
          name: options.data.name,
          ...categoryWriteData(resolvedCategory),
          sku: options.data.sku,
          ...(options.data.notes !== undefined ? { notes: options.data.notes } : {}),
          ...(options.data.imageUrl !== undefined ? { imageUrl: options.data.imageUrl } : {}),
          ...(options.data.prices ?? {}),
        };
        // All domain validation is complete. Physical units are removed only
        // now; any later database/write failure rejects and rolls back the tx.
        if (removeCleanUnits) await tx.inventoryUnit.deleteMany({ where: { inventoryId: comboId, organizationId } });
        if (created) {
          await tx.inventoryItem.create({ data: { id: comboId, organizationId, quantity: 0, ...itemData } });
        } else {
          // Con piezas deja de estar incompleto; un combo no tiene stock propio (quantity 0).
          await tx.inventoryItem.update({ where: { id: comboId }, data: { ...itemData, comboIncomplete: false, quantity: 0 } });
          await tx.inventoryComponent.deleteMany({ where: { parentId: comboId, organizationId } });
        }
        if (options.data.priceTiers) await replacePriceTiers(tx, organizationId, comboId, options.data.priceTiers);
        await tx.inventoryComponent.createMany({
          data: parsed.components.map((component) => ({ id: randomUUID(), organizationId, parentId: comboId!, componentId: component.componentId, quantity: component.quantity })),
        });
        return { ok: true, created, combo: { id: comboId, name: options.data.name, category: resolvedCategory.text }, components: parsed.components, before };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ComboSaveRejected) return error.result;
    if (isUniqueConstraintError(error)) return { ok: false, reason: "duplicate-sku", message: await skuConflictMessage(organizationId, options.data.sku) };
    throw error;
  }
}

// ── Listados: combos con su capacidad ────────────────────────────────────────

export type ComboView = {
  /** Combos que se pueden armar ahora (o en el rango pedido). */
  capacity: number;
  limiting: { componentId: string; name: string; available: number; perCombo: number } | null;
  components: Array<{ componentId: string; name: string; category: string; quantity: number; available: number; canMake: number; status: InventoryStatus }>;
  /** Juego sin piezas cargadas: no se puede reservar hasta completarlo. */
  incomplete?: boolean;
};

type ListedRow = {
  id: string;
  availability: {
    committedNow: number;
    availableNow: number;
    overcommittedNow: boolean;
    maintenanceNow: number;
    range?: { available: number; committed: number; overcommitted: boolean; conflicts: unknown[] } | null;
  };
};

/**
 * Completa las filas de la lista o del selector: los combos no tienen stock
 * propio, así que su «libres» es la capacidad (mínimo de sus componentes) y se
 * agrega la composición con el componente limitante. `rangeCapacities` (vista por
 * rango) reemplaza la capacidad del rango.
 */
export function withComboAvailability<T extends ListedRow>(
  rows: ReadonlyArray<T>,
  definitions: ReadonlyMap<string, ComboDefinition>,
  rangeCapacities?: ReadonlyMap<string, ComboCapacity> | null,
): Array<T & { combo?: ComboView }> {
  const availableNow = new Map(rows.map((row) => [row.id, row.availability.availableNow]));
  return rows.map((row) => {
    const definition = definitions.get(row.id);
    if (!definition) return row;
    const capacityNow = comboCapacity(definition.components, availableNow);
    const range = rangeCapacities?.get(row.id) ?? null;
    const shown = range ?? capacityNow;
    const view: ComboView = {
      capacity: shown.capacity,
      limiting: shown.limiting
        ? { componentId: shown.limiting.componentId, name: shown.limiting.name, available: shown.limiting.available, perCombo: shown.limiting.quantity }
        : null,
      components: shown.components.map((component) => ({
        componentId: component.componentId,
        name: component.name,
        category: definition.components.find((entry) => entry.componentId === component.componentId)?.category ?? "",
        quantity: component.quantity,
        available: component.available,
        canMake: component.canMake,
        status: definition.components.find((entry) => entry.componentId === component.componentId)?.status ?? "AVAILABLE",
      })),
      ...(definition.components.length === 0 ? { incomplete: true } : {}),
    };
    return {
      ...row,
      availability: {
        ...row.availability,
        committedNow: 0,
        availableNow: capacityNow.capacity,
        overcommittedNow: false,
        maintenanceNow: 0,
        ...(row.availability.range !== undefined
          ? {
              range: row.availability.range
                ? { ...row.availability.range, committed: 0, overcommitted: false, available: range ? range.capacity : row.availability.range.available }
                : null,
            }
          : {}),
      },
      combo: view,
    };
  });
}
