import { applyManualBudgetDecision } from "@/lib/server/budget-approval";
import { readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aprobación/revisión manual: la misma implementación que usa el tablero. */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  return applyManualBudgetDecision(auth.context, await readJson(request) as Record<string, unknown>);
}
