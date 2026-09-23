import type { AdminRole } from "@prisma/client";
import { adminRoleLabel } from "@/lib/admin-format";
import { API_TOKEN_ROLES, createApiToken, listApiTokens } from "@/lib/server/api-tokens";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API keys de servicio de la empresa activa (issue #69).
 *
 * - `GET`: lista las claves (prefijo, rol, último uso y estado; nunca el token).
 * - `POST`: crea una clave y devuelve el **token plano una sola vez**.
 *
 * Solo OWNER: la capacidad `api-keys.manage` no la tiene ningún otro rol. Las
 * claves nunca pueden ser OWNER ni administrar claves.
 */

const MAX_NAME = 60;

export async function GET() {
  const auth = await requireAdminContext("api-keys.manage");
  if (!auth.ok) return auth.response;
  const tokens = await listApiTokens(auth.context.organizationId);
  return Response.json({ tokens });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("api-keys.manage");
  if (!auth.ok) return auth.response;

  const body = (await readJson(request)) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Poné un nombre para la clave (por ejemplo «Automatización ventas»).", 400);
  if (name.length > MAX_NAME) return jsonError(`El nombre no puede superar los ${MAX_NAME} caracteres.`, 400);

  const requested = typeof body.role === "string" ? body.role.trim().toUpperCase() : "";
  if (!API_TOKEN_ROLES.includes(requested as AdminRole)) {
    return jsonError("El rol de la clave no es válido (ADMIN, FINANCE u OPERATIONS).", 400);
  }
  const role = requested as AdminRole;

  const { token, record } = await createApiToken(auth.context, { name, role });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "ApiToken",
    entityId: record.id,
    summary: `Creó la API key «${record.name}» con rol ${adminRoleLabel(record.role)}`,
    detail: { fields: auditPick(record, ["name", "role", "prefix"]) },
  });
  return Response.json({ token, apiToken: record }, { status: 201 });
}
