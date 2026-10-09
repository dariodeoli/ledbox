import { generatePublicToken } from "@/lib/server/budget-portal";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
import { clientDisplayName } from "@/lib/client-identity";
export const dynamic = "force-dynamic";

const select = { id: true, publicToken: true, publicTokenCreatedAt: true } as const;

/**
 * `POST /api/admin/budgets/token` (issue #12): gestiona el link público de un
 * presupuesto de la empresa activa. `generate` crea un código nuevo (si ya
 * había uno, lo reemplaza: el link viejo deja de existir) y `revoke` lo anula
 * sin tocar la aprobación ya registrada.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const action = body.action === "generate" ? "generate" : body.action === "revoke" ? "revoke" : body.action === "ensure" ? "ensure" : "";
  if (!budgetId || !action) return jsonError("Falta el presupuesto o la acción.", 400);

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { publicToken: true, publicTokenCreatedAt: true, id: true, title: true, client: { select: { name: true, company: true, tradeName: true, legalName: true } } },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);
  const clientLabel = clientDisplayName(budget.client);

  if (action === "ensure") {
    if (!budget.publicToken) {
      const created = await db.budget.updateMany({ where: { id: budget.id, organizationId, publicToken: null }, data: { publicToken: generatePublicToken(), publicTokenCreatedAt: new Date() } });
      if (created.count) await recordAudit({ context: auth.context, action: "update", entity: "Budget", entityId: budget.id, summary: "Generó un enlace del cliente sin envío externo" });
    }
    const current = await db.budget.findFirst({ where: { id: budget.id, organizationId }, select });
    return Response.json({ budget: current });
  }

  const updated = await db.budget.update({
    where: { id: budget.id },
    data:
      action === "generate"
        ? { publicToken: generatePublicToken(), publicTokenCreatedAt: new Date() }
        : { publicToken: null, publicTokenCreatedAt: null },
    select,
  });

  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Budget",
    entityId: budget.id,
    summary:
      action === "generate"
        ? `Generó el link público del presupuesto «${budget.title}» del cliente «${clientLabel}»`
        : `Revocó el link público del presupuesto «${budget.title}» del cliente «${clientLabel}»`,
  });

  return Response.json({ budget: updated });
}
