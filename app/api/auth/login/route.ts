import { db } from "@/lib/server/db";
import { createSession, normalizeUserEmail, setSessionCookie, toPublicAdminUser, verifyPassword } from "@/lib/server/auth";
import { resolveActiveOrganizationId } from "@/lib/server/tenancy";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { authSchema, isHoneypotTriggered, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await rateLimit(`auth:login:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const parsed = authSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);
  const email = normalizeUserEmail(parsed.data.email);
  const user = await db.adminUser.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(parsed.data.password, user.passwordHash))) return jsonError("Invalid email or password.", 401);
  // Sin membresía activa no hay panel: la cuenta existe pero no tiene empresa.
  const activeOrganizationId = await resolveActiveOrganizationId(user.id);
  if (!activeOrganizationId) return jsonError("Your account has no active organization access.", 403);
  const session = await createSession({ id: user.id, email: user.email, role: user.role }, activeOrganizationId);
  await setSessionCookie(session.jwt, session.expiresAt);
  return Response.json({ user: toPublicAdminUser(user) });
}
