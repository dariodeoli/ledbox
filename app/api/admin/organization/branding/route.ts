import { recordAudit, auditChanges } from "@/lib/server/audit";
import { loadOrganizationLogos, logoVersions } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { FIELD_MESSAGES, normalizePersonName, personNameValid } from "@/lib/field-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marca de la empresa activa (issue #22): `GET` devuelve el nombre, el
 * identificador (que no se edita) y qué logos están subidos; `PATCH` edita el
 * **nombre**, el que se ve en el chip del panel y en las hojas imprimibles.
 *
 * Solo OWNER/ADMIN (capacidad `org.manage`) y la organización demo queda en solo
 * lectura. Los logos viven en `/branding/logos/[variant]` porque son binarios.
 */

export async function GET() {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;

  const [organization, logos] = await Promise.all([
    db.organization.findUnique({
      where: { id: auth.context.organizationId },
      select: { id: true, name: true, slug: true },
    }),
    loadOrganizationLogos(auth.context.organizationId),
  ]);
  if (!organization) return jsonError("No encontramos la empresa activa.", 404);
  return Response.json({ organization, logos: logoVersions(logos) });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const name = normalizePersonName(typeof body.name === "string" ? body.name : "");
  if (!personNameValid(name)) return jsonError(FIELD_MESSAGES.name, 400);

  const before = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!before) return jsonError("No encontramos la empresa activa.", 404);

  const changes = auditChanges({ name: before.name }, { name }, ["name"]);
  if (changes) {
    await db.organization.update({ where: { id: organizationId }, data: { name } });
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: `Cambió el nombre de la empresa a «${name}»`,
      detail: { changes },
    });
  }
  return Response.json({
    organization: { id: before.id, name, slug: before.slug },
    unchanged: !changes,
  });
}
