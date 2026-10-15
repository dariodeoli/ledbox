import { jsonError, readJson } from "@/lib/server/http";
import {
  RentalSettlementError,
  addRentalCharge,
  decideRentalCharge,
  getSettlementView,
  proposeCancellationRetention,
  settleBudgetRental,
  type ChargeAction,
} from "@/lib/server/rental-settlement";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liquidación de la devolución de un alquiler (docs/ALQUILERES-OPERACION.md P1-4).
 *
 * - `GET ?budgetId=`: cargos, cargos de la lista de la empresa que se ofrecen según lo devuelto, estado
 *   de la garantía y vista previa de la liquidación. Tiene plata: OPERATIONS responde 403.
 * - `POST { budgetId, action }`: `charge` (apply, waive con motivo, reopen, update), `add-charge` y
 *   `settle`. Todo exige `budgets.write` (OWNER, ADMIN y FINANCE): OPERATIONS propone al devolver
 *   pero no aplica, condona ni liquida. Un presupuesto de otra empresa responde 404.
 */
function handle(error: unknown): Response {
  if (error instanceof RentalSettlementError) return jsonError(error.message, error.status);
  console.error("[rental-settlement]", error);
  throw error;
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  if (auth.context.role === "OPERATIONS") return jsonError("Forbidden", 403);
  const params = new URL(request.url).searchParams;
  const budgetId = params.get("budgetId") ?? "";
  if (!budgetId) return jsonError("Falta el presupuesto.", 400);
  try {
    const view = await getSettlementView(auth.context.organizationId, budgetId);
    const cancellation = params.get("cancellation") === "1" ? await proposeCancellationRetention(auth.context.organizationId, budgetId) : undefined;
    return Response.json({ settlement: view, ...(cancellation ? { cancellation } : {}) });
  } catch (error) {
    return handle(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const budgetId = typeof body?.budgetId === "string" ? body.budgetId : "";
  if (!body || !budgetId) return jsonError("Falta el presupuesto.", 400);
  try {
    if (body.action === "settle") {
      const accountId = typeof body.accountId === "string" && body.accountId ? body.accountId : null;
      const result = await settleBudgetRental(auth.context, budgetId, { accountId });
      return Response.json({ result, settlement: await getSettlementView(auth.context.organizationId, budgetId) });
    }
    if (body.action === "add-charge") {
      const charge = await addRentalCharge(auth.context, budgetId, {
        typeId: typeof body.typeId === "string" ? body.typeId : null,
        label: typeof body.label === "string" ? body.label : undefined,
        kind: body.kind === "CLEANING" || body.kind === "STAIN" || body.kind === "OTHER" ? body.kind : undefined,
        quantity: typeof body.quantity === "number" ? body.quantity : undefined,
        unitAmount: typeof body.unitAmount === "number" ? body.unitAmount : undefined,
      });
      return Response.json({ charge, settlement: await getSettlementView(auth.context.organizationId, budgetId) });
    }
    if (body.action === "charge") {
      const chargeId = typeof body.chargeId === "string" ? body.chargeId : "";
      if (!chargeId) return jsonError("Falta el cargo.", 400);
      let input: ChargeAction;
      if (body.decision === "apply" || body.decision === "reopen") input = { action: body.decision };
      else if (body.decision === "waive") input = { action: "waive", reason: typeof body.reason === "string" ? body.reason : "" };
      else if (body.decision === "update") {
        input = {
          action: "update",
          quantity: typeof body.quantity === "number" ? body.quantity : undefined,
          unitAmount: typeof body.unitAmount === "number" ? body.unitAmount : undefined,
          label: typeof body.label === "string" ? body.label : undefined,
          note: typeof body.note === "string" || body.note === null ? (body.note as string | null) : undefined,
        };
      } else return jsonError("La decisión sobre el cargo no es válida.", 400);
      const charge = await decideRentalCharge(auth.context, budgetId, chargeId, input);
      return Response.json({ charge, settlement: await getSettlementView(auth.context.organizationId, budgetId) });
    }
    return jsonError("La acción no es válida.", 400);
  } catch (error) {
    return handle(error);
  }
}
