import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { roleCan } from "@/lib/server/permissions";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { createEventForBudget, PlanLimitError } from "@/lib/server/budget-event";
import { resolveOrganizationPlan } from "@/lib/server/plan-limits";
import { EventRescheduleError, guardEventReschedule, lockEventForEdit } from "@/lib/server/event-reschedule";
import { QuoteComparisonError } from "@/lib/server/quote-comparison";
import { recordAudit } from "@/lib/server/audit";
import { eventDateViolation, parseEventFields } from "../../../events/event-fields";

export const runtime = "nodejs";

/** Guardado explícito, separado del preview/envío: no envía correo ni aprueba el presupuesto. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  if (!roleCan(auth.context.role, "events.write")) return jsonError("No tenés permiso para editar eventos.", 403);
  const body = await readJson(request);
  if (!isJsonObject(body) || !("startsAt" in body) || !("endsAt" in body)) return jsonError("Indicá las fechas del evento.", 400);
  const parsed = parseEventFields({ startsAt: body.startsAt, endsAt: body.endsAt });
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const dates = { startsAt: parsed.data.startsAt ?? null, endsAt: parsed.data.endsAt ?? null };
  const invalid = eventDateViolation(dates);
  if (invalid) return jsonError(invalid, 400);
  const { id } = await params;
  const { organizationId } = auth.context;
  const initial = await db.budget.findFirst({ where: { id, organizationId }, select: { eventId: true } });
  if (!initial) return jsonError("Presupuesto no encontrado.", 404);
  if (body.originalEventId !== initial.eventId) return jsonError("El evento asociado cambió. Actualizá antes de guardar las fechas.", 409);
  if (!initial.eventId && !dates.startsAt && !dates.endsAt) return jsonError("Completá al menos una fecha para crear el evento.", 400);
  const resolved = !initial.eventId ? await resolveOrganizationPlan(organizationId, auth.context.organization.planId) : null;
  try {
    const event = await db.$transaction(async tx => {
      if (!initial.eventId) {
        const created = await createEventForBudget(tx, { ...auth.context, organization: { ...auth.context.organization, planId: resolved?.id ?? auth.context.organization.planId } }, id, { confirmDraft: false, scheduleDraft: dates });
        return tx.event.findFirstOrThrow({ where: { id: created.event.id, organizationId } });
      }
      const current = await lockEventForEdit(tx, organizationId, initial.eventId, true);
      await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const fresh = await tx.budget.findFirstOrThrow({ where: { id, organizationId } });
      if (fresh.eventId !== current.id) throw new QuoteComparisonError(409, "El evento asociado cambió. Actualizá antes de guardar las fechas.");
      if (["LOST", "CANCELLED"].includes(fresh.status)) throw new QuoteComparisonError(409, "El presupuesto está cerrado.");
      if (["COMPLETED", "CANCELLED"].includes(current.status)) throw new QuoteComparisonError(409, "El evento está cerrado. Editalo desde Eventos.");
      if (body.originalStartsAt !== (current.startsAt?.toISOString() ?? null) || body.originalEndsAt !== (current.endsAt?.toISOString() ?? null)) throw new QuoteComparisonError(409, "Las fechas cambiaron mientras editabas. Cerrá y volvé a abrir el presupuesto.");
      const violation = eventDateViolation({ ...current, ...dates });
      if (violation) throw new QuoteComparisonError(400, violation);
      const updated = await tx.event.update({ where: { id: current.id }, data: dates });
      await guardEventReschedule(tx, organizationId, current, updated);
      return updated;
    });
    const saved = event;
    await recordAudit({ context: auth.context, action: initial.eventId ? "update" : "create", entity: "Event", entityId: event.id, summary: `Guardó las fechas del evento «${event.name}» desde el envío del presupuesto`, detail: { fields: { budgetId: id, startsAt: saved.startsAt?.toISOString() ?? null, endsAt: saved.endsAt?.toISOString() ?? null } } });
    return Response.json({ event: saved });
  } catch (error) {
    if (error instanceof PlanLimitError) return jsonError(error.violation.error, 403, error.violation.code);
    if (error instanceof EventRescheduleError || error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    throw error;
  }
}
