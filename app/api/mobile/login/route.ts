import { createSession, normalizeUserEmail, verifyPassword } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { resolveActiveOrganizationId } from "@/lib/server/tenancy";
import { mobileLoginSchema } from "@/lib/server/mobile/contracts";
import { mobileInput, mobileJSON } from "@/lib/server/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const limited = await rateLimit(`mobile:login:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const input = await mobileInput(request, mobileLoginSchema);
  if (!input.ok) return input.response;
  const user = await db.adminUser.findUnique({ where: { email: normalizeUserEmail(input.data.email) } });
  if (!user || !user.active || !(await verifyPassword(input.data.password, user.passwordHash))) return mobileJSON({ error: "Correo o contraseña inválidos.", code: "invalid_credentials" }, 401);
  const organizationId = await resolveActiveOrganizationId(user.id);
  if (!organizationId) return mobileJSON({ error: "Sin membresía activa.", code: "organization_required" }, 403);
  const session = await createSession(user, organizationId);
  return mobileJSON({ version: 1, session: { accessToken: session.jwt, tokenType: "Bearer", expiresAt: session.expiresAt.toISOString() }, organizationId });
}
