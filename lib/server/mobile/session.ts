import { toPublicAdminUser } from "../auth";
import { requireEnv } from "../config";
import { db } from "../db";
import { parseMobileBearer } from "./contracts";
import { resolveMobileToken } from "./session-token";
import { mobileJSON } from "./http";

/** Adaptador nativo de la misma sesión/JTI. No API keys ni JWT autónomos. */
export async function mobileSession(request: Request) {
  const token = parseMobileBearer(request.headers.get("authorization"));
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || requireEnv("AUTH_SECRET"));
    const session = await resolveMobileToken(token, secret, (userId, jtiHash) => db.adminSession.findFirst({
      where: { userId, jtiHash, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true },
    }));
    if (!session) return null;
    return { user: toPublicAdminUser(session.user), session };
  } catch { return null; }
}

export async function mobileContext(request: Request) {
  const auth = await mobileSession(request);
  if (!auth) return { ok: false as const, response: mobileJSON({ error: "Unauthorized", code: "unauthorized" }, 401) };
  if (auth.session.lockedAt) return { ok: false as const, response: mobileJSON({ error: "Sesión bloqueada.", code: "session_locked" }, 423) };
  if (!auth.session.activeOrganizationId) return { ok: false as const, response: mobileJSON({ error: "Seleccioná una empresa.", code: "organization_required" }, 403) };
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: auth.user.id, organizationId: auth.session.activeOrganizationId, active: true, organization: { active: true } },
    select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
  });
  if (!membership) return { ok: false as const, response: mobileJSON({ error: "Sin acceso a esta empresa.", code: "organization_forbidden" }, 403) };
  return { ok: true as const, auth, membership, organizationId: membership.organization.id };
}
