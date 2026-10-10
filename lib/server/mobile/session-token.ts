import { jwtVerify } from "jose";
import { tokenDigest } from "../auth";

type SessionIdentity = { userId: string; jtiHash: string; revokedAt: Date | null; expiresAt: Date; user: { active: boolean } };

/** Adaptación del JTI persistido; el rol del JWT nunca autoriza datos. */
export async function resolveMobileToken<T extends SessionIdentity>(token: string, secret: Uint8Array, findSession: (userId: string, jtiHash: string) => Promise<T | null>, now = new Date()): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], currentDate: now });
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.jti !== "string" || !payload.jti || typeof payload.exp !== "number") return null;
    const hash = tokenDigest(payload.jti);
    const session = await findSession(payload.sub, hash);
    if (!session || session.userId !== payload.sub || session.jtiHash !== hash || session.revokedAt || session.expiresAt <= now || !session.user.active) return null;
    return session;
  } catch { return null; }
}
