import { createHash, createHmac } from "node:crypto";
import { ADMIN_ROUTES } from "@/lib/admin-routes";

/**
 * Núcleo PURO de las métricas propias de tráfico (docs/SUPERADMIN.md «Tráfico»).
 * Sin base, sin Next: normalización de paths, referrer, dispositivo, bots, hash
 * diario del visitante y validación estricta del cuerpo del beacon.
 */

export const MAX_DURATION_SEC = 1800;
export const MAX_PATH_LENGTH = 200;
export const MAX_BODY_BYTES = 2048;
const TIME_ZONE = "America/Asuncion";

// ── Hosts ───────────────────────────────────────────────────────────────────

export type HostKind = "site" | "eventos" | "demo" | "portal" | "panel";
export type HostConfig = { siteUrl: string; productUrl: string; demoUrl: string; clientUrl: string; adminUrl: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Lista cerrada de hosts que pueden mandar métricas, con su clase. Todo lo demás se ignora. */
export function hostKindMap(config: HostConfig, options?: { allowLocal?: boolean }): Map<string, HostKind> {
  const map = new Map<string, HostKind>();
  const add = (url: string, kind: HostKind, www = false) => {
    const host = hostOf(url);
    if (!host) return;
    map.set(host, kind);
    if (www && !host.startsWith("www.")) map.set(`www.${host}`, kind);
  };
  add(config.siteUrl, "site", true);
  add(config.productUrl, "eventos");
  add(config.demoUrl, "demo");
  add(config.clientUrl, "portal");
  add(config.adminUrl, "panel");
  add("https://admin.ledbox.online", "panel");
  if (options?.allowLocal) {
    map.set("localhost", "site");
    map.set("127.0.0.1", "site");
  }
  return map;
}

// ── Path ────────────────────────────────────────────────────────────────────

/** Raíces cuyo segundo segmento es un token (portal, firma, comparación, seguimiento de pedido). */
const TOKEN_ROOTS = new Set(["p", "firma", "comparar", "pedido", "portal"]);
const STATIC_SUFFIXES = new Set(["documento", "auditoria", "mayorista"]);
/** Secciones públicas cuyo segundo segmento es un slug legible (no un secreto). */
const SLUG_ROOTS = new Set(["productos", "catalogo", "tienda"]);

/** Raíces conocidas: rutas públicas reales y rutas del panel (demo). Bajo cualquier otra raíz, lo que sigue es :id. */
const KNOWN_ROOTS = new Set<string>([
  ...TOKEN_ROOTS,
  ...SLUG_ROOTS,
  "producto",
  "privacidad",
  "terminos",
  "status",
  "demo",
  ...ADMIN_ROUTES.map((route) => route.split("/")[1]),
]);

function looksLikeId(segment: string): boolean {
  if (/[@%]/.test(segment)) return true; // correo o texto codificado
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^[0-9a-f]{8,}$/i.test(segment)) return true;
  if (/^lbx/i.test(segment)) return true;
  if (segment.includes("_")) return true;
  if (segment.length >= 24) return true;
  if (segment.length >= 8 && /\d/.test(segment) && /[a-z]/i.test(segment)) return true;
  return false;
}

/**
 * Path sin query ni fragmento, con tokens e ids reemplazados por `:token` / `:id`
 * para no guardar secretos. Devuelve `null` si no es un path usable.
 */
export function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  const clean = raw.split("#")[0].split("?")[0];
  if (clean.length > 300) return null;
  const parts = clean.split("/").filter(Boolean).slice(0, 8);
  const out: string[] = [];
  parts.forEach((part, index) => {
    const segment = part.toLowerCase();
    if (index === 0) {
      out.push(/[@%]/.test(segment) ? ":id" : segment);
      return;
    }
    const root = out[0];
    if (!KNOWN_ROOTS.has(root)) {
      out.push(":id");
      return;
    }
    if (TOKEN_ROOTS.has(root)) {
      out.push(index === 1 ? ":token" : STATIC_SUFFIXES.has(segment) ? segment : ":id");
      return;
    }
    if (root === "tienda" && out[2] === "mayorista" && index === 3) {
      out.push(":token");
      return;
    }
    if (SLUG_ROOTS.has(root)) {
      if (index === 1) out.push(segment.length > 60 || /[@%]/.test(segment) ? ":id" : segment);
      else out.push(STATIC_SUFFIXES.has(segment) ? segment : looksLikeId(segment) ? ":id" : segment);
      return;
    }
    out.push(looksLikeId(segment) ? ":id" : segment);
  });
  const path = `/${out.join("/")}`;
  return path.length > MAX_PATH_LENGTH ? path.slice(0, MAX_PATH_LENGTH) : path;
}

