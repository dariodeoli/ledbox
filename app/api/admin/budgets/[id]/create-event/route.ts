import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { planLimitViolation } from "@/lib/server/plan-limits";
import { reserveBudgetInventory } from "@/lib/server/inventory-availability";
import { QuoteComparisonError } from "@/lib/server/quote-comparison";
import { clientDisplayName } from "@/lib/client-identity";
import { budgetReference } from "@/lib/admin-format";
import { eventDataFromBudget } from "@/lib/budget-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/budgets/[id]/create-event`: crea el evento de un presupuesto
 * aprobado que todavía no lo tiene (`events.write`, acotado a la empresa
 * activa). Nunca se crea solo al aprobar: lo dispara el botón «Crear evento».
 *
 * En una transacción con `FOR UPDATE` sobre el presupuesto: dos clics
 * simultáneos crean un solo evento (el segundo recibe 409). El evento nace
 * `CONFIRMED` con el cliente y el nombre del presupuesto y, si existe, la fecha
 * de entrega como inicio. Después se reserva el stock de los ítems vinculados
 * por el camino de siempre (`reserveBudgetInventory`); la reserva no lanza y, si
 * el evento no tiene rango completo, queda como pendiente en la respuesta.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const exists = await db.budget.findFirst({ where: { id, organizationId }, select: { id: true, eventId: true, status: true } });
  if (!exists) return jsonError("Presupuesto no encontrado.", 404);
  if (exists.eventId) return jsonError("El presupuesto ya tiene un evento.", 409);
  if (exists.status !== "APPROVED") return jsonError("Solo se crea el evento de un presupuesto aprobado.", 409);
  const limit = await planLimitViolation(auth.context, "events");
  if (limit) return jsonError(limit.error, 403, limit.code);

  try {
    const created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const budget = await tx.budget.findFirst({
        where: { id, organizationId },
        select: { id: true, title: true, status: true, eventId: true, clientId: true, deliveryAt: true, client: { select: { name: true, company: true, tradeName: true, legalName: true } } },
      });
      if (!budget) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
      if (budget.eventId) throw new QuoteComparisonError(409, "El presupuesto ya tiene un evento.");
      if (budget.status !== "APPROVED") throw new QuoteComparisonError(409, "Solo se crea el evento de un presupuesto aprobado.");
      const data = eventDataFromBudget(budget);
      const event = await tx.event.create({
        data: {
          id: randomUUID(),
          organizationId,
          clientId: budget.clientId,
          ...data,
          tasks: {
            create: [
              { id: randomUUID(), type: "SETUP", title: "Confirmar montaje y acceso al lugar" },
              { id: randomUUID(), type: "EVENT", title: "Verificar equipos y operación del evento" },
              { id: randomUUID(), type: "STRIKE", title: "Coordinar desmontaje y devolución" },
              { id: randomUUID(), type: "COLLECTION", title: "Confirmar cobro / saldo" },
            ],
          },
        },
      });
      await tx.budget.update({ where: { id: budget.id }, data: { eventId: event.id } });
      return { event, budget };
    });

    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Event",
      entityId: created.event.id,
      summary: `Creó el evento «${created.event.name}» desde el presupuesto PRES-${budgetReference(created.budget.id)} «${created.budget.title}» del cliente «${clientDisplayName(created.budget.client)}»`,
      detail: { fields: { budgetId: created.budget.id, status: created.event.status, startsAt: created.event.startsAt?.toISOString() ?? null } },
    });
    const reservations = await reserveBudgetInventory({ organizationId, budgetId: created.budget.id, context: auth.context });
    return Response.json({ event: created.event, reservations }, { status: 201 });
  } catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    console.error("[budgets/create-event] no se pudo crear el evento", error);
    throw error;
  }
}
