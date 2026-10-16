import { assertOrganizationSlugAvailable, claimOrganizationSlug } from "./organization-slugs";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DEMO_PLAN_CODE } from "@/lib/plan-rules";
import { hashPassword } from "./auth";
import { db } from "./db";
import {
  DEMO_FISCAL_DETAILS,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZATION_NAME,
  DEMO_PAYMENT_DETAILS,
  seedSandboxData,
  wipeDemoData,
} from "./demo-data";
import { newSandboxNs } from "./demo-ns";
import {
  clearSandboxCache,
  SANDBOX_CREATIONS_PER_15_MIN,
  SANDBOX_FULL_IDLE_MS,
  SANDBOX_IDLE_MS,
  SANDBOX_MAX_ACTIVE,
  SANDBOX_MAX_AGE_MS,
  SANDBOX_PER_IP_PER_HOUR,
  SANDBOX_PURGE_BATCH,
  SANDBOX_UNREADY_MS,
} from "./demo-sandbox";

/**
 * Ciclo de vida de las sandboxes de la demo (docs/DEMO-INTERACTIVA.md §1): alta en dos pasos, topes y
 * purga perezosa. Una sandbox es una empresa `isDemo` con `demoParentId` = la vitrina; su visitante es OWNER.
 */

export const SANDBOX_VISITOR_NAME = "Visitante demo";

export type CreatedSandbox = {
  organizationId: string;
  ns: string;
  user: { id: string; name: string; email: string; role: "OWNER" };
  expiresAt: Date;
};

export type CreateSandboxResult =
  | { ok: true; sandbox: CreatedSandbox }
  /** `rate_ip`: 429. `full`: sin lugar (o 60 altas en 15 min): página «volvé en unos minutos». `error`: falló el seed. */
  | { ok: false; reason: "rate_ip" | "full" | "error"; retryAfter?: number };

const IP_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const LONG_TX = { timeout: 30_000, maxWait: 10_000 } as const;

/** Los timestamps de Prisma son UTC sin zona: se compara siempre contra `(iso::timestamptz AT TIME ZONE 'UTC')`. */
const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

let sharedPasswordHash: Promise<string> | null = null;
/** Clave al azar que nadie conoce: el visitante solo entra por la cookie. Un solo hash por proceso (bcrypt es lento). */
function randomPasswordHash(): Promise<string> {
  if (!sharedPasswordHash) sharedPasswordHash = hashPassword(randomBytes(24).toString("base64url"));
  return sharedPasswordHash;
}

export const sandboxIds = (ns: string) => ({
  organizationId: `sbx_${ns}_org`,
  userId: `sbx_${ns}_visitor`,
  membershipId: `sbx_${ns}_visitor_membership`,
  slug: `demo-${ns}`,
  email: `visitante+${ns}@ledbox.demo`,
});

export function nsOfSandboxId(organizationId: string): string | null {
  const match = /^sbx_([a-z2-7]{10})_org$/.exec(organizationId);
  return match ? match[1] : null;
}

/** Hash corto del IP para la clave del tope (no se guarda el IP). */
function ipKey(ip: string): string {
  return createHash("sha256").update(`demo-sandbox-ip:${ip}`).digest("hex").slice(0, 32);
}

type Bucket = { key: string; limit: number; windowMs: number };

async function bucketState(tx: Prisma.TransactionClient, bucket: Bucket, now: Date): Promise<{ ok: boolean; retryAfter: number }> {
  const row = await tx.rateLimitBucket.findUnique({ where: { key: bucket.key } });
  if (!row || now.getTime() - row.windowStart.getTime() >= bucket.windowMs) return { ok: true, retryAfter: Math.ceil(bucket.windowMs / 1000) };
  const retryAfter = Math.max(1, Math.ceil((row.windowStart.getTime() + bucket.windowMs - now.getTime()) / 1000));
  return { ok: row.count < bucket.limit, retryAfter };
}

