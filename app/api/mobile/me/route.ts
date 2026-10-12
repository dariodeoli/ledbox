import { listAdminOrganizations } from "@/lib/server/tenancy";
import { ROLE_CAPABILITIES } from "@/lib/server/permissions";
import { mobileSession } from "@/lib/server/mobile/session";
import { mobileJSON } from "@/lib/server/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await mobileSession(request);
  if (!auth) return mobileJSON({ error: "Unauthorized", code: "unauthorized" }, 401);
  if (auth.session.lockedAt) return mobileJSON({ error: "Sesión bloqueada.", code: "session_locked" }, 423);
  const organizations = (await listAdminOrganizations(auth.user.id)).map(({ id, name, slug, role }) => ({ id, name, slug, role }));
  const active = organizations.find(org => org.id === auth.session.activeOrganizationId) ?? null;
  return mobileJSON({ version: 1, user: { id: auth.user.id, name: auth.user.name, email: auth.user.email }, organizations, activeOrganization: active,
    capabilities: active ? ROLE_CAPABILITIES[active.role] : [], session: { expiresAt: auth.session.expiresAt.toISOString() } });
}
