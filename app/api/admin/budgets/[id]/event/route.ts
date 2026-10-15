import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { roleCan } from "@/lib/server/permissions";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { QuoteComparisonError } from "@/lib/server/quote-comparison";
import { guardEventNameChange } from "@/lib/server/event-name";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  if (!roleCan(auth.context.role, "events.write")) return jsonError("No tenés permiso para editar eventos.", 403);
  const body = await readJson(request) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 160) return jsonError("El nombre del evento debe tener entre 1 y 160 caracteres.", 400);
  const { id } = await params;
  try {
    const event = await db.$transaction(async (tx) => {
      const budget = await tx.budget.findFirst({ where: { id, organizationId: auth.context.organizationId } });
      if (!budget) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
      if (!budget.eventId) throw new QuoteComparisonError(400, "El presupuesto no tiene evento.");
      const current = await guardEventNameChange(tx, auth.context.organizationId, budget.eventId, name, body.originalName);
      const fresh = await tx.budget.findFirstOrThrow({ where: { id, organizationId: auth.context.organizationId } });
      if (fresh.eventId !== current.id) throw new QuoteComparisonError(409, "El evento asociado cambió. Actualizá antes de renombrarlo.");
      if (["LOST", "CANCELLED"].includes(fresh.status)) throw new QuoteComparisonError(409, "El presupuesto está cerrado.");
      return tx.event.update({ where: { id: current.id }, data: { name } });
    });
    await recordAudit({ context: auth.context, action: "update", entity: "Event", entityId: event.id, summary: `Renombró el evento compartido a «${name}» desde Presupuestos`, detail: { changes: { name: { from: body.originalName, to: name } } } });
    return Response.json({ event });
  } catch (error) { if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status); throw error; }
}
