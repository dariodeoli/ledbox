import { jsonError, readJson } from "@/lib/server/http";
import { rejectQuoteRequest } from "@/lib/server/quote-request-response";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/quote-requests/[id]/reject` con `{ reason }`: rechaza el pedido con un motivo
 * que el cliente ve en su seguimiento y por correo. Exige `clients.write` y acota a la empresa
 * activa (un id ajeno responde 404). Un pedido ya convertido o cerrado responde 409.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown> | null;
  const result = await rejectQuoteRequest(auth.context, id, body?.reason, { id: auth.context.user.id, name: auth.context.user.name, email: auth.context.user.email });
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ quoteRequest: { id, status: "DECLINED" }, mail: result.mail });
}
