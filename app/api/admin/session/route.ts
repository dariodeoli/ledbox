import { requireAdminContext, setActiveOrganization } from "@/lib/server/tenancy";
import { buildAdminSessionPayload } from "@/lib/server/admin-session";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // La lectura de la sesión funciona incluso con el panel bloqueado: es la que
  // permite dibujar la pantalla de bloqueo (issue #21) tras recargar la página.
  const result = await requireAdminContext(undefined, { allowLocked: true });
  if (!result.ok) return result.response;
  return Response.json(await buildAdminSessionPayload(result.context));
}

export async function PATCH(request: Request) {
  const result = await requireAdminContext();
  if (!result.ok) return result.response;
  const body = await readJson(request) as Record<string, unknown>;
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  if (!organizationId) return jsonError("organizationId is required.", 400);
  const organization = await setActiveOrganization(result.context, organizationId);
  if (!organization) return jsonError("You do not have access to that organization.", 403);
  return Response.json({
    organization,
    user: { ...result.context.user, role: organization.role },
  });
}