/** Módulo de la demo = primer segmento del path (la entrada es «entrada»). */
export function demoModuleOf(normalizedPath: string): string {
  const first = normalizedPath.split("/").filter(Boolean)[0] ?? "";
  if (!first || first === "demo" || first.startsWith(":")) return "entrada";
  return first.slice(0, 40);
}

// ── Referrer, dispositivo, bots, país ───────────────────────────────────────

/** Solo el dominio del referrer; nulo si es de la misma web, no es http(s) o no se entiende. */
export function referrerHostOf(raw: unknown, pageHost: string): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 400) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.length > 100) return null;
    const own = pageHost.toLowerCase().replace(/^www\./, "");
    const ownRoot = own.split(".").slice(-2).join(".");
    if (host === own || host === ownRoot || host.endsWith(`.${ownRoot}`)) return null;
    return host;
  } catch {
    return null;
  }
}

export function deviceFromUa(ua: string | null | undefined): "mobile" | "desktop" {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua || "") ? "mobile" : "desktop";
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python|node-fetch|undici|axios|go-http|java\/|httpclient|scrapy|whatsapp|telegram|discord|embedly|gptbot|claude|perplexity|semrush|ahrefs|mj12|phantomjs|puppeteer|playwright|okhttp|libwww/i;

/** UA vacío o de robot/monitor/previsualizador. */
export function isBotUa(ua: string | null | undefined): boolean {
  const value = (ua || "").trim();
  return value.length < 10 || BOT_PATTERN.test(value);
}

/** País solo si el proxy lo manda en un header conocido y es un código ISO de dos letras. */
export function countryFromHeaders(get: (name: string) => string | null): string | null {
  for (const name of ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"]) {
    const value = (get(name) || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  return null;
}

// ── Visitante anónimo ───────────────────────────────────────────────────────

/** Día de Paraguay (`YYYY-MM-DD`) para un instante. */
export function paraguayDay(date: Date): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Sal del día: HMAC del día con el secreto del servidor. Rota cada día y nunca se guarda. */
export function dailySalt(secret: string, day: string): string {
  return createHmac("sha256", secret).update(`ledbox-web-metrics:${day}`).digest("hex");
}

/** `sha256(sal_del_día + ip + ua)` truncado a 16 hex. Nunca devuelve ni guarda la IP ni el UA. */
export function visitorHash(input: { secret: string; ip: string; ua: string; now: Date }): string {
  const salt = dailySalt(input.secret, paraguayDay(input.now));
  return createHash("sha256").update(`${salt}|${input.ip}|${input.ua}`).digest("hex").slice(0, 16);
}

// ── Cuerpo del beacon ───────────────────────────────────────────────────────

export type BeaconBody = {
  viewId: string;
  sessionId: string;
  host: string;
  path: string;
  referrer: string | null;
  durationSec: number | null;
  scrollPct: number | null;
  isEntry: boolean;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
const ALLOWED_KEYS = new Set(["viewId", "sessionId", "host", "path", "referrer", "durationSec", "scrollPct", "isEntry"]);

/**
 * Validación estricta: tipos, tamaños, claves conocidas y host en la lista cerrada.
 * Devuelve `null` ante cualquier duda (el endpoint responde 204 igual y no guarda).
 */
export function parseBeaconBody(raw: unknown, allowedHosts: { has(host: string): boolean }): BeaconBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (typeof body.viewId !== "string" || !ID_PATTERN.test(body.viewId)) return null;
  if (typeof body.sessionId !== "string" || !ID_PATTERN.test(body.sessionId)) return null;
  if (typeof body.host !== "string" || body.host.length > 100) return null;
  const host = body.host.toLowerCase();
  if (!allowedHosts.has(host)) return null;
  const path = normalizePath(body.path);
  if (!path) return null;
  let referrer: string | null = null;
  if (body.referrer !== undefined && body.referrer !== null) {
    if (typeof body.referrer !== "string" || body.referrer.length > 400) return null;
    referrer = body.referrer;
  }
  let durationSec: number | null = null;
  if (body.durationSec !== undefined && body.durationSec !== null) {
    if (typeof body.durationSec !== "number" || !Number.isFinite(body.durationSec) || body.durationSec < 0) return null;
    durationSec = Math.min(MAX_DURATION_SEC, Math.round(body.durationSec));
  }
  let scrollPct: number | null = null;
  if (body.scrollPct !== undefined && body.scrollPct !== null) {
    if (typeof body.scrollPct !== "number" || !Number.isFinite(body.scrollPct) || body.scrollPct < 0 || body.scrollPct > 100) return null;
    scrollPct = Math.round(body.scrollPct);
  }
  if (body.isEntry !== undefined && typeof body.isEntry !== "boolean") return null;
  return { viewId: body.viewId, sessionId: body.sessionId, host, path, referrer, durationSec, scrollPct, isEntry: body.isEntry === true };
}
