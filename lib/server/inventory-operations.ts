import { randomUUID } from "node:crypto";
import { Prisma, type InventoryIncidentKind, type InventoryIncidentStatus, type InventoryUnitStatus } from "@prisma/client";
import { db } from "./db";
import { proposeReturnCharges } from "./rental-settlement";
import { recordDeliveryNoteLine } from "./delivery-notes";
import { lockInventoryItems } from "./inventory-availability";
import { beginInventoryUnitIncidentCycle, syncInventoryQuantity } from "./inventory-units";

/**
 * Operaciones de alquiler (fase 4): salida parcial, devolución parcial con daños y
 * faltantes, e incidentes de inventario.
 *
 * Todo cambio que toca capacidad o estado de unidades corre en UNA transacción con
 * `FOR UPDATE` sobre el ítem (`lockInventoryItems`, el mismo lock del motor de
 * disponibilidad): dos devoluciones simultáneas se serializan y la segunda valida
 * contra lo que dejó la primera, así que nada se duplica ni se devuelve de más.
 *
 * Capacidad: una unidad con código dañada o perdida deja de estar libre por su
 * estado (DAMAGED/LOST); un daño o faltante por cantidad (ítem sin unidades con
 * código) suma a `InventoryItem.incidentHold`, que el motor descuenta de la
 * capacidad igual que una unidad en mantenimiento. Se libera al resolver el
 * incidente y, si se da de baja, la cantidad sale del ítem.
 */

export type OperationFailure = { ok: false; status: 400 | 404 | 409; error: string };
const fail = (status: OperationFailure["status"], error: string): OperationFailure => ({ ok: false, status, error });

const OPEN_STATUSES: readonly InventoryIncidentStatus[] = ["OPEN", "IN_REPAIR"];
const MAX_NOTES = 400;
/** Marca visible de los incidentes por cantidad sobre un ítem que sí tiene unidades con código. */
export const UNIDENTIFIED_NOTE = "Unidad sin identificar";

type Tx = Prisma.TransactionClient;

type MovementRow = {
  quantity: number;
  checkedOut: boolean;
  checkedOutAt: Date | null;
  checkedIn: boolean;
  checkedInAt: Date | null;
  checkoutQuantity: number;
  returnedQuantity: number;
  missingQuantity: number;
};

/** Unidades que salieron: lo despachado o, en filas viejas con salida de una vez, toda la asignación. */
export function dispatchedQuantity(row: Pick<MovementRow, "quantity" | "checkedOut" | "checkedOutAt" | "checkoutQuantity">): number {
  if (row.checkoutQuantity > 0) return row.checkoutQuantity;
  return row.checkedOut || row.checkedOutAt ? row.quantity : 0;
}

/** Unidades que salieron y todavía no volvieron ni se declararon faltantes. */
export function pendingReturnQuantity(row: MovementRow): number {
  if (row.checkedIn || row.checkedInAt) return 0;
  return Math.max(0, dispatchedQuantity(row) - row.returnedQuantity - row.missingQuantity);
}

function readNotes(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_NOTES) : null;
}

// ── Salida (despacho) ─────────────────────────────────────────────────────────

