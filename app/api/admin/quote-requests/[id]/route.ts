import { QUOTE_REQUEST_STATUSES, isQuoteRequestStatus } from "@/lib/catalog-public";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PATCH /api/admin/quote-requests/[id]`: estado manual del pedido (en revisión,
 * cotizado, declinado, vencido o nuevo). «Convertido» solo lo pone la conversión
 * en presupuesto y un pedido convertido no se mueve. Exige `clients.write`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const status = typeof body?.status === "string" ? body.status.toUpperCase() : "";
  if (!isQuoteRequestStatus(status) || status === "CONVERTED") {
    return jsonError(`Estado inválido. Opciones: ${QUOTE_REQUEST_STATUSES.filter((value) => value !== "CONVERTED").join(", ")}.`, 400);
  }
  const quote = await db.quoteRequest.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { id: true, status: true, leadId: true } });
  if (!quote) return jsonError("El pedido no existe en esta empresa.", 404);
  if (quote.status === "CONVERTED") return jsonError("El pedido ya se convirtió en presupuesto: su estado no se cambia.", 409);
  if (quote.status !== status) {
    await db.quoteRequest.update({ where: { id: quote.id }, data: { status } });
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Lead",
      entityId: quote.leadId ?? quote.id,
      summary: "Cambió el estado de un pedido del catálogo",
      detail: { changes: { quoteRequestStatus: { from: quote.status, to: status } } },
    });
  }
  return Response.json({ quoteRequest: { id: quote.id, status } });
}
