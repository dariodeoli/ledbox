import { db } from "@/lib/server/db";
import { mobileSession } from "@/lib/server/mobile/session";
import { mobileOrganizationSchema } from "@/lib/server/mobile/contracts";
import { mobileInput, mobileJSON } from "@/lib/server/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const auth = await mobileSession(request);
  if (!auth) return mobileJSON({ error: "Unauthorized", code: "unauthorized" }, 401);
  if (auth.session.lockedAt) return mobileJSON({ error: "Sesión bloqueada.", code: "session_locked" }, 423);
  const input = await mobileInput(request, mobileOrganizationSchema);
  if (!input.ok) return input.response;
  const membership = await db.adminMembership.findFirst({ where: { adminUserId: auth.user.id, organizationId: input.data.organizationId, active: true, organization: { active: true } }, select: { organizationId: true } });
  if (!membership) return mobileJSON({ error: "Sin acceso a esta empresa.", code: "organization_forbidden" }, 403);
  const changed = await db.adminSession.updateMany({ where: { id: auth.session.id, userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { activeOrganizationId: membership.organizationId } });
  if (!changed.count) return mobileJSON({ error: "Unauthorized", code: "unauthorized" }, 401);
  return mobileJSON({ organizationId: membership.organizationId });
}
