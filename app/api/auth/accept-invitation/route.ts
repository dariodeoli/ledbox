import { db } from "@/lib/server/db";
import { createSession, setSessionCookie, toPublicAdminUser } from "@/lib/server/auth";
import { acceptInvitationWithPassword } from "@/lib/server/invitations";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { acceptInvitationSchema, isHoneypotTriggered, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/accept-invitation` (issue #31): aceptación pública de una
 * invitación al equipo con el token del link.
 *
 * - Cuenta nueva: nombre y contraseña (mínimo 8) crean la cuenta y la
 *   membresía con el rol invitado.
 * - Cuenta existente: se **verifica** la contraseña (nunca se reemplaza) y se
 *   suma la membresía; las sesiones previas de esa cuenta se cierran.
 * - Token inválido, vencido, revocado o ya usado devuelve un mensaje claro (nunca
 *   500); con la aceptación se abre la sesión y la persona entra al panel.
 */
export async function POST(request: Request) {
  const limited = await rateLimit(`auth:invitation:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const parsed = acceptInvitationSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);

  const result = await acceptInvitationWithPassword({
    token: parsed.data.token,
    name: parsed.data.name || undefined,
    password: parsed.data.password ?? "",
  });
  if (!result.ok) return jsonError(result.error, result.status);

  const user = await db.adminUser.findUnique({ where: { id: result.userId } });
  if (!user || !user.active) return jsonError("La cuenta no está disponible.", 403);
  const session = await createSession({ id: user.id, email: user.email, role: result.role }, result.organizationId);
  await setSessionCookie(session.jwt, session.expiresAt);
  return Response.json({
    ok: true,
    user: toPublicAdminUser({ id: user.id, name: user.name, email: user.email, role: result.role }),
    organization: result.organization,
    role: result.role,
  });
}