async function bucketConsume(tx: Prisma.TransactionClient, bucket: Bucket, now: Date): Promise<void> {
  const row = await tx.rateLimitBucket.findUnique({ where: { key: bucket.key } });
  if (!row || now.getTime() - row.windowStart.getTime() >= bucket.windowMs) {
    await tx.rateLimitBucket.upsert({
      where: { key: bucket.key },
      create: { id: `sbx_rl_${randomBytes(8).toString("hex")}`, key: bucket.key, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
  } else {
    await tx.rateLimitBucket.update({ where: { key: bucket.key }, data: { count: { increment: 1 } } });
  }
}

/** Sandboxes vivas: no vencidas por ninguna de las dos reglas (las que nunca se sembraron cuentan 5 min). */
async function activeCount(tx: Prisma.TransactionClient, now: Date): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "Organization"
    WHERE "isDemo" AND "demoParentId" IS NOT NULL
      AND COALESCE("demoExpiresAt", ${utc(new Date(now.getTime() + SANDBOX_MAX_AGE_MS))}) > ${utc(now)}
      AND COALESCE("demoLastSeenAt", "createdAt") > ${utc(new Date(now.getTime() - SANDBOX_IDLE_MS))}
      AND ("demoReady" OR "createdAt" > ${utc(new Date(now.getTime() - SANDBOX_UNREADY_MS))})`;
  return rows[0]?.n ?? 0;
}

type Reservation =
  | { ok: true; ns: string; expiresAt: Date; ids: ReturnType<typeof sandboxIds> }
  | { ok: false; reason: "rate_ip" | "full"; retryAfter?: number };

/** Paso 1: transacción corta con candado que cuenta, aplica topes e inserta la empresa con `demoReady=false`. */
async function reserve(ip: string, now: Date): Promise<Reservation> {
  const ns = newSandboxNs();
  const ids = sandboxIds(ns);
  const expiresAt = new Date(now.getTime() + SANDBOX_MAX_AGE_MS);
  const passwordHash = await randomPasswordHash();
  const demoPlan = await db.plan.findUnique({ where: { code: DEMO_PLAN_CODE }, select: { id: true } });
  const ipBucket: Bucket = { key: `demo:sbx:ip:${ipKey(ip)}`, limit: SANDBOX_PER_IP_PER_HOUR, windowMs: IP_WINDOW_MS };
  const allBucket: Bucket = { key: "demo:sbx:all", limit: SANDBOX_CREATIONS_PER_15_MIN, windowMs: GLOBAL_WINDOW_MS };
  return db.$transaction(
    async (tx): Promise<Reservation> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-sandbox'))`;
      const ipState = await bucketState(tx, ipBucket, now);
      if (!ipState.ok) return { ok: false, reason: "rate_ip", retryAfter: ipState.retryAfter };
      const allState = await bucketState(tx, allBucket, now);
      if (!allState.ok) return { ok: false, reason: "full", retryAfter: allState.retryAfter };
      if ((await activeCount(tx, now)) >= SANDBOX_MAX_ACTIVE) return { ok: false, reason: "full" };
      await bucketConsume(tx, ipBucket, now);
      await bucketConsume(tx, allBucket, now);
      await assertOrganizationSlugAvailable(tx, ids.slug, ids.organizationId);
      await tx.organization.create({
        data: {
          id: ids.organizationId,
          name: DEMO_ORGANIZATION_NAME,
          slug: ids.slug,
          active: true,
          isDemo: true,
          demoParentId: DEMO_ORGANIZATION_ID,
          demoExpiresAt: expiresAt,
          demoLastSeenAt: now,
          demoReady: false,
          paymentDetails: DEMO_PAYMENT_DETAILS,
          fiscalDetails: DEMO_FISCAL_DETAILS,
          ...(demoPlan ? { planId: demoPlan.id, planStartedAt: now } : {}),
        },
      });
      await claimOrganizationSlug(tx, ids.slug, ids.organizationId);
      await tx.adminUser.create({
        data: {
          id: ids.userId,
          name: SANDBOX_VISITOR_NAME,
          email: ids.email,
          passwordHash,
          role: "OWNER",
          active: true,
          pinHash: null,
          pinUpdatedAt: null,
          autoLockEnabled: false,
          demoOrganizationId: ids.organizationId,
        },
      });
      await tx.adminMembership.create({
        data: { id: ids.membershipId, adminUserId: ids.userId, organizationId: ids.organizationId, role: "OWNER", active: true },
      });
      return { ok: true, ns, expiresAt, ids };
    },
    LONG_TX,
  );
}

