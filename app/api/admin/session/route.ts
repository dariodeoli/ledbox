import { listAdminOrganizations, requireAdminContext, setActiveOrganization } from "@/lib/server/tenancy";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireAdminContext();
  if (!result.ok) return result.response;
  const { user, organization, role, demo } = result.context;
  const organizations = await listAdminOrganizations(user.id);
  return Response.json({
    user,
    organization: { id: organization.id, name: organization.name, slug: organization.slug, role },
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
