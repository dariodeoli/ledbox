import { ensureDemoData, loadDemoPortalBudget } from "@/lib/server/demo-data";
import { jsonError } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/portal/demo` (issue #29): entrada pública al presupuesto de ejemplo.
 *
 * Asegura (idempotente) la empresa demo y sus datos simulados con
 * `ensureDemoData` —nunca toca empresas reales—, resuelve el presupuesto demo
 * `SENT` con link público activo (el de autogestión, para poder ajustar ítems,
 * pedir rebaja y enviar propuesta) y:
 *
 * - con navegador (default) responde `303` a `/p/<código>` —sin marcador: el
 *   modo demo se detecta en el servidor por la empresa del presupuesto
 *   (issue #52)—;
 * - con `Accept: application/json` o `?format=json` responde `{ code, path }`
 *   para consumirlo por fetch sin navegar.
 *
 * No hay sesión de por medio: es la puerta del visitante sin código. Va con
 * rate limit por IP y, si la demo no está disponible —incluida una base caída—,
 * responde con un mensaje claro (nunca 500): JSON `503` o vuelta a la portada
 * con `?demo=unavailable`.
 */

const RATE_LIMIT = 30;
const UNAVAILABLE = "El presupuesto de ejemplo no está disponible en este momento. Probá de nuevo en unos minutos.";

/** JSON cuando lo pide el cliente explícitamente (header o query). */
function wantsJson(request: Request): boolean {
  if (new URL(request.url).searchParams.get("format") === "json") return true;
  return (request.headers.get("accept") || "").toLowerCase().includes("application/json");
}

/**
 * Path del presupuesto de ejemplo. Sin `?demo=1` (issue #52): el modo demo se
 * detecta en el servidor por la empresa del presupuesto, así el link del panel,
 * el QR y el enlace guardado funcionan igual.
 */
function demoPath(code: string): string {
  return `/p/${code}`;
}

/** Demo no disponible: mensaje claro en JSON o vuelta a la portada con aviso. */
function unavailable(request: Request): Response {
  if (wantsJson(request)) return jsonError(UNAVAILABLE, 503);
  // `Location` relativo: sirve igual en el host del portal, en el público y en desarrollo.
  return new Response(null, { status: 303, headers: { Location: "/portal?demo=unavailable" } });
}

export async function GET(request: Request) {
  try {
    const limited = await rateLimit(`portal:demo:${getClientIp(request)}`, RATE_LIMIT);
    if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

    const demo = await ensureDemoData();
    let budget = await loadDemoPortalBudget(demo.organizationId);
    if (!budget) {
      // Red de seguridad (issue #52): el portal de la demo ya no escribe, así
      // que el caso de autogestión no debería consumirse; si una visita vieja
      // —o cualquier otra vía— lo cerró, se vuelve al dataset canónico
      // (wipe + alta idempotente con advisory lock).
      await ensureDemoData({ reset: true });
      budget = await loadDemoPortalBudget(demo.organizationId);
    }
    if (!budget?.publicToken) {
      console.error(`[portal/demo] La demo quedó sin presupuesto abierto (organización ${demo.organizationId}).`);
      return unavailable(request);
    }

    const path = demoPath(budget.publicToken);
    if (wantsJson(request)) return Response.json({ code: budget.publicToken, path });
    return new Response(null, { status: 303, headers: { Location: path } });
  } catch (error) {
    console.error("[portal/demo] No se pudo preparar el presupuesto de ejemplo", error);
    return unavailable(request);
  }
}