export async function dispatchAssignment(options: {
  organizationId: string;
  assignmentId: string;
  quantity?: number;
  at: Date;
  condition: string;
  note?: string | null;
  actorId?: string | null;
}) {
  return db.$transaction(
    async (tx) => {
      const probe = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        select: { inventoryId: true },
      });
      if (!probe) return fail(404, "La asignación no existe en esta empresa.");
      await lockInventoryItems(tx, options.organizationId, [probe.inventoryId]);
      const row = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        include: { inventory: { select: { name: true, sku: true } }, event: { select: { name: true } } },
      });
      if (!row) return fail(404, "La asignación no existe en esta empresa.");
      if (row.releasedAt) return fail(409, "La asignación fue liberada: volvé a asignar el equipo.");
      if (row.holdExpiresAt) return fail(409, "La asignación es una retención sin confirmar: confirmala antes de despachar.");
      if (row.checkedIn || row.checkedInAt) return fail(409, "La devolución de esta asignación ya está cerrada.");
      const sent = dispatchedQuantity(row);
      const remaining = row.quantity - sent;
      if (remaining <= 0) return fail(409, "La salida ya está registrada para todas las unidades de esta asignación.");
      const quantity = options.quantity ?? remaining;
      if (!Number.isInteger(quantity) || quantity < 1) return fail(400, "La cantidad a despachar debe ser un entero mayor a cero.");
      if (quantity > remaining) {
        return fail(409, `Solo quedan ${remaining} unidad${remaining === 1 ? "" : "es"} por despachar de «${row.inventory.name}».`);
      }
      const assignment = await tx.eventInventory.update({
        where: { id: row.id },
        data: {
          checkedOut: true,
          checkedOutAt: row.checkedOutAt ?? options.at,
          checkoutQuantity: sent + quantity,
          conditionOut: options.condition,
          checkedOutById: options.actorId ?? null,
          checkoutNote: readNotes(options.note),
        },
      });
      // Remito de salida (P1-5): con lo realmente despachado ahora, en la misma transacción.
      const deliveryNote = await recordDeliveryNoteLine(tx, {
        organizationId: options.organizationId,
        eventId: row.eventId,
        kind: "OUT",
        actorId: options.actorId,
        line: {
          assignmentId: row.id,
          inventoryId: row.inventoryId,
          name: row.inventory.name,
          sku: row.inventory.sku,
          ordered: row.quantity,
          moved: quantity,
          damaged: 0,
          missing: 0,
        },
      });
      return { ok: true as const, assignment, before: row, quantity, remaining: remaining - quantity, deliveryNote };
    },
    { timeout: 15_000 },
  );
}

// ── Devolución (parcial) ──────────────────────────────────────────────────────

export type ReturnOptions = {
  organizationId: string;
  assignmentId: string;
  /** Unidades que vuelven ahora (incluye las dañadas). Sin dato: todo lo pendiente menos los faltantes. */
  quantity?: number;
  /** De las que vuelven, cuántas vuelven dañadas. */
  damaged?: number;
  /** Unidades que no vuelven (faltantes). */
  missing?: number;
  damagedUnitIds?: readonly string[];
  missingUnitIds?: readonly string[];
  at: Date;
  condition: string;
  notes?: string | null;
  actorId?: string | null;
};

async function checkUnits(tx: Tx, organizationId: string, inventoryId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx.inventoryUnit.findMany({
    where: { id: { in: [...ids] }, organizationId, inventoryId },
    select: { id: true, code: true, status: true },
  });
}

/**
 * Abre los incidentes de un lote de daños o faltantes. Si el ítem tiene unidades con
 * código, cada unidad elegida pasa a DAMAGED/LOST y lleva su incidente; si no, un
 * solo incidente por cantidad suma a `incidentHold`.
 */
