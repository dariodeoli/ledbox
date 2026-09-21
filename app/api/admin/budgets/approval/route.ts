import { db } from "@/lib/server/db";
import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { reserveBudgetInventory, type BudgetReservation } from "@/lib/server/inventory-availability";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const select = {
  id: true,
  title: true,
  status: true,
  publicToken: true,
  publicTokenCreatedAt: true,
  approvedAt: true,
  approvedByName: true,
  approvalMethod: true,
  approvalNote: true,
  revisionRequestedAt: true,
  revisionNote: true,
  client: { select: { name: true, company: true } },
} as const;

const MAX_NOTE = 1000;

/**
 * `POST /api/admin/budgets/approval` (issue #12): aprobación manual o pedido de
 * cambios del equipo (OWNER/ADMIN/FINANCE) sobre un presupuesto de la empresa
 * activa. La aprobación manual queda con actor y fecha y no pisa una ya
 * registrada (ni digital ni manual).
 *
 * Al aprobar se reserva el stock de los ítems vinculados al inventario con el
 * rango del evento (issue #18). Un conflicto de disponibilidad no bloquea la
 * aprobación: queda auditado y la respuesta trae `reservations` para que el
 * panel muestre qué se reservó y qué quedó pendiente.
 *
 * Al aprobar también se generan los pagos esperados del plan (issue #28):
 * anticipo, cuotas y saldo quedan como `ExpectedPayment` en `AWAITING` para que
 * Finanzas los vea y confirme cuando el cliente transfiera. La sincronización es
 * idempotente.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const decision = body.decision === "approve" ? "approve" : body.decision === "request_revision" ? "request_revision" : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!budgetId || !decision) return jsonError("budgetId and decision are required.", 400);
  if (note.length > MAX_NOTE) return jsonError(`La nota no puede superar los ${MAX_NOTE} caracteres.`, 400);
  if (decision === "request_revision" && !note) return jsonError("Indicá qué cambios se piden.", 400);

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { id: true, title: true, status: true, approvedAt: true, client: { select: { name: true, company: true } } },
  });
  if (!budget) return jsonError("Budget not found.", 404);
  const clientLabel = budget.client.company?.trim() || budget.client.name;
  let reservations: BudgetReservation | null = null;

  if (decision === "approve") {
    // Idempotente: si ya hay una aprobación registrada, se devuelve tal cual.
    const applied = await db.budget.updateMany({
      where: { id: budget.id, approvedAt: null },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByName: user.name,
        approvalMethod: "manual",
        approvalNote: note || null,
      },
    });
    if (applied.count > 0) {
      await recordAudit({
        context: auth.context,
        action: "status",
        entity: "Budget",
        entityId: budget.id,
        summary: `Aprobó manualmente el presupuesto «${budget.title}» del cliente «${clientLabel}»`,
        detail: { changes: { status: { from: budget.status, to: "APPROVED" }, approvalMethod: { from: null, to: "manual" } } },
      });
      reservations = await reserveBudgetInventory({ organizationId, budgetId: budget.id, context: auth.context });
      // Pagos esperados del plan (issue #28): idempotente y sin tocar lo confirmado.
      await syncBudgetExpectedPayments({
        organizationId,
        budgetId: budget.id,
        actor: auth.context,
        reason: "aprobación manual",
      });
    }
  } else {
    if (budget.approvedAt) return jsonError("El presupuesto ya está aprobado.", 409);
    await db.budget.update({
      where: { id: budget.id },
      data: {
        status: budget.status === "APPROVED" ? budget.status : "NEGOTIATING",
        revisionRequestedAt: new Date(),
        revisionNote: note,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Budget",
      entityId: budget.id,
      summary: `Pidió cambios en el presupuesto «${budget.title}» del cliente «${clientLabel}»`,
      detail: { fields: { revisionNote: note } },
    });
  }

  const updated = await db.budget.findUnique({ where: { id: budget.id }, select });
  return Response.json({ budget: updated, reservations });
}
