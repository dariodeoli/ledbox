import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { getClientIp, rateLimit } from "@/lib/server/rate-limit";
import { publicConfig } from "@/lib/public-config";
import {
  MAX_BODY_BYTES,
  countryFromHeaders,
  demoModuleOf,
  deviceFromUa,
  hostKindMap,
  isBotUa,
  parseBeaconBody,
  referrerHostOf,
  visitorHash,
  type HostKind,
} from "@/lib/platform/trafico-core";

/**
 * Captura de métricas propias (docs/SUPERADMIN.md «Tráfico»). Solo servidor.
 * Nunca guarda IP ni user agent: únicamente el hash diario truncado del visitante.
 */

export const VIEW_RATE_LIMIT = 240; // por visitante y ventana de 15 min (una vista = 2 beacons)
const RETENTION_DAYS = 400;
const DEMO_JOIN_WINDOW_HOURS = 2;
const DEMO_DEDUPE_MINUTES = 30;
const DEMO_MAX_DURATION_SEC = 4 * 60 * 60;
const DEMO_MAX_MODULES = 30;

type Schedule = (work: () => Promise<void>) => void;

/** `after()` en el servidor; fuera de un request (pruebas) corre directo. Los errores se loguean siempre. */
export function scheduleSafely(work: () => Promise<void>): void {
  const guarded = async () => {
    try {
      await work();
    } catch (error) {
      console.warn("[web-metrics] no se pudo registrar la métrica", error instanceof Error ? error.message : error);
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

function secret(): string {
  return process.env.AUTH_SECRET || process.env.JWT_SECRET || "ledbox-web-metrics-dev-secret";
}

export function metricsHosts(): Map<string, HostKind> {
  return hostKindMap(
    {
      siteUrl: publicConfig.siteUrl,
      productUrl: publicConfig.productUrl,
      demoUrl: publicConfig.demoUrl,
      clientUrl: publicConfig.clientUrl,
      adminUrl: publicConfig.adminUrl,
    },
    { allowLocal: process.env.NODE_ENV !== "production" },
  );
}

function visitorOf(request: Request, now: Date): string {
  return visitorHash({ secret: secret(), ip: getClientIp(request), ua: request.headers.get("user-agent") || "", now });
}

export type ViewRecord = {
  viewId: string;
  sessionId: string;
  visitorHash: string;
  host: string;
  path: string;
  referrerHost: string | null;
  device: "mobile" | "desktop";
  country: string | null;
  durationSec: number | null;
  scrollPct: number | null;
  isEntry: boolean;
  now: Date;
};

/**
 * Inserta la vista o, si el `viewId` ya existe, actualiza duración y scroll tomando el
 * máximo (idempotente: repetir el mismo beacon no cambia nada). Solo el mismo visitante
 * puede actualizar una vista.
 */
export async function upsertWebView(view: ViewRecord): Promise<void> {
  const at = view.now.toISOString();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "WebView" ("id","viewId","sessionId","visitorHash","host","path","referrerHost","device","country","durationSec","scrollPct","isEntry","createdAt","updatedAt")
    VALUES (${randomUUID()}, ${view.viewId}, ${view.sessionId}, ${view.visitorHash}, ${view.host}, ${view.path}, ${view.referrerHost}, ${view.device}, ${view.country},
            ${view.durationSec}::int, ${view.scrollPct}::int, ${view.isEntry}, (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("viewId") DO UPDATE SET
      "durationSec" = CASE WHEN EXCLUDED."durationSec" IS NULL THEN "WebView"."durationSec"
                           ELSE GREATEST(COALESCE("WebView"."durationSec", 0), EXCLUDED."durationSec") END,
      "scrollPct" = CASE WHEN EXCLUDED."scrollPct" IS NULL THEN "WebView"."scrollPct"
                         ELSE GREATEST(COALESCE("WebView"."scrollPct", 0), EXCLUDED."scrollPct") END,
      "updatedAt" = GREATEST("WebView"."updatedAt", EXCLUDED."updatedAt")
    WHERE "WebView"."visitorHash" = EXCLUDED."visitorHash"`);
}

/**
 * Junta la vista de la demo con su `DemoSession` (por sessionId o, la primera vez, por el
 * mismo visitante de las últimas horas), suma el módulo y actualiza la duración total.
 */
export async function touchDemoSession(input: { visitorHash: string; sessionId: string; module: string; now: Date }): Promise<void> {
  const at = input.now.toISOString();
  await db.$executeRaw(Prisma.sql`
    UPDATE "DemoSession" SET
      "sessionId" = COALESCE("sessionId", ${input.sessionId}),
      "lastSeenAt" = GREATEST("lastSeenAt", (${at}::timestamptz AT TIME ZONE 'UTC')),
      "durationSec" = GREATEST("durationSec", LEAST(${DEMO_MAX_DURATION_SEC}::int, GREATEST(0, EXTRACT(EPOCH FROM ((${at}::timestamptz AT TIME ZONE 'UTC') - "startedAt"))::int))),
      "modules" = CASE WHEN ${input.module} = ANY("modules") OR cardinality("modules") >= ${DEMO_MAX_MODULES}::int
                       THEN "modules" ELSE array_append("modules", ${input.module}) END
    WHERE "id" = (
      SELECT "id" FROM "DemoSession"
      WHERE "sessionId" = ${input.sessionId}
         OR ("sessionId" IS NULL AND "visitorHash" = ${input.visitorHash}
             AND "startedAt" > ((${at}::timestamptz AT TIME ZONE 'UTC') - make_interval(hours => ${DEMO_JOIN_WINDOW_HOURS}::int)))
      ORDER BY ("sessionId" = ${input.sessionId}) DESC NULLS LAST, "startedAt" DESC
      LIMIT 1)`);
}

/** Evento `demo_start`: una fila por visitante cada 30 min (recargar la entrada no cuenta otra demo). */
export async function recordDemoStart(input: { visitorHash: string; now: Date }): Promise<boolean> {
  const at = input.now.toISOString();
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO "DemoSession" ("id","visitorHash","startedAt","lastSeenAt","durationSec","modules")
    SELECT ${randomUUID()}, ${input.visitorHash}, (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'), 0, ARRAY[]::text[]
    WHERE NOT EXISTS (
      SELECT 1 FROM "DemoSession"
      WHERE "visitorHash" = ${input.visitorHash}
        AND "startedAt" > ((${at}::timestamptz AT TIME ZONE 'UTC') - make_interval(mins => ${DEMO_DEDUPE_MINUTES}::int)))`);
  return inserted > 0;
}

/** Purga perezosa (≈1 de cada 500 beacons): borra en lotes lo de más de 400 días. */
export async function purgeOldMetrics(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  await db.$executeRaw(Prisma.sql`DELETE FROM "WebView" WHERE "id" IN (SELECT "id" FROM "WebView" WHERE "createdAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC') LIMIT 5000)`);
  await db.$executeRaw(Prisma.sql`DELETE FROM "DemoSession" WHERE "id" IN (SELECT "id" FROM "DemoSession" WHERE "startedAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC') LIMIT 5000)`);
}

const NO_CONTENT = () => new Response(null, { status: 204 });

export type BeaconDeps = { schedule?: Schedule; now?: Date; random?: () => number };

/**
 * `POST /api/metrics/view`. Responde SIEMPRE 204 y nunca detalla errores. Sin CORS: si el
 * `Origin` viene y no es el host de la vista, se ignora. Escribe en `after()`.
 */
export async function handleViewBeacon(request: Request, deps: BeaconDeps = {}): Promise<Response> {
  try {
    const schedule = deps.schedule ?? scheduleSafely;
    const now = deps.now ?? new Date();
    const ua = request.headers.get("user-agent") || "";
    if (isBotUa(ua) || request.headers.get("dnt") === "1") return NO_CONTENT();
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BODY_BYTES) return NO_CONTENT();
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NO_CONTENT();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NO_CONTENT();
    }
    const hosts = metricsHosts();
    const body = parseBeaconBody(json, hosts);
    if (!body) return NO_CONTENT();
    const kind = hosts.get(body.host);
    // El panel no se mide acá (ya tiene AdminActivityDay); la demo sí. Nunca el panel de plataforma.
    if (!kind || kind === "panel" || body.path.startsWith("/api") || body.path.startsWith("/superadmin")) return NO_CONTENT();
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).hostname.toLowerCase();
      } catch {
        return NO_CONTENT();
      }
      if (originHost !== body.host) return NO_CONTENT();
    }
    const hash = visitorOf(request, now);
    const limited = await rateLimit(`metrics:view:${hash}`, VIEW_RATE_LIMIT);
    if (!limited.allowed) return NO_CONTENT();
    const record: ViewRecord = {
      viewId: body.viewId,
      sessionId: body.sessionId,
      visitorHash: hash,
      host: body.host.replace(/^www\./, ""),
      path: body.path,
      referrerHost: referrerHostOf(body.referrer, body.host),
      device: deviceFromUa(ua),
      country: countryFromHeaders((name) => request.headers.get(name)),
      durationSec: body.durationSec,
      scrollPct: body.scrollPct,
      isEntry: body.isEntry,
      now,
    };
    const random = deps.random ?? Math.random;
    schedule(async () => {
      await upsertWebView(record);
      if (kind === "demo") {
        await touchDemoSession({ visitorHash: hash, sessionId: body.sessionId, module: demoModuleOf(body.path), now });
      }
      if (random() < 1 / 500) await purgeOldMetrics(now);
    });
  } catch (error) {
    console.warn("[web-metrics] beacon ignorado", error instanceof Error ? error.message : error);
  }
  return NO_CONTENT();
}

/** `demo_start` desde `/api/demo/session` (servidor). Ignora bots y DNT; nunca lanza. */
export function scheduleDemoStart(request: Request, deps: { schedule?: Schedule; now?: Date } = {}): boolean {
  try {
    const ua = request.headers.get("user-agent") || "";
    if (isBotUa(ua) || request.headers.get("dnt") === "1") return false;
    const now = deps.now ?? new Date();
    const hash = visitorOf(request, now);
    (deps.schedule ?? scheduleSafely)(async () => {
      await recordDemoStart({ visitorHash: hash, now });
    });
    return true;
  } catch (error) {
    console.warn("[web-metrics] demo_start ignorado", error instanceof Error ? error.message : error);
    return false;
  }
}