async function openIncidents(
  tx: Tx,
  context: {
    organizationId: string;
    inventoryId: string;
    assignmentId: string | null;
    eventId: string | null;
    actorId: string | null;
    notes: string | null;
    hasUnits: boolean;
  },
  kind: Extract<InventoryIncidentKind, "DAMAGE" | "MISSING">,
  quantity: number,
  unitIds: readonly string[],
) {
  if (quantity === 0) return [];
  const base = {
    organizationId: context.organizationId,
    inventoryId: context.inventoryId,
    assignmentId: context.assignmentId,
    eventId: context.eventId,
    kind,
    status: "OPEN" as const,
    notes: context.notes,
    openedById: context.actorId,
  };
  // Contrato viejo: ítem con unidades y cantidad sin códigos. Se retiene por cantidad y
  // el incidente queda marcado «unidad sin identificar» hasta que se lo resuelva.
  const unidentified = context.hasUnits && unitIds.length === 0;
  if (context.hasUnits && !unidentified) {
    const unitStatus: InventoryUnitStatus = kind === "DAMAGE" ? "DAMAGED" : "LOST";
    const created = [];
    for (const unitId of unitIds) {
      const unitCycle = await beginInventoryUnitIncidentCycle(tx, context.organizationId, unitId);
      await tx.inventoryUnit.update({ where: { id: unitId }, data: { status: unitStatus } });
      created.push(await tx.inventoryIncident.create({ data: { id: randomUUID(), ...base, unitId, unitCycle, quantity: 1 } }));
    }
    await syncInventoryQuantity(tx, context.inventoryId);
    return created;
  }
  const notes = unidentified ? [UNIDENTIFIED_NOTE, base.notes].filter(Boolean).join(" · ").slice(0, 1200) : base.notes;
  const incident = await tx.inventoryIncident.create({
    data: { id: randomUUID(), ...base, notes, unitId: null, quantity, heldByQuantity: true },
  });
  await tx.inventoryItem.update({ where: { id: context.inventoryId }, data: { incidentHold: { increment: quantity } } });
  return [incident];
}

