import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { createOpaqueToken, normalizeUserEmail, tokenDigest } from "@/lib/server/auth";
import { authConfig } from "@/lib/server/config";
import { sendPasswordResetEmail } from "@/lib/server/resend";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { forgotPasswordSchema, isHoneypotTriggered, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await rateLimit(`auth:forgot:${getClientIp(request)}`, 5);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const parsed = forgotPasswordSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);
  const email = normalizeUserEmail(parsed.data.email);
  const user = await db.adminUser.findUnique({ where: { email } });
  if (user) {
    const token = createOpaqueToken();
    await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await db.passwordResetToken.create({ data: { id: randomUUID(), userId: user.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + authConfig.passwordResetDurationMs) } });
    try {
      await sendPasswordResetEmail(user.email, token);
    } catch {
      // Keep the response indistinguishable for unknown and configured accounts.
      console.error("LedBox password reset delivery failed");
    }
  }
  return Response.json({ ok: true, message: "If the account exists, recovery instructions were sent." });
}
