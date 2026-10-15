import type { Event, Prisma } from "@prisma/client";
import { assignmentRange, availabilityForRange, committedAssignmentWhere, lockInventoryItems, maintenanceUnits, MAINTENANCE_UNITS_SELECT } from "./inventory-availability";
import { lockLiveEvent } from "./event-lock";

export class EventRescheduleError extends Error {
  constructor(message: string, readonly status: 404 | 409 = 409) { super(message); }
}

/** El mismo orden que las reservas: productos ordenados, luego evento. */
export async function lockEventForEdit(tx: Prisma.TransactionClient, organizationId: string, eventId: string, stockMayChange: boolean): Promise<Event> {
  const assignments = stockMayChange ? await tx.eventInventory.findMany({ where: { eventId, event: { organizationId } }, select: { inventoryId: true } }) : [];
  if (stockMayChange) await lockInventoryItems(tx, organizationId, assignments.map(row => row.inventoryId), { mode: "no-key-update" });
  if (!await lockLiveEvent(tx, organizationId, eventId)) throw new EventRescheduleError("El evento no existe.", 404);
  const event = await tx.event.findFirstOrThrow({ where: { id: eventId, organizationId } });
  if (stockMayChange) {
    const current = await tx.eventInventory.findMany({ where: { eventId }, select: { inventoryId: true } });
    const locked = new Set(assignments.map(row => row.inventoryId));
    if (current.some(row => !locked.has(row.inventoryId))) throw new EventRescheduleError("Las reservas del evento cambiaron mientras editabas. Volvé a intentar.");
  }
  return event;
}

/** Se ejecuta después del update, dentro de la misma transacción: fallar revierte también las fechas/estado. */
export async function guardEventReschedule(tx: Prisma.TransactionClient, organizationId: string, previous: Event, updated: Event): Promise<void> {
  const reopening = previous.status === "CANCELLED" && updated.status !== "CANCELLED";
  const assignments = await tx.eventInventory.findMany({
    where: { eventId: updated.id, ...committedAssignmentWhere(organizationId) },
    include: { inventory: { omit: { imageData: true }, include: { _count: { select: { ...MAINTENANCE_UNITS_SELECT, components: true } } } } },
  });
  for (const assignment of assignments) {
    // Los combos reservan sus piezas: su fila padre no tiene stock propio.
    if (assignment.inventory._count.components > 0) continue;
    const before = assignmentRange({ ...assignment, event: previous });
    const after = assignmentRange({ ...assignment, event: updated });
    if (!reopening && before.start?.getTime() === after.start?.getTime() && before.end?.getTime() === after.end?.getTime()) continue;
    const available = await availabilityForRange({
      organizationId, item: { ...assignment.inventory, maintenance: maintenanceUnits(assignment.inventory) },
      startsAt: after.start ?? new Date(-8.64e15), endsAt: after.end ?? new Date(8.64e15), excludeId: assignment.id, client: tx,
    });
    if (assignment.quantity > available.available) throw new EventRescheduleError(`No se puede cambiar el evento: «${assignment.inventory.name}» necesita ${assignment.quantity} unidades y hay ${available.available} disponibles en las nuevas fechas. Revisá sus reservas.`);
  }
}