export async function returnAssignment(options: ReturnOptions) {
  const damagedUnitIds = [...new Set(options.damagedUnitIds ?? [])];
  const missingUnitIds = [...new Set(options.missingUnitIds ?? [])];
  return db.$transaction(
    async (tx) => {
      const probe = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        select: { inventoryId: true },
      });
      if (!probe) return fail(404, "La asignación no existe en esta empresa.");
      // Mismo lock que el motor de disponibilidad: la segunda devolución espera a la primera.
      await lockInventoryItems(tx, options.organizationId, [probe.inventoryId]);
      const row = await tx.eventInventory.findFirst({
        where: { id: options.assignmentId, event: { organizationId: options.organizationId } },
        include: { inventory: { select: { name: true, sku: true, replacementCost: true } }, event: { select: { name: true, endsAt: true, strikeAt: true } } },
      });
      if (!row) return fail(404, "La asignación no existe en esta empresa.");
      const sent = dispatchedQuantity(row);
      if (sent === 0) return fail(409, "Registrá primero la salida del equipo.");
      if (row.checkedIn || row.checkedInAt) return fail(409, "La devolución ya está registrada para esta asignación.");
      const pending = pendingReturnQuantity(row);
      const missing = options.missing ?? 0;
      const quantity = options.quantity ?? Math.max(0, pending - missing);
      const damaged = options.damaged ?? 0;
      if (![quantity, damaged, missing].every((value) => Number.isInteger(value) && value >= 0)) {
        return fail(400, "Devueltas, dañadas y faltantes deben ser enteros mayores o iguales a cero.");
      }
      if (quantity + missing < 1) return fail(400, "Indicá cuántas unidades vuelven o cuántas faltan.");
      if (damaged > quantity) return fail(400, "Las unidades dañadas tienen que estar entre las que vuelven.");
      if (quantity + missing > pending) {
        return fail(
          409,
          pending === 0
            ? "No quedan unidades pendientes de devolver."
            : `Solo quedan ${pending} unidad${pending === 1 ? "" : "es"} por devolver de «${row.inventory.name}».`,
        );
      }

      const unitCount = await tx.inventoryUnit.count({ where: { inventoryId: row.inventoryId } });
      const hasUnits = unitCount > 0;
      if (hasUnits) {
        // Sin ningún código = contrato viejo (solo cantidades): se acepta y queda «sin identificar».
        if (damagedUnitIds.length > 0 && damagedUnitIds.length !== damaged) return fail(400, `Elegí las ${damaged} unidades dañadas por su código.`);
        if (missingUnitIds.length > 0 && missingUnitIds.length !== missing) return fail(400, `Elegí las ${missing} unidades faltantes por su código.`);
        if (damagedUnitIds.some((id) => missingUnitIds.includes(id))) return fail(400, "Una unidad no puede estar dañada y faltante a la vez.");
        const units = await checkUnits(tx, options.organizationId, row.inventoryId, [...damagedUnitIds, ...missingUnitIds]);
        if (units.length !== damagedUnitIds.length + missingUnitIds.length) return fail(404, "Alguna unidad no existe en este ítem.");
        const unusable = units.find((unit) => unit.status === "DAMAGED" || unit.status === "LOST" || unit.status === "RETIRED");
        if (unusable) return fail(409, `La unidad ${unusable.code} ya figura como dañada, perdida o retirada.`);
      } else if (damagedUnitIds.length || missingUnitIds.length) {
        return fail(400, "Este ítem no tiene unidades con código: indicá solo las cantidades.");
      }

      const notes = readNotes(options.notes);
      const context = {
        organizationId: options.organizationId,
        inventoryId: row.inventoryId,
        assignmentId: row.id,
        eventId: row.eventId,
        actorId: options.actorId ?? null,
        notes,
        hasUnits,
      };
      const incidents = [
        ...(await openIncidents(tx, context, "DAMAGE", damaged, damagedUnitIds)),
        ...(await openIncidents(tx, context, "MISSING", missing, missingUnitIds)),
      ];

      const returnedQuantity = row.returnedQuantity + quantity;
      const missingQuantity = row.missingQuantity + missing;
      const damagedQuantity = row.damagedQuantity + damaged;
      const stillPending = Math.max(0, sent - returnedQuantity - missingQuantity);
      const closed = stillPending === 0;
      const damageNotes = notes ? [row.damageNotes, notes].filter(Boolean).join("\n").slice(0, 1200) : row.damageNotes;
      const assignment = await tx.eventInventory.update({
        where: { id: row.id },
        data: {
          returnedQuantity,
          missingQuantity,
          damagedQuantity,
          damageNotes,
          conditionIn: options.condition,
          checkedInById: options.actorId ?? null,
          // El cierre (checkedIn) es de la última devolución: mientras falte algo, el
          // equipo sigue contando como afuera y no se libera.
          ...(closed ? { checkedIn: true, checkedInAt: options.at } : {}),
        },
      });
      // Alquileres P1-4: la devolución deja cargos PROPUESTOS (demora, roturas, faltantes) para que
      // finanzas los aplique o condone. Idempotente por clave y sin romper la devolución si falla.
      const proposedCharges = await proposeReturnCharges(tx, {
        organizationId: options.organizationId,
        assignment: {
          id: row.id,
          inventoryId: row.inventoryId,
          eventId: row.eventId,
          budgetId: row.budgetId,
          quantity: row.quantity,
          endsAt: row.endsAt,
          returnedQuantity: row.returnedQuantity,
          inventory: { name: row.inventory.name, replacementCost: row.inventory.replacementCost },
          event: { endsAt: row.event.endsAt, strikeAt: row.event.strikeAt },
        },
        incidents: incidents.map((incident) => ({ id: incident.id, kind: incident.kind, quantity: incident.quantity })),
        returnedAt: options.at,
        returnedNow: quantity,
        missingNow: missing,
      });
      // Remito de devolución (P1-5): lo realmente devuelto, dañado y faltante en este movimiento.
      const deliveryNote = await recordDeliveryNoteLine(tx, {
        organizationId: options.organizationId,
        eventId: row.eventId,
        kind: "IN",
        actorId: options.actorId,
        line: {
          assignmentId: row.id,
          inventoryId: row.inventoryId,
          name: row.inventory.name,
          sku: row.inventory.sku,
          ordered: sent,
          moved: quantity,
          damaged,
          missing,
        },
      });
      return { ok: true as const, assignment, before: row, incidents, returned: quantity, damaged, missing, pending: stillPending, closed, proposedCharges, deliveryNote };
    },
    { timeout: 15_000 },
  );
}

