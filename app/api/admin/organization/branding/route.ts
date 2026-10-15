import { Prisma } from "@prisma/client";
import { recordAudit, auditChanges } from "@/lib/server/audit";
import { loadOrganizationLogos, logoVersions } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { FIELD_MESSAGES, normalizePersonName, personNameValid } from "@/lib/field-rules";
import { orgSlugError } from "@/lib/platform/alta-empresa";
import { claimOrganizationSlug, loadOrganizationSlugAliases, lockOrganizationSlugNamespace, OrganizationSlugTaken } from "@/lib/server/organization-slugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nombre e identificador de la empresa de sesión; los anteriores siguen siendo alias propios. */
export async function GET() {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const [organization, logos, aliases] = await Promise.all([
    db.organization.findUnique({ where: { id: auth.context.organizationId }, select: { id: true, name: true, slug: true, isDemo: true } }),
    loadOrganizationLogos(auth.context.organizationId),
    loadOrganizationSlugAliases(auth.context.organizationId),
  ]);
  if (!organization) return jsonError("No encontramos la empresa activa.", 404);
  return Response.json({ organization: { id: organization.id, name: organization.name, slug: organization.slug, slugEditable: !organization.isDemo && organization.slug !== "demo", slugAliases: aliases.map(row => row.slug) }, logos: logoVersions(logos) });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("org.manage", { sandbox: "deny" });
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("El formulario debe ser un objeto JSON.", 400);
  if (!("name" in body) && !("slug" in body)) return jsonError("Indicá el nombre o identificador a cambiar.", 400);
  if ("name" in body && (typeof body.name !== "string" || !personNameValid(normalizePersonName(body.name)))) return jsonError(FIELD_MESSAGES.name, 400);
  if ("slug" in body && typeof body.slug !== "string") return jsonError("El identificador debe ser texto.", 400);
  try {
    const result = await db.$transaction(async (tx) => {
      await lockOrganizationSlugNamespace(tx);
      const rows = await tx.$queryRaw<Array<{ id: string; name: string; slug: string; isDemo: boolean }>>(Prisma.sql`
        SELECT "id", "name", "slug", "isDemo" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`);
      const before = rows[0];
      if (!before) return { kind: "error", error: "No encontramos la empresa activa.", status: 404 } as const;
      if (before.isDemo || before.slug === "demo") return { kind: "error", error: "En la demo no se cambia la identidad de la empresa.", status: 403 } as const;
      const name = "name" in body ? normalizePersonName(body.name as string) : before.name;
      // El nombre puede editarse sin validar/reemplazar identificadores históricos.
      const slug = "slug" in body ? body.slug === before.slug ? before.slug : (body.slug as string).trim() : before.slug;
      if (slug !== before.slug) {
        if (typeof body.expectedSlug !== "string" || body.expectedSlug !== before.slug) return { kind: "error", error: "El identificador cambió. Actualizá la empresa y volvé a intentar.", status: 409 } as const;
        const error = orgSlugError(slug);
        if (error) return { kind: "error", error, status: 400 } as const;
        await claimOrganizationSlug(tx, before.slug, organizationId);
        await claimOrganizationSlug(tx, slug, organizationId);
      }
      const changes = auditChanges({ name: before.name, slug: before.slug }, { name, slug }, ["name", "slug"]);
      if (changes) await tx.organization.update({ where: { id: organizationId }, data: { name, slug } });
      return { kind: "ok", organization: { id: before.id, name, slug }, changes } as const;
    });
    if (result.kind === "error") return jsonError(result.error, result.status);
    if (result.changes) await recordAudit({ context: auth.context, action: "update", entity: "Organization", entityId: organizationId,
      summary: `Actualizó la identidad de la empresa «${result.organization.name}»`, detail: { changes: result.changes } });
    const aliases = await loadOrganizationSlugAliases(organizationId);
    return Response.json({ organization: { ...result.organization, slugEditable: true, slugAliases: aliases.map(row => row.slug) }, unchanged: !result.changes });
  } catch (error) {
    if (error instanceof OrganizationSlugTaken || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) return jsonError("Ese identificador ya pertenece a otra empresa o a su historial.", 409);
    throw error;
  }
}
