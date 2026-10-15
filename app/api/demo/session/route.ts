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
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { scheduleDemoSandboxLink, scheduleDemoStart, trustedIp } from "@/lib/server/web-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada a la demo pública (issue #14) y, con `DEMO_SANDBOX_ENABLED`, a la demo interactiva por visitante
 * (docs/DEMO-INTERACTIVA.md).
 *
 * Con la sandbox activa (solo en el host demo):
 * - `GET`/`POST` sin sesión demo crean una sandbox (empresa propia, el visitante es OWNER), ponen la cookie
 *   `ledbox_demo` y redirigen a `next`. Con una sesión demo vigente (otra pestaña) reutilizan la misma
 *   sandbox. Si la cookie estaba pero la sandbox venció, se crea una nueva y se deja el aviso
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

async function handleEntry(request: Request, intent: Intent): Promise<Response> {
  const limited = await rateLimit(`demo:session:${getClientIp(request)}`, RATE_LIMIT);
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