// ── Incidentes ────────────────────────────────────────────────────────────────

export const INCIDENT_KINDS: readonly InventoryIncidentKind[] = ["DAMAGE", "MISSING", "REPAIR", "CLEANING"];
export const INCIDENT_TRANSITIONS = ["IN_REPAIR", "RESOLVED", "WRITTEN_OFF"] as const;
export type IncidentTransition = (typeof INCIDENT_TRANSITIONS)[number];

/** Estado de la unidad mientras el incidente sigue abierto. */
function openUnitStatus(kind: InventoryIncidentKind): InventoryUnitStatus {
  if (kind === "DAMAGE") return "DAMAGED";
  if (kind === "MISSING") return "LOST";
  return "MAINTENANCE";
}

/** Alta manual de un incidente (reparación o limpieza que nace fuera de una devolución). */
export async function createIncident(options: {
  organizationId: string;
  inventoryId: string;
  kind: InventoryIncidentKind;
  quantity: number;
  unitId?: string | null;
  eventId?: string | null;
  assignmentId?: string | null;
  notes?: string | null;
  cost?: number | null;
  actorId?: string | null;
}) {
  return db.$transaction(
    async (tx) => {
      const locked = await lockInventoryItems(tx, options.organizationId, [options.inventoryId]);
      if (!locked.has(options.inventoryId)) return fail(404, "El ítem de inventario no existe en esta empresa.");
      const item = await tx.inventoryItem.findFirst({
        where: { id: options.inventoryId, organizationId: options.organizationId },
        select: { id: true, name: true, quantity: true, incidentHold: true, _count: { select: { units: true } } },
      });
      if (!item) return fail(404, "El ítem de inventario no existe en esta empresa.");
      if (options.eventId) {
        const event = await tx.event.findFirst({ where: { id: options.eventId, organizationId: options.organizationId }, select: { id: true } });
        if (!event) return fail(404, "El evento no existe en esta empresa.");
      }
      let assignmentEventId = options.eventId ?? null;
      if (options.assignmentId) {
        const assignment = await tx.eventInventory.findFirst({
          where: { id: options.assignmentId, inventoryId: item.id, event: { organizationId: options.organizationId } },
          select: { id: true, eventId: true },
        });
        if (!assignment) return fail(404, "La asignación no existe en esta empresa.");
        assignmentEventId = assignment.eventId;
      }
      let quantity = options.quantity;
      let unitCycle = 0;
      if (item._count.units > 0) {
        if (!options.unitId) return fail(400, "Elegí la unidad por su código: este ítem tiene unidades.");
        const [unit] = await checkUnits(tx, options.organizationId, item.id, [options.unitId]);
        if (!unit) return fail(404, "La unidad no existe en este ítem.");
        if (unit.status === "DAMAGED" || unit.status === "LOST" || unit.status === "RETIRED") {
          return fail(409, `La unidad ${unit.code} ya figura como dañada, perdida o retirada.`);
        }
        quantity = 1;
        unitCycle = await beginInventoryUnitIncidentCycle(tx, options.organizationId, unit.id);
        await tx.inventoryUnit.update({ where: { id: unit.id }, data: { status: openUnitStatus(options.kind) } });
        await syncInventoryQuantity(tx, item.id);
      } else {
        if (options.unitId) return fail(400, "Este ítem no tiene unidades con código.");
        if (!Number.isInteger(quantity) || quantity < 1) return fail(400, "La cantidad debe ser un entero mayor a cero.");
        const free = item.quantity - item.incidentHold;
        if (quantity > free) return fail(409, `«${item.name}» solo tiene ${Math.max(0, free)} unidad${free === 1 ? "" : "es"} sin incidentes abiertos.`);
        await tx.inventoryItem.update({ where: { id: item.id }, data: { incidentHold: { increment: quantity } } });
      }
      const incident = await tx.inventoryIncident.create({
        data: {
          id: randomUUID(),
          organizationId: options.organizationId,
          inventoryId: item.id,
          assignmentId: options.assignmentId ?? null,
          eventId: assignmentEventId,
          unitId: options.unitId ?? null,
          unitCycle,
          heldByQuantity: item._count.units === 0,
          kind: options.kind,
          quantity,
          status: "OPEN",
          cost: options.cost ?? null,
          notes: readNotes(options.notes),
          openedById: options.actorId ?? null,
        },
      });
      return { ok: true as const, incident, itemName: item.name };
    },
    { timeout: 15_000 },
  );
}

