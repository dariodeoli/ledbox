import { cookies } from "next/headers";
import { after } from "next/server";
import {
  clearDemoSessionCookie,
  clearSessionCookie,
  createSession,
  getAuthenticatedAdmin,
  onSandboxHost,
  revokeCurrentSession,
  setDemoSessionCookie,
  setSessionCookie,
} from "@/lib/server/auth";
import { authConfig } from "@/lib/server/config";
import { ensureDemoData, isDemoOrganizationId } from "@/lib/server/demo-data";
import { publicConfig } from "@/lib/public-config";
import { DEMO_SANDBOX_ENABLED, isSandboxOrg } from "@/lib/server/demo-sandbox";
import { createSandbox, purgeExpiredSafely, purgeSandbox } from "@/lib/server/demo-sandboxes";
import { jsonError } from "@/lib/server/http";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isBotUa } from "@/lib/platform/trafico-core";
import { trustedIp } from "@/lib/server/trusted-ip";
import { scheduleDemoSandboxLink, scheduleDemoStart } from "@/lib/server/web-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada a la demo pública (issue #14) y, con `DEMO_SANDBOX_ENABLED`, a la demo interactiva por visitante
 * (docs/DEMO-INTERACTIVA.md).
 *
 * Con la sandbox activa (solo en el host demo):
 * - `GET` nunca crea nada: con una sesión demo vigente (otra pestaña) redirige a `next`; sin ella muestra la
 *   entrada de la demo (botón «Entrar a la demo» que hace POST, y lo envía solo en un navegador real).
 *   Así bots, prefetch o un `<img src>` de otro sitio no consumen altas.
 * - `POST` sin sesión demo crea una sandbox (empresa propia, el visitante es OWNER), pone la cookie
 *   `ledbox_demo` y redirige a `next`. Exige `Origin`/`Referer` del propio host demo y rechaza UA de bots.
 *   Con una sesión demo vigente (otra pestaña) reutiliza la misma sandbox. Si la cookie estaba pero la sandbox venció, se crea una nueva y se deja el aviso
 *   `ledbox_demo_aviso=vencida` (legible por el navegador, 60 s) para que la UI diga «Tu demo anterior venció;
 *   empezaste una nueva».
 * - `POST reset=1` crea otra sandbox, purga la actual y reemplaza la cookie.
 * - `DELETE` purga la sandbox, revoca la sesión y borra la cookie.
 * - Topes: 4 por IP por hora (429), 150 activas y 60 altas cada 15 min (página «volvé en unos minutos»).
 * - Cada entrada purga hasta 5 sandboxes vencidas en `after()`.
 *
 * Con `DEMO_SANDBOX_ENABLED = false` rige el comportamiento anterior: sesión de la vitrina de solo lectura.
 */

const RATE_LIMIT = 30;
const NOTICE_COOKIE = "ledbox_demo_aviso";

/** Solo rutas internas: nunca un redirect abierto a otro sitio. */
function safeNext(value: string | null | undefined): string {
  const next = (value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/dashboard";
  return next;
}

function redirectTo(path: string, status: 303 | 307): Response {
  // `Location` relativo: el navegador lo resuelve contra el host actual, así
  // sirve igual en admin.ledbox.online, en el host público y en desarrollo.
  return new Response(null, { status, headers: { Location: path } });
}

type Intent = { next: string | null; reset: boolean; json: boolean };

/** `next` y `reset` pueden venir en la query, en un formulario o en JSON. */
async function postIntent(request: Request): Promise<Intent> {
  const query = new URL(request.url).searchParams;
  const truthy = (value: unknown) => value === true || value === "1" || value === "true" || value === "on";
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { next?: unknown; reset?: unknown } | null;
    return {
      next: typeof body?.next === "string" ? body.next : query.get("next"),
      reset: truthy(body?.reset) || truthy(query.get("reset")),
      json: true,
    };
  }
  if (contentType.includes("form")) {
    const form = await request.formData().catch(() => null);
    const value = form?.get("next");
    return {
      next: typeof value === "string" ? value : query.get("next"),
      reset: truthy(form?.get("reset")) || truthy(query.get("reset")),
      json: false,
    };
  }
  return { next: query.get("next"), reset: truthy(query.get("reset")), json: false };
}

