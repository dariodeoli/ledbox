import { auditChanges, recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext, setDefaultOrganization } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Empresa predeterminada del usuario (Mi perfil): la que se abre al iniciar sesión. `PATCH { organizationId }`
 * (o `null` para volver a «la primera»). Solo vale una empresa donde el usuario tiene membresía activa, que esté
 * activa y no sea la demo: una empresa ajena responde 403. Cambiar de empresa en el panel NO toca este valor.
 */
export async function PATCH(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const actor = auth.context.user;

  const body = (await readJson(request)) as Record<string, unknown>;
  const raw = body.organizationId;
  if (raw !== null && (typeof raw !== "string" || !raw.trim())) return jsonError("Elegí una empresa válida.", 400);
  const organizationId = raw === null ? null : (raw as string).trim();

  const before = await db.adminUser.findUnique({ where: { id: actor.id }, select: { defaultOrganizationId: true } });
  if (!(await setDefaultOrganization(actor.id, organizationId))) {
    return jsonError("No tenés acceso a esa empresa.", 403);
  }
  const changes = auditChanges(
    { defaultOrganizationId: before?.defaultOrganizationId ?? null },
    { defaultOrganizationId: organizationId },
    ["defaultOrganizationId"],
  );
  if (changes) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "AdminUser",
      entityId: actor.id,
      summary: organizationId ? "Eligió su empresa predeterminada" : "Quitó su empresa predeterminada",
      detail: { changes },
    });
  }
  return Response.json({ defaultOrganizationId: organizationId });
}
