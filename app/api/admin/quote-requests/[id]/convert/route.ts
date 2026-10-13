import { convertQuoteRequest, holdQuoteRequestStock } from "@/lib/server/catalog-convert";
import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { roleCan } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/quote-requests/[id]/convert`: convierte un pedido del
 * catálogo en presupuesto (borrador). Exige `budgets.write` (VIEWER no muta) y
 * acota a la empresa activa: un id de otra empresa responde 404. Convertir dos
 * veces responde 409. Con `{ hold: true }` además retiene el stock (exige
 * `events.write`); si la retención no alcanza, el presupuesto igual queda creado
 * y la respuesta lo dice en `hold`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown> | null;
  const wantsHold = body?.hold === true;
  if (wantsHold && !roleCan(auth.context.user.role, "events.write")) {
    return jsonError("Tu rol no puede retener stock: pedile a Operaciones o a un administrador.", 403);
  }

  const result = await convertQuoteRequest(auth.context, id);
  if (!result.ok) return jsonError(result.error, result.status);

  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Budget",
    entityId: result.budget.id,
    summary: `Convirtió un pedido del catálogo en el presupuesto «${result.budget.title}»`,
    detail: { fields: { quoteRequestId: id, total: result.budget.total, depositPercent: result.deposit.percent, depositAmount: result.deposit.amount, leadId: result.leadId } },
  });
  if (result.clientCreated) {
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Client",
      entityId: result.client.id,
      summary: `Creó el cliente «${result.client.name}» al convertir un pedido del catálogo`,
      detail: { fields: { name: result.client.name, company: result.client.company, fromLeadId: result.leadId } },
    });
  }

  let hold: Awaited<ReturnType<typeof holdQuoteRequestStock>> | null = null;
  if (wantsHold) {
    hold = await holdQuoteRequestStock(auth.context, id);
    if (hold.ok) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "EventInventory",
        entityId: hold.eventId,
        summary: `Retuvo el stock del pedido por ${hold.hours} h (${hold.held} artículos)`,
        detail: { fields: { quoteRequestId: id, budgetId: result.budget.id, eventId: hold.eventId } },
      });
    }
  }
  return Response.json({ ...result, hold }, { status: 201 });
}
