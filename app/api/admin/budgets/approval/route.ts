import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const select = {
  id: true,
  status: true,
  publicToken: true,
  publicTokenCreatedAt: true,
  approvedAt: true,
  approvedByName: true,
  approvalMethod: true,
  approvalNote: true,
  revisionRequestedAt: true,
  revisionNote: true,
} as const;

const MAX_NOTE = 1000;

/**
 * `POST /api/admin/budgets/approval` (issue #12): aprobación manual o pedido de
 * cambios del equipo (OWNER/ADMIN/FINANCE) sobre un presupuesto de la empresa
 * activa. La aprobación manual queda con actor y fecha y no pisa una ya
 * registrada (ni digital ni manual).
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
    select: { id: true, status: true, approvedAt: true },
  });
  if (!budget) return jsonError("Budget not found.", 404);

  if (decision === "approve") {
    // Idempotente: si ya hay una aprobación registrada, se devuelve tal cual.
    await db.budget.updateMany({
      where: { id: budget.id, approvedAt: null },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByName: user.name,
        approvalMethod: "manual",
        approvalNote: note || null,
      },
    });
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
  }

  const updated = await db.budget.findUnique({ where: { id: budget.id }, select });
  return Response.json({ budget: updated });
}
