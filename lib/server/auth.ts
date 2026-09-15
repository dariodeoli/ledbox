import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { authConfig, isAllowedAdminEmail, normalizeEmail, requireEnv } from "./config";

export type PublicAdminUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN";
};

export type AuthenticatedAdmin = {
  user: PublicAdminUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  };
};

export function toPublicAdminUser(user: { id: string; name: string; email: string; role: "ADMIN" }): PublicAdminUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET || requireEnv("AUTH_SECRET"));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUserEmail(email: string): string {
  return normalizeEmail(email);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(user: { id: string; email: string; role: "ADMIN" }) {
  const sessionId = randomBytes(16).toString("hex");
  const jti = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + authConfig.sessionDurationMs);
  await db.adminSession.create({
    data: { id: sessionId, userId: user.id, jtiHash: digest(jti), expiresAt },
  });
  const jwt = await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecret());
  return { jwt, expiresAt, sessionId };
}

export async function setSessionCookie(jwt: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(authConfig.sessionCookieName, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(authConfig.sessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function getAuthenticatedAdmin(): Promise<AuthenticatedAdmin | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(authConfig.sessionCookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!userId || !jti) return null;
    const session = await db.adminSession.findFirst({
      where: { userId, jtiHash: digest(jti), revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session || !session.user.active || !isAllowedAdminEmail(session.user.email) || session.user.role !== "ADMIN") return null;
    return {
      user: toPublicAdminUser(session.user),
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        createdAt: session.createdAt,
      },
    };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const auth = await getAuthenticatedAdmin();
  return auth?.user ?? null;
}

export async function requireAdmin() {
  return getAuthenticatedAdmin();
}

export async function revokeCurrentSession(): Promise<void> {
  const auth = await getAuthenticatedAdmin();
  if (auth) await db.adminSession.update({ where: { id: auth.session.id }, data: { revokedAt: new Date() } });
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenDigest(token: string): string {
  return digest(token);
}
