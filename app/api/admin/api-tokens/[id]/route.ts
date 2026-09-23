import { adminRoleLabel } from "@/lib/admin-format";
import { revokeApiToken } from "@/lib/server/api-tokens";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PATCH /api/admin/api-tokens/[id]` (issue #69): revoca una clave de la empresa
 * activa. Es inmediato —la próxima resolución del token ya no lo acepta— e
 * idempotente; queda auditado con el actor que lo pidió. Solo OWNER.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("api-keys.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.action !== "revoke") return jsonError("Acción inválida: usá revoke.", 400);

  const revoked = await revokeApiToken(organizationId, id);
  if (!revoked) return jsonError("No encontramos esa clave.", 404);

  await recordAudit({
    context: auth.context,
    action: "delete",
    entity: "ApiToken",
    entityId: revoked.id,
    summary: `Revocó la API key «${revoked.name}» (${adminRoleLabel(revoked.role)})`,
    detail: { before: auditPick(revoked, ["name", "role", "prefix", "createdByName"]) },
  });
  return Response.json({ apiToken: revoked });
}
