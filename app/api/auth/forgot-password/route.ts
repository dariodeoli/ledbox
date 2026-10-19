import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { createOpaqueToken, normalizeUserEmail, tokenDigest } from "@/lib/server/auth";
import { authConfig } from "@/lib/server/config";
import { sendPasswordResetEmail } from "@/lib/server/resend";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { forgotPasswordSchema, isHoneypotTriggered, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";
import { authUnavailable, isHttpResponse } from "@/lib/server/auth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await requestPasswordReset(request);
  } catch (error) {
    if (isHttpResponse(error)) return error;
    return authUnavailable("forgot-password", error);
  }
}

async function requestPasswordReset(request: Request): Promise<Response> {
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
    } catch (error) {
      // Keep the response indistinguishable for unknown and configured accounts.
      const name = error instanceof Error ? error.name : "Error";
      console.error("EventOS password reset delivery failed", name);
    }
  }
  return Response.json({ ok: true, message: "If the account exists, recovery instructions were sent." });
}
