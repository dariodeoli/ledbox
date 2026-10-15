import { accessRequestSchema, submitAccessRequest } from "@/lib/server/catalog-access-requests";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";
import { jsonError, readJson } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, validationError } from "@/lib/server/validation";
import { ACCESS_REQUEST_ACK } from "@/lib/catalog-access-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/access-request`: la persona pide acceso al catálogo (modo
 * «Con solicitud»). Endpoint público: rate-limit por IP y por empresa, honeypot y tope de
 * pendientes. **No revela si el correo ya existe**: la respuesta es siempre el mismo acuse
 * (202) haya o no una solicitud previa. En la demo no se guarda nada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ip = getClientIp(request);
  const limited = await rateLimit(`catalog:access:${ip}`, 5);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const parsed = accessRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);

  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return jsonError("Catálogo no encontrado.", 404);
  if (context.settings.catalogAccessMode !== "REQUEST") return jsonError("Esta tienda no recibe solicitudes de acceso.", 403);
  // Tope por empresa además del de la IP: una ráfaga repartida entre muchas IP también se frena.
  const perOrg = await rateLimit(`catalog:access-org:${context.organization.id}`, 60);
  if (!perOrg.allowed) return rateLimitResponse(perOrg.retryAfter);

  if (context.demo) {
    return Response.json({ message: "Esta es una demo: tu solicitud no se guardó ni se envió a nadie." }, { status: 202 });
  }
  const result = await submitAccessRequest(context.organization.id, parsed.data);
  return Response.json({ message: result.ack }, { status: 202 });
}
