import { db } from "@/lib/server/db";
import { clearSessionCookie, hashPassword, tokenDigest } from "@/lib/server/auth";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, resetPasswordSchema, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await rateLimit(`auth:reset:${getClientIp(request)}`, 5);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const parsed = resetPasswordSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);
  const token = await db.passwordResetToken.findUnique({ where: { tokenHash: tokenDigest(parsed.data.token) } });
  if (!token || token.usedAt || token.expiresAt <= new Date()) return jsonError("Invalid or expired reset token.", 400);
  const now = new Date();
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count !== 1) throw new Error("RESET_TOKEN_ALREADY_USED");
      await tx.adminUser.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.adminSession.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: now } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RESET_TOKEN_ALREADY_USED") return jsonError("Invalid or expired reset token.", 400);
    return jsonError("Password reset is temporarily unavailable.", 503);
  }
  await clearSessionCookie();
  return Response.json({ ok: true });
}