/**
 * Cambio de estado de un incidente: OPEN → IN_REPAIR, y OPEN/IN_REPAIR → RESOLVED
 * (la unidad o la cantidad vuelven a lo libre) o WRITTEN_OFF (la unidad queda RETIRED
 * —o LOST si era un faltante— y la cantidad sale del ítem). RESOLVED y WRITTEN_OFF
 * son finales.
 */
export async function transitionIncident(options: {
  organizationId: string;
  incidentId: string;
  to: IncidentTransition;
  cost?: number | null;
  notes?: string | null;
  actorId?: string | null;
}) {
  return db.$transaction(
    async (tx) => {
      const probe = await tx.inventoryIncident.findFirst({
        where: { id: options.incidentId, organizationId: options.organizationId },
        select: { inventoryId: true },
      });
      if (!probe) return fail(404, "El incidente no existe en esta empresa.");
      await lockInventoryItems(tx, options.organizationId, [probe.inventoryId]);
      const incident = await tx.inventoryIncident.findFirst({
        where: { id: options.incidentId, organizationId: options.organizationId },
        include: { inventory: { select: { name: true } }, unit: { select: { id: true, code: true } } },
      });
      if (!incident) return fail(404, "El incidente no existe en esta empresa.");
      if (!OPEN_STATUSES.includes(incident.status)) return fail(409, "El incidente ya está cerrado: no admite más cambios.");
      if (options.to === "IN_REPAIR") {
        if (incident.status === "IN_REPAIR") return fail(409, "El incidente ya está en reparación.");
        if (incident.kind === "MISSING") return fail(409, "Un faltante no se repara: marcalo como resuelto (apareció) o dalo de baja.");
      }

      const now = new Date();
      const terminal = options.to !== "IN_REPAIR";
      const notes = readNotes(options.notes);
      const mergedNotes = notes ? [incident.notes, notes].filter(Boolean).join("\n").slice(0, 1200) : incident.notes;

      if (incident.unitId) {
        if (options.to === "RESOLVED") {
          // Otro incidente abierto sobre la misma unidad la mantiene fuera de lo libre.
          const others = await tx.inventoryIncident.count({
            where: { unitId: incident.unitId, id: { not: incident.id }, status: { in: [...OPEN_STATUSES] } },
          });
          // Resolver limpieza/reparación no revierte una baja de otro incidente ni un retiro manual.
          // La restauración explícita de unidades sigue siendo una operación del inventario.
          const unit = await tx.inventoryUnit.findFirst({ where: { id: incident.unitId, organizationId: options.organizationId }, select: { status: true, incidentCycle: true } });
          const writtenOff = unit?.status === "LOST" ? await tx.inventoryIncident.count({
            where: { organizationId: options.organizationId, unitId: incident.unitId, unitCycle: incident.unitCycle, status: "WRITTEN_OFF" },
          }) : 0;
          if (others === 0 && unit && unit.incidentCycle === incident.unitCycle && unit.status !== "RETIRED" && writtenOff === 0) {
            await tx.inventoryUnit.update({ where: { id: incident.unitId }, data: { status: "AVAILABLE" } });
          }
        } else if (options.to === "WRITTEN_OFF") {
          await tx.inventoryUnit.update({ where: { id: incident.unitId }, data: { status: incident.kind === "MISSING" ? "LOST" : "RETIRED" } });
        }
        await syncInventoryQuantity(tx, incident.inventoryId);
      } else if (terminal && incident.heldByQuantity) {
        const itemUnits = await tx.inventoryUnit.count({ where: { inventoryId: incident.inventoryId } });
        if (options.to === "WRITTEN_OFF" && itemUnits > 0) {
          return fail(409, "Este incidente no tiene unidad identificada: retirá la unidad desde el inventario y marcalo como resuelto.");
        }
        const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: incident.inventoryId }, select: { quantity: true, incidentHold: true } });
        await tx.inventoryItem.update({
          where: { id: incident.inventoryId },
          data: {
            incidentHold: Math.max(0, item.incidentHold - incident.quantity),
            ...(options.to === "WRITTEN_OFF" ? { quantity: Math.max(0, item.quantity - incident.quantity) } : {}),
          },
        });
      }

      const updated = await tx.inventoryIncident.update({
        where: { id: incident.id },
        data: {
          status: options.to,
          ...(options.cost !== undefined && options.cost !== null ? { cost: options.cost } : {}),
          notes: mergedNotes,
          ...(terminal ? { resolvedAt: now, resolvedById: options.actorId ?? null } : {}),
        },
      });
      return { ok: true as const, incident: updated, before: incident };
    },
    { timeout: 15_000 },
  );
}

