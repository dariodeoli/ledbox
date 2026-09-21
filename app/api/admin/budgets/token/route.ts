import { generatePublicToken } from "@/lib/server/budget-portal";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
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
  const action = body.action === "generate" ? "generate" : body.action === "revoke" ? "revoke" : "";
  if (!budgetId || !action) return jsonError("budgetId and action are required.", 400);

  const budget = await db.budget.findFirst({ where: { id: budgetId, organizationId }, select: { id: true } });
  if (!budget) return jsonError("Budget not found.", 404);

  const updated = await db.budget.update({
    where: { id: budget.id },
    data:
      action === "generate"
        ? { publicToken: generatePublicToken(), publicTokenCreatedAt: new Date() }
        : { publicToken: null, publicTokenCreatedAt: null },
    select,
  });

  return Response.json({ budget: updated });
}
