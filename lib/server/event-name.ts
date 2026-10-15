import type { Prisma } from "@prisma/client";
import { QuoteComparisonError } from "./quote-comparison";

/** Nombre público compartido: Event → presupuestos ordenados; nunca presupuesto → Event. */
export async function guardEventNameChange(
  tx: Prisma.TransactionClient,
  organizationId: string,
  eventId: string,
  name: string,
  originalName: unknown,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${eventId} AND "organizationId" = ${organizationId} AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new QuoteComparisonError(404, "Evento no encontrado.");
  await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "eventId" = ${eventId} AND "organizationId" = ${organizationId} ORDER BY "id" FOR UPDATE`;
  const current = await tx.event.findFirstOrThrow({ where: { id: eventId, organizationId } });
  if (originalName !== current.name) throw new QuoteComparisonError(409, "El evento cambió. Actualizá antes de renombrarlo.");
  if (name !== current.name) {
    const accepted = await tx.budget.count({ where: {
      organizationId, eventId,
      OR: [{ approvedAt: { not: null } }, { status: "APPROVED" }, { signatureRequests: { some: { status: { in: ["SIGNED", "VALIDATED"] } } } }],
    } });
    if (accepted) throw new QuoteComparisonError(409, "El evento aparece en una versión aceptada o firmada. Conservá su nombre y usá el ciclo de revisión.");
  }
  return current;
}