function purgeInBackground(): void {
  try {
    after(purgeExpiredSafely);
  } catch {
    void purgeExpiredSafely();
  }
}

// ── Vitrina de solo lectura (vuelta atrás) ──────────────────────────────────

async function enterShowcase(request: Request, nextValue: string | null, options?: { reset?: boolean }): Promise<Response> {
  // `reset` vuelve a sembrar el dataset (issue #58: «Reiniciar la demo» tiene
  // que reiniciar de verdad, no solo asegurar lo que ya está). La entrada
  // normal (GET) nunca reinicia: eso borraría el estado de una visita anterior.
  const demo = await ensureDemoData(options?.reset ? { reset: true } : undefined);
  const session = await createSession({ id: demo.user.id, email: demo.user.email, role: demo.user.role }, demo.organizationId);
  await setSessionCookie(session.jwt, session.expiresAt);
  // Evento `demo_start` (docs/SUPERADMIN.md «Tráfico»): «Reiniciar la demo» no es una demo nueva.
  if (!options?.reset) scheduleDemoStart(request);
  return redirectTo(safeNext(nextValue), 303);
}

// ── Sandbox por visitante ───────────────────────────────────────────────────

async function enterSandbox(request: Request, intent: Intent): Promise<Response> {
  const next = safeNext(intent.next);
  const cookieStore = await cookies();
  const hadCookie = Boolean(cookieStore.get(authConfig.demoCookieName)?.value);
  const auth = await getAuthenticatedAdmin();
  const currentOrgId = auth?.session.activeOrganizationId ?? null;
  const currentIsSandbox = currentOrgId ? await isSandboxOrg(currentOrgId) : false;

  // Otra pestaña (misma cookie): misma sandbox. Solo «Reiniciar» crea otra.
  if (auth && currentIsSandbox && !intent.reset) {
    purgeInBackground();
    return intent.json ? Response.json({ ok: true, reused: true, next }) : redirectTo(next, 303);
  }

  // Crear es solo por POST, desde el propio host demo y con un navegador (no un bot).
  if (request.method !== "POST") return entryPage(next);
  if (!sameHostOrigin(request)) return jsonError("Pedido no permitido.", 403);
  if (isBotUa(request.headers.get("user-agent"))) return jsonError("Pedido no permitido.", 403);

  const created = await createSandbox({ ip: trustedIp(request) });
  if (!created.ok) {
    if (created.reason === "rate_ip") {
      const response = rateLimitResponse(created.retryAfter ?? 3600);
      purgeInBackground();
      return response;
    }
    purgeInBackground();
    const motivo = created.reason === "error" ? "error" : "llena";
    if (intent.json) {
      return Response.json({ error: motivo === "error" ? "No pudimos preparar tu demo, probá de nuevo." : "La demo está llena, volvé en unos minutos.", full: motivo === "llena" }, { status: 503 });
    }
    return redirectTo(`/demo-llena${motivo === "error" ? "?motivo=error" : ""}`, 303);
  }

  const { sandbox } = created;
  const session = await createSession(sandbox.user, sandbox.organizationId, { expiresAt: sandbox.expiresAt });
  await setDemoSessionCookie(session.jwt, session.expiresAt);
  if (intent.reset && auth && currentIsSandbox && currentOrgId) {
    // La nueva ya está lista: recién ahora se borra la anterior (si algo falló arriba, el visitante no pierde la suya).
    try {
      await purgeSandbox(currentOrgId);
    } catch (error) {
      console.error("demo: no se pudo purgar la sandbox anterior al reiniciar", currentOrgId, error);
    }
  } else if (hadCookie && !intent.reset) {
    // La cookie estaba pero la sandbox venció: se crea una nueva y se avisa.
    cookieStore.set(NOTICE_COOKIE, "vencida", { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 });
  }
  scheduleDemoSandboxLink(request, { sandboxOrgId: sandbox.organizationId, reset: intent.reset });
  purgeInBackground();
  return intent.json ? Response.json({ ok: true, next, expired: hadCookie && !intent.reset }) : redirectTo(next, 303);
}