// ── Cierre del evento ─────────────────────────────────────────────────────────

export type ClosureBlockers = {
  pendingReturns: Array<{ assignmentId: string; inventoryId: string; name: string; pending: number }>;
  openMissing: Array<{ incidentId: string; inventoryId: string; name: string; quantity: number }>;
};

/**
 * Qué impide cerrar (COMPLETED) un evento: equipos que salieron y no volvieron, y
 * faltantes abiertos sin decisión (resuelto o dado de baja).
 */
export async function eventClosureBlockers(
  organizationId: string,
  eventId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<ClosureBlockers> {
  const [assignments, missing] = await Promise.all([
    client.eventInventory.findMany({
      where: { eventId, event: { organizationId }, releasedAt: null },
      select: {
        id: true,
        inventoryId: true,
        quantity: true,
        checkedOut: true,
        checkedOutAt: true,
        checkedIn: true,
        checkedInAt: true,
        checkoutQuantity: true,
        returnedQuantity: true,
        missingQuantity: true,
        inventory: { select: { name: true } },
      },
    }),
    client.inventoryIncident.findMany({
      where: { organizationId, eventId, kind: "MISSING", status: "OPEN" },
      select: { id: true, inventoryId: true, quantity: true, inventory: { select: { name: true } } },
    }),
  ]);
  return {
    pendingReturns: assignments
      .map((row) => ({ assignmentId: row.id, inventoryId: row.inventoryId, name: row.inventory.name, pending: pendingReturnQuantity(row) }))
      .filter((row) => row.pending > 0),
    openMissing: missing.map((row) => ({ incidentId: row.id, inventoryId: row.inventoryId, name: row.inventory.name, quantity: row.quantity })),
  };
}

/** Mensaje 409 claro de lo que falta resolver, o `null` si el evento se puede cerrar. */
export function closureBlockMessage(blockers: ClosureBlockers): string | null {
  const parts: string[] = [];
  if (blockers.pendingReturns.length) {
    parts.push(
      `faltan devolver ${blockers.pendingReturns.map((row) => `${row.pending} de «${row.name}»`).join(", ")}`,
    );
  }
  if (blockers.openMissing.length) {
    parts.push(
      `hay faltantes abiertos sin decisión (${blockers.openMissing.map((row) => `${row.quantity} de «${row.name}»`).join(", ")}): marcalos como resueltos o dalos de baja`,
    );
  }
  return parts.length ? `No se puede cerrar el evento: ${parts.join(" y ")}.` : null;
}
