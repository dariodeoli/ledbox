import { Prisma } from "@prisma/client";

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