/** `Origin` (o, si falta, `Referer`) tiene que ser el host del pedido: el de la demo. Sin ninguno de los dos, no. */
function sameHostOrigin(request: Request): boolean {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  const source = request.headers.get("origin") || request.headers.get("referer");
  if (!host || !source) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * Entrada de la demo para un GET sin sesión: no crea nada. El botón hace POST; en un navegador real el
 * formulario se envía solo (no mientras la página se precarga), así los links existentes siguen andando.
 */
function entryPage(next: string): Response {
  const html = `<!doctype html>
<html lang="es-PY"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Entrar a la demo de EventOS</title>
<style>
:root{--bg:#f6f7f9;--fg:#14171c;--muted:#4a5260;--card:#fff;--line:#d5d9e0;--accent:#0b5fd6;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--fg:#eef1f5;--muted:#aab2bf;--card:#171b22;--line:#2b323d;--accent:#6aa5ff;--on:#08111f}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:1.4rem;margin:0 0 8px}p{margin:0 0 20px;color:var(--muted)}
button{width:100%;min-height:48px;border:0;border-radius:12px;background:var(--accent);color:var(--on);font:inherit;font-weight:600;cursor:pointer}
button:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
</style></head><body><main>
<h1>Probá EventOS con datos de ejemplo</h1>
<p>Te armamos un espacio propio, con eventos, presupuestos e inventario de muestra. Podés cambiar lo que quieras: es solo tuyo y se borra solo.</p>
<form method="post" action="/api/demo/session" id="entrar"><input type="hidden" name="next" value="${escapeHtml(next)}"><button type="submit">Entrar a la demo</button></form>
<script>(function(){var f=document.getElementById("entrar");function go(){f.requestSubmit?f.requestSubmit():f.submit()}if(document.prerendering){document.addEventListener("prerenderingchange",go,{once:true})}else if(document.visibilityState==="visible"){go()}else{document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")go()},{once:true})}})();</script>
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

async function handleEntry(request: Request, intent: Intent): Promise<Response> {
  const limited = await rateLimit(`demo:session:${trustedIp(request)}`, RATE_LIMIT);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  if (!DEMO_SANDBOX_ENABLED) return enterShowcase(request, intent.next, { reset: intent.reset });
  if (!(await onSandboxHost())) {
    // La sandbox vive solo en el host demo: desde otro host se manda allá (GET) o no existe.
    if (request.method === "GET") return new Response(null, { status: 307, headers: { Location: `${publicConfig.demoUrl}/` } });
    return jsonError("La demo vive en su propio sitio.", 404);
  }
  return enterSandbox(request, intent);
}

export async function GET(request: Request) {
  return handleEntry(request, { next: new URL(request.url).searchParams.get("next"), reset: false, json: false });
}

export async function POST(request: Request) {
  return handleEntry(request, await postIntent(request));
}

export async function DELETE() {
  const auth = await getAuthenticatedAdmin();
  const organizationId = auth?.session.activeOrganizationId ?? null;
  if (DEMO_SANDBOX_ENABLED && (await onSandboxHost())) {
    if (auth && organizationId && (await isSandboxOrg(organizationId))) {
      await revokeCurrentSession();
      await purgeSandbox(organizationId);
    }
    await clearDemoSessionCookie();
    return Response.json({ ok: true });
  }
  if (auth && !(await isDemoOrganizationId(organizationId))) {
    return jsonError("La sesión activa no es la demo.", 409);
  }
  if (auth) await revokeCurrentSession();
  await clearSessionCookie();
  return Response.json({ ok: true });
}