/** Siembras en paralelo dentro de este proceso: el resto espera, así el pool de conexiones no se agota. */
const SEED_CONCURRENCY = 4;
let seedsRunning = 0;
const seedWaiters: Array<() => void> = [];
async function withSeedSlot<T>(work: () => Promise<T>): Promise<T> {
  if (seedsRunning >= SEED_CONCURRENCY) await new Promise<void>((resolve) => seedWaiters.push(resolve));
  seedsRunning += 1;
  try {
    return await work();
  } finally {
    seedsRunning -= 1;
    seedWaiters.shift()?.();
  }
}

/**
 * Crea una sandbox lista para usar. Llena: purga las vencidas y, si sigue llena, la más ociosa (>30 min sin uso);
 * si aun así no hay lugar devuelve `full`. Si el seed falla queda `demoReady=false` para la purga.
 */
export async function createSandbox(input: { ip: string; now?: Date }): Promise<CreateSandboxResult> {
  const now = input.now ?? new Date();
  let reservation = await reserve(input.ip, now);
  if (!reservation.ok && reservation.reason === "full") {
    await purgeExpiredSandboxes({ limit: SANDBOX_PURGE_BATCH * 5, now });
    reservation = await reserve(input.ip, now);
    if (!reservation.ok && reservation.reason === "full") {
      if (await purgeMostIdleSandbox(now)) reservation = await reserve(input.ip, now);
    }
  }
  if (!reservation.ok) return { ok: false, reason: reservation.reason, retryAfter: reservation.retryAfter };
  const { ns, ids, expiresAt } = reservation;
  // Que ninguna sandbox recién creada pase por empresa real por una caché vieja.
  clearSandboxCache(ids.organizationId);
  try {
    await withSeedSlot(() => seedSandboxData(ids.organizationId, ns));
    await db.organization.update({ where: { id: ids.organizationId }, data: { demoReady: true, demoLastSeenAt: new Date() } });
  } catch (error) {
    console.error("demo: no se pudo preparar la sandbox", ids.organizationId, error);
    clearSandboxCache(ids.organizationId);
    return { ok: false, reason: "error" };
  }
  clearSandboxCache(ids.organizationId);
  return {
    ok: true,
    sandbox: { organizationId: ids.organizationId, ns, user: { id: ids.userId, name: SANDBOX_VISITOR_NAME, email: ids.email, role: "OWNER" }, expiresAt },
  };
}

// ── Purga ───────────────────────────────────────────────────────────────────

/** Acciones del visitante: filas de auditoría que no son del seed, por entidad. */
async function visitorActions(tx: Prisma.TransactionClient, organizationId: string, ns: string): Promise<{ total: number; byEntity: Record<string, number> }> {
  const rows = await tx.$queryRaw<Array<{ entity: string; n: number }>>`
    SELECT "entity", count(*)::int AS n FROM "AuditLog"
    WHERE "organizationId" = ${organizationId} AND NOT starts_with("id", ${`sbx_${ns}_`})
    GROUP BY "entity"`;
  const byEntity: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byEntity[row.entity] = row.n;
    total += row.n;
  }
  return { total, byEntity };
}

/**
 * Borra una sandbox ya bloqueada: anota las acciones en `DemoSession`, borra los datos, los usuarios con
 * `demoOrganizationId` y la empresa. Repetible: sobre una empresa que ya no existe no hace nada.
 */
