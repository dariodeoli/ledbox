import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { MailPreview } from "@/lib/mail-preview";

type PreviewScope = { organizationId: string; actorId: string; entity: string; entityId: string };
type PreviewContent = Pick<MailPreview, "from" | "to" | "subject" | "html" | "text">;
const ISSUER = "ledbox:mail-preview";
const AUDIENCE = "ledbox:mail-confirmation";
const TTL_SECONDS = 10 * 60;

export class MailPreviewUnavailableError extends Error {}

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!value) throw new MailPreviewUnavailableError("La confirmación de correo no está configurada.");
  return new TextEncoder().encode(value);
}

/** Bind the exact sendable bytes, sender and recipient; tokens contain no HTML,
 * portal token or recipient data. Fresh rendering detects changed server data. */
function fingerprint(content: PreviewContent): string {
  return createHash("sha256").update(JSON.stringify([
    content.from, content.to, content.subject, content.html, content.text,
  ])).digest("hex");
}

export async function createMailPreview(content: PreviewContent, scope: PreviewScope, now = new Date()): Promise<MailPreview> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + TTL_SECONDS;
  const confirmationToken = await new SignJWT({ ...scope, fingerprint: fingerprint(content) })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(secret());
  return { status: "preview", ...content, confirmationToken, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export async function verifyMailPreviewConfirmation(
  token: string, content: PreviewContent, scope: PreviewScope, now = new Date(),
): Promise<boolean> {
  const key = secret();
  if (!token || token.length > 4096) return false;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, currentDate: now,
      requiredClaims: ["iat", "exp"], maxTokenAge: TTL_SECONDS,
    });
    return payload.organizationId === scope.organizationId && payload.actorId === scope.actorId
      && payload.entity === scope.entity && payload.entityId === scope.entityId
      && payload.fingerprint === fingerprint(content);
  } catch { return false; }
}
