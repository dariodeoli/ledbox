import { revalidateTag } from "next/cache";
import { clearSessionCookie, createSession, getAuthenticatedAdmin, revokeCurrentSession, setSessionCookie } from "@/lib/server/auth";
import { ensureDemoData, isDemoOrganizationId } from "@/lib/server/demo-data";
import { jsonError } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada a la demo pública (issue #14).
 *
 * `GET`/`POST` aseguran (idempotente) la organización demo, el usuario demo y
 * los datos simulados, crean una sesión con `activeOrganizationId` de la
 * organización demo, setean la cookie del panel y redirigen al `next` (default
 * `/dashboard`). La página `/demo` manda acá la primera vez; el formulario
 * «Reiniciar la demo» usa el `POST`.
 *
 * `DELETE` sale de la demo: revoca la sesión demo y limpia la cookie. Si la
 * sesión es de una cuenta real no la toca (409), así el botón del banner nunca
 * cierra la sesión de un usuario real.
 *
 * No hay credenciales de por medio: la contraseña del usuario demo es aleatoria
 * y su único camino de entrada es este endpoint, con rate limit por IP.
 */

const RATE_LIMIT = 30;

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

async function enterDemo(request: Request, nextValue: string | null, options?: { reset?: boolean }): Promise<Response> {
  const limited = await rateLimit(`demo:session:${getClientIp(request)}`, RATE_LIMIT);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  // `reset` vuelve a sembrar el dataset (issue #58: «Reiniciar la demo» tiene
  // que reiniciar de verdad, no solo asegurar lo que ya está). La entrada
  // normal (GET) nunca reinicia: eso borraría el estado de una visita anterior.
  const demo = await ensureDemoData(options?.reset ? { reset: true } : undefined);
  // «Reiniciar la demo» (issue #58) invalida la lectura cacheada del índice
  // (issue #64) para que la próxima visita vea los datos recién sembrados.
  if (options?.reset) revalidateTag("demo");
  const session = await createSession({ id: demo.user.id, email: demo.user.email, role: demo.user.role }, demo.organizationId);
  await setSessionCookie(session.jwt, session.expiresAt);
  return redirectTo(safeNext(nextValue), 303);
}

export async function GET(request: Request) {
  return enterDemo(request, new URL(request.url).searchParams.get("next"));
}

/** `next` y `reset` pueden venir en la query, en un formulario o en JSON. */
async function postIntent(request: Request): Promise<{ next: string | null; reset: boolean }> {
  const query = new URL(request.url).searchParams;
  const truthy = (value: unknown) => value === true || value === "1" || value === "true" || value === "on";
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { next?: unknown; reset?: unknown } | null;
    return {
      next: typeof body?.next === "string" ? body.next : query.get("next"),
      reset: truthy(body?.reset) || truthy(query.get("reset")),
    };
  }
  if (contentType.includes("form")) {
    const form = await request.formData().catch(() => null);
    const value = form?.get("next");
    return {
      next: typeof value === "string" ? value : query.get("next"),
      reset: truthy(form?.get("reset")) || truthy(query.get("reset")),
    };
  }
  return { next: query.get("next"), reset: truthy(query.get("reset")) };
}

export async function POST(request: Request) {
  const intent = await postIntent(request);
  return enterDemo(request, intent.next, { reset: intent.reset });
}

export async function DELETE() {
  const auth = await getAuthenticatedAdmin();
  if (auth && !(await isDemoOrganizationId(auth.session.activeOrganizationId))) {
    return jsonError("La sesión activa no es la demo.", 409);
  }
  if (auth) await revokeCurrentSession();
  await clearSessionCookie();
  return Response.json({ ok: true });
}
