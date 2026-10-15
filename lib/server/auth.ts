import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { after } from "next/server";
import { authConfig, normalizeEmail, requireEnv } from "./config";
import { currentRequestHost, isDemoHostName } from "./demo-host";
import { DEMO_SANDBOX_ENABLED, SANDBOX_TOUCH_INTERVAL_MS, sandboxVigente } from "./demo-sandbox";

export type PublicAdminUser = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "FINANCE" | "OPERATIONS" | "VIEWER";
};

export type AuthenticatedAdmin = {
  user: PublicAdminUser;
  /** Última actividad registrada (docs/SUPERADMIN.md §3); decide si hace falta volver a escribirla. */
  lastActiveAt: Date | null;
  session: {
    id: string;
    userId: string;
    activeOrganizationId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    /** Bloqueo rápido del panel (issue #21): `null` = sesión desbloqueada. */
    lockedAt: Date | null;
    /** PIN fallidos seguidos desde el último bloqueo (tope 5, ver `lib/server/pin.ts`). */
    lockAttempts: number;
    /** Motivo del bloqueo vigente (`inactivity`/`manual`); `null` sin bloqueo. */
    lockReason: string | null;
    createdAt: Date;
  };
};

export function toPublicAdminUser(user: { id: string; name: string; email: string; role: PublicAdminUser["role"] }): PublicAdminUser {
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

export async function createSession(
  user: { id: string; email: string; role: PublicAdminUser["role"] },
  activeOrganizationId?: string | null,
  options?: { expiresAt?: Date },
) {
  const sessionId = randomBytes(16).toString("hex");
  const jti = randomBytes(32).toString("base64url");
  const expiresAt = options?.expiresAt ?? new Date(Date.now() + authConfig.sessionDurationMs);
  await db.adminSession.create({
    data: { id: sessionId, userId: user.id, activeOrganizationId: activeOrganizationId ?? null, jtiHash: digest(jti), expiresAt },
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

/** Cookie de la sandbox de la demo (httpOnly, Lax, Secure en producción); sin `domain`: solo la ve el host demo. */
export async function setDemoSessionCookie(jwt: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(authConfig.demoCookieName, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearDemoSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(authConfig.demoCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

/** ¿Este pedido va al host de la demo con la separación de cookies activa? */
export async function onSandboxHost(): Promise<boolean> {
  return DEMO_SANDBOX_ENABLED && isDemoHostName(await currentRequestHost());
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
  // Las dos cookies nunca se mezclan: el host demo solo lee `ledbox_demo`; los demás solo `ledbox_session`.
  const demoHost = await onSandboxHost();
  const token = cookieStore.get(demoHost ? authConfig.demoCookieName : authConfig.sessionCookieName)?.value;
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
    if (!session || !session.user.active) return null;
    if (DEMO_SANDBOX_ENABLED && !(await sessionMatchesHost(session, demoHost))) return null;
    return {
      user: toPublicAdminUser(session.user),
      lastActiveAt: session.user.lastActiveAt,
      session: {
        id: session.id,
        userId: session.userId,
        activeOrganizationId: session.activeOrganizationId,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        lockedAt: session.lockedAt,
        lockAttempts: session.lockAttempts,
        lockReason: session.lockReason,
        createdAt: session.createdAt,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Separación por host (401 cruzado): una sesión de empresa `isDemo` solo vale en el host demo y una sesión
 * real solo fuera de él. En el host demo la sandbox además tiene que estar lista y vigente (1 h sin uso o
 * 24 h): una vencida que todavía no se purgó ya no abre. Escribe `demoLastSeenAt` como máximo cada 2 min.
 */
async function sessionMatchesHost(session: { activeOrganizationId: string | null }, demoHost: boolean): Promise<boolean> {
  const organization = session.activeOrganizationId
    ? await db.organization.findUnique({
        where: { id: session.activeOrganizationId },
        select: { id: true, isDemo: true, demoParentId: true, demoReady: true, demoExpiresAt: true, demoLastSeenAt: true, createdAt: true },
      })
    : null;
  const isDemoOrg = Boolean(organization?.isDemo);
  if (isDemoOrg !== demoHost) return false;
  if (!organization || !organization.demoParentId) return true;
  const now = Date.now();
  if (!sandboxVigente(organization, now)) return false;
  const lastSeen = (organization.demoLastSeenAt ?? organization.createdAt).getTime();
  if (now - lastSeen >= SANDBOX_TOUCH_INTERVAL_MS) touchSandbox(organization.id);
  return true;
}

function touchSandbox(organizationId: string): void {
  const work = async () => {
    try {
      const cutoff = new Date(Date.now() - SANDBOX_TOUCH_INTERVAL_MS);
      await db.organization.updateMany({
        where: { id: organizationId, isDemo: true, OR: [{ demoLastSeenAt: null }, { demoLastSeenAt: { lt: cutoff } }] },
        data: { demoLastSeenAt: new Date() },
      });
    } catch (error) {
      console.warn("[demo] no se pudo registrar el uso de la sandbox", error instanceof Error ? error.message : error);
    }
  };
  try {
    after(work);
  } catch {
    void work();
  }
}

export async function getCurrentUser() {
  const auth = await getAuthenticatedAdmin();
  return auth?.user ?? null;
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