export async function deleteSandboxRows(tx: Prisma.TransactionClient, organizationId: string): Promise<boolean> {
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, isDemo: true, demoParentId: true } });
  // Nunca se borra otra cosa que una sandbox.
  if (!org || !org.isDemo || !org.demoParentId) return false;
  const ns = nsOfSandboxId(organizationId);
  if (ns) {
    const actions = await visitorActions(tx, organizationId, ns);
    const session = await tx.demoSession.findFirst({ where: { sandboxOrgId: organizationId }, orderBy: { startedAt: "desc" } });
    if (session) {
      const merged: Record<string, number> = { ...((session.actionsByEntity as Record<string, number> | null) ?? {}) };
      for (const [entity, n] of Object.entries(actions.byEntity)) merged[entity] = (merged[entity] ?? 0) + n;
      await tx.demoSession.update({ where: { id: session.id }, data: { actions: session.actions + actions.total, actionsByEntity: merged } });
    }
  }
  await wipeDemoData(tx, organizationId);
  await tx.adminUser.deleteMany({ where: { demoOrganizationId: organizationId } });
  await tx.organization.delete({ where: { id: organizationId } });
  return true;
}

/** Purga una sandbox concreta (reiniciar y DELETE). Devuelve si borró algo. */
export async function purgeSandbox(organizationId: string): Promise<boolean> {
  const done = await db.$transaction(async (tx) => {
    // Candado de la fila: otra purga en curso la deja pasar (SKIP LOCKED) y no se pisan.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} AND "isDemo" AND "demoParentId" IS NOT NULL FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return false;
    return deleteSandboxRows(tx, organizationId);
  }, LONG_TX);
  clearSandboxCache(organizationId);
  return done;
}

async function purgeNext(kind: "expired" | "idle", now: Date): Promise<string | null> {
  const idleCut = utc(new Date(now.getTime() - SANDBOX_IDLE_MS));
  const unreadyCut = utc(new Date(now.getTime() - SANDBOX_UNREADY_MS));
  const fullIdleCut = utc(new Date(now.getTime() - SANDBOX_FULL_IDLE_MS));
  const id = await db.$transaction(async (tx) => {
    const rows =
      kind === "expired"
        ? await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Organization"
            WHERE "isDemo" AND "demoParentId" IS NOT NULL
              AND ("demoExpiresAt" <= ${utc(now)} OR COALESCE("demoLastSeenAt", "createdAt") <= ${idleCut} OR (NOT "demoReady" AND "createdAt" <= ${unreadyCut}))
            ORDER BY COALESCE("demoLastSeenAt", "createdAt") ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Organization"
            WHERE "isDemo" AND "demoParentId" IS NOT NULL AND "demoReady"
              AND COALESCE("demoLastSeenAt", "createdAt") <= ${fullIdleCut}
            ORDER BY COALESCE("demoLastSeenAt", "createdAt") ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const found = rows[0]?.id;
    if (!found) return null;
    await deleteSandboxRows(tx, found);
    return found;
  }, LONG_TX);
  if (id) clearSandboxCache(id);
  return id;
}

/** Purga hasta `limit` sandboxes vencidas (1 h sin uso, 24 h, o sin sembrar). Devuelve cuántas borró. */
export async function purgeExpiredSandboxes(options: { limit?: number; now?: Date } = {}): Promise<number> {
  const limit = options.limit ?? SANDBOX_PURGE_BATCH;
  const now = options.now ?? new Date();
  let purged = 0;
  for (let i = 0; i < limit; i += 1) {
    if (!(await purgeNext("expired", now))) break;
    purged += 1;
  }
  return purged;
}

/** La más ociosa con más de 30 min sin uso (cuando la demo está llena). */
export async function purgeMostIdleSandbox(now: Date = new Date()): Promise<boolean> {
  return Boolean(await purgeNext("idle", now));
}

/** Purga perezosa en `after()` de una entrada: nunca rompe la respuesta. */
export async function purgeExpiredSafely(): Promise<void> {
  try {
    await purgeExpiredSandboxes({ limit: SANDBOX_PURGE_BATCH });
  } catch (error) {
    console.error("demo: falló la purga perezosa de sandboxes", error);
  }
}
