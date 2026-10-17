import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError } from "@/lib/server/http";
import { generatePublicToken } from "@/lib/server/budget-portal";
import { quotePortalAvailable } from "@/lib/quote-sharing";
import { QuoteComparisonError } from "@/lib/server/quote-comparison";
import { recordAudit } from "@/lib/server/audit";
import { live } from "@/lib/server/trash-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const groups = await db.quoteComparison.findMany({
    where: { organizationId: auth.context.organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, title: true, publicToken: true, expiresAt: true, revokedAt: true, selectedBudgetId: true, budgets: { where: live, select: { id: true, title: true, comparisonLabel: true } } },
  });
  return Response.json({ groups });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const alternatives: Array<{ budgetId: string; label: string }> = Array.isArray(body?.alternatives) ? body.alternatives : [];
  const expiresAt = new Date(typeof body?.expiresAt === "string" ? body.expiresAt : "");
  if (!title || title.length > 120 || !Number.isFinite(+expiresAt) || expiresAt <= new Date() || +expiresAt > Date.now() + 90 * 86400000 ||
      alternatives.length < 2 || alternatives.length > 5 || alternatives.some((a) => !a || typeof a.budgetId !== "string" || typeof a.label !== "string" || !a.label.trim() || a.label.trim().length > 80) ||
      new Set(alternatives.map((a) => a.budgetId)).size !== alternatives.length ||
      new Set(alternatives.map((a) => a.label.trim().toLowerCase())).size !== alternatives.length) return jsonError("Elegí de 2 a 5 presupuestos, nombres distintos y un vencimiento válido (hasta 90 días).", 400);
  const { organizationId } = auth.context;
  try {
    const group = await db.$transaction(async (tx) => {
      // Lock in stable order, including against concurrent standalone approval.
      for (const id of alternatives.map((a) => a.budgetId).sort()) await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${id} FOR UPDATE`;
      const quotes = await tx.budget.findMany({ where: { id: { in: alternatives.map((a) => a.budgetId) }, organizationId }, include: { signatureRequests: { where: { status: { in: ["SIGNED", "VALIDATED"] } }, select: { id: true } } } });
      if (quotes.length !== alternatives.length || new Set(quotes.map((q) => q.clientId)).size !== 1 || quotes.some((q) => q.comparisonId || q.approvedAt || q.status === "APPROVED" || !quotePortalAvailable(q) || q.signatureRequests.length)) throw new QuoteComparisonError(409, "Los presupuestos deben ser de la misma empresa y cliente, vigentes, sin aprobación ni otra comparación.");
      const created = await tx.quoteComparison.create({ data: { id: randomUUID(), organizationId, clientId: quotes[0].clientId, title, expiresAt, publicToken: generatePublicToken() } });
      for (const alternative of alternatives) await tx.budget.update({ where: { id: alternative.budgetId }, data: { comparisonId: created.id, comparisonLabel: alternative.label.trim() } });
      return created;
    });
    await recordAudit({ context: auth.context, action: "create", entity: "Budget", entityId: alternatives[0].budgetId, summary: "Creó una comparación opcional de presupuestos", detail: { fields: { comparisonId: group.id } } });
    return Response.json({ group: { id: group.id, publicToken: group.publicToken } }, { status: 201 });
  } catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    throw error;
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== "string" || !["revoke", "renew"].includes(body?.action)) return jsonError("La acción no es válida.", 400);
  const group = await db.quoteComparison.findFirst({ where: { id: body.id, organizationId: auth.context.organizationId }, select: { id: true, budgets: { where: live, select: { id: true }, take: 1 } } });
  if (!group) return jsonError("Comparación no encontrada.", 404);
  await db.quoteComparison.update({ where: { id: group.id }, data: body.action === "renew" ? { revokedAt: null, publicToken: generatePublicToken(), expiresAt: new Date(Date.now() + 7 * 86400000) } : { revokedAt: new Date() } });
  await recordAudit({ context: auth.context, action: "update", entity: "Budget", entityId: group.budgets[0]?.id ?? group.id, summary: body.action === "renew" ? "Renovó el enlace de comparación" : "Revocó el enlace de comparación", detail: { fields: { comparisonId: group.id } } });
  return Response.json({ ok: true });
}
