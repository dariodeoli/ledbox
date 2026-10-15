import { approveAccessRequest, rejectAccessRequest } from "@/lib/server/catalog-access-requests";
import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/catalog-access-requests/[id]` con `{ action: "approve" | "reject", reason? }`.
 *
 * - `approve`: resuelve o crea el cliente, genera su link (`CatalogAccessToken`) y se lo manda
 *   por correo. El link viaja una sola vez en esta respuesta (por si el correo no sale).
 * - `reject`: cierra la solicitud, con un motivo opcional para el equipo.
 *
 * Exige `clients.write` y se acota a la empresa activa: una solicitud de otra empresa responde 404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown> | null;
  const action = body?.action;

  if (action === "approve") {
    const result = await approveAccessRequest(auth.context, id, { id: auth.context.user.id, name: auth.context.user.name, email: auth.context.user.email });
    if (!result.ok) return jsonError(result.error, result.status);
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Organization",
      entityId: auth.context.organizationId,
      summary: "Aprobó una solicitud de acceso al catálogo",
      detail: { fields: { requestId: id, clientId: result.client.id, clientCreated: result.clientCreated, mail: result.mail.status } },
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  if (action === "reject") {
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    const result = await rejectAccessRequest(auth.context, id, reason || null);
    if (!result.ok) return jsonError(result.error, result.status);
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Organization",
      entityId: auth.context.organizationId,
      summary: "Rechazó una solicitud de acceso al catálogo",
      detail: { fields: { requestId: id, reason: reason || null } },
    });
    return Response.json({ ok: true });
  }
  return jsonError("La acción tiene que ser «approve» o «reject».", 400);
}
