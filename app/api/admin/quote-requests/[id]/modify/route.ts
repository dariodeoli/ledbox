import { jsonError, readJson } from "@/lib/server/http";
import { modifyQuoteRequest, parseModifyInput } from "@/lib/server/quote-request-response";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/quote-requests/[id]/modify`: la empresa ajusta el pedido antes de aceptarlo
 * (cantidades, quitar una línea, «ya no lo tengo disponible» o sustituir por otro producto) y le
 * envía la propuesta al cliente, que la aprueba desde su seguimiento. Verifica el stock real del
 * período: lo que no alcanza responde 409 con los faltantes. Exige `clients.write`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = parseModifyInput(await readJson(request).catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const result = await modifyQuoteRequest(auth.context, id, parsed, { id: auth.context.user.id, name: auth.context.user.name, email: auth.context.user.email });
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ quoteRequest: { id, status: result.status, total: result.total }, changes: result.changes, mail: result.mail });
}
