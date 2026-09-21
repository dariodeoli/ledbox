import { listAdminOrganizations, requireAdminContext, setActiveOrganization } from "@/lib/server/tenancy";
import { loadOrganizationLogos, logoVersions } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireAdminContext();
  if (!result.ok) return result.response;
  const { user, organization, role, demo } = result.context;
  const [organizations, avatar, logos] = await Promise.all([
    listAdminOrganizations(user.id),
    db.adminUserAvatar.findUnique({ where: { userId: user.id }, select: { updatedAt: true } }),
    loadOrganizationLogos(organization.id),
  ]);
  return Response.json({
    // El avatar (issue #22) viaja con la fecha de subida: el chip arma la URL con
    // esa versión y refresca la foto cuando el usuario la cambia.
    user: { ...user, avatarUpdatedAt: avatar?.updatedAt.toISOString() ?? null },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role,
      // Logos de la empresa por tema: el shell elige la variante según el tema.
      logos: logoVersions(logos),
    },
    organizations,
    // La sesión demo se marca para que el shell muestre el aviso de solo lectura.
    demo,
  });
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
