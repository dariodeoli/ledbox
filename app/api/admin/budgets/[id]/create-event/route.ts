import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError } from "@/lib/server/http";
import { planLimitViolation } from "@/lib/server/plan-limits";
import { reserveBudgetInventory } from "@/lib/server/inventory-availability";
import { QuoteComparisonError } from "@/lib/server/quote-comparison";
import { auditBudgetEvent, createEventForBudget, PlanLimitError } from "@/lib/server/budget-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/budgets/[id]/create-event`: crea el evento de un presupuesto
 * aprobado que todavía no lo tiene (`events.write`, acotado a la empresa
 * activa). Es el respaldo manual: al aprobar el evento se crea solo
 * (`ensureEventForApprovedBudget`); este botón cubre el caso en que esa creación
 * falló (p. ej. límite del plan). Misma lógica: `createEventForBudget`.
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
    const created = await db.$transaction((tx) => createEventForBudget(tx, auth.context, id, { confirmDraft: false }));
    await auditBudgetEvent(auth.context, created, "");
    const reservations = await reserveBudgetInventory({ organizationId, budgetId: id, context: auth.context });
    return Response.json({ event: created.event, reservations }, { status: 201 });
  } catch (error) {
    if (error instanceof PlanLimitError) return jsonError(error.violation.error, 403, error.violation.code);
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    console.error("[budgets/create-event] no se pudo crear el evento", error);
    throw error;
  }
}
