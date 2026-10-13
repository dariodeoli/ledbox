import { holdQuoteRequestStock } from "@/lib/server/catalog-convert";
import { recordAudit } from "@/lib/server/audit";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/quote-requests/[id]/hold`: retiene el stock de un pedido ya
 * convertido (por la vigencia de retención de la empresa). Exige `events.write`;
 * todo o nada, y 409 si algún artículo no alcanza.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const result = await holdQuoteRequestStock(auth.context, id);
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "EventInventory",
    entityId: result.eventId,
    summary: `Retuvo el stock del pedido por ${result.hours} h (${result.held} artículos)`,
    detail: { fields: { quoteRequestId: id, eventId: result.eventId } },
  });
  return Response.json(result);
}
