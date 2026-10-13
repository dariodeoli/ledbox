import { createPreorder, preorderDailyLimit, preorderSchema, resolvePublicCatalog } from "@/lib/server/catalog-public";
import { withIdempotency } from "@/lib/server/idempotency";
import { jsonError, readJson } from "@/lib/server/http";
import { getPublicOrigin } from "@/lib/server/public-origin";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, validationError } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/preorder`: preorden del catálogo público, sin
 * cuenta. Endpoint público: rate-limit por IP, honeypot e `Idempotency-Key`
 * (reenviar la misma clave devuelve la misma respuesta y no duplica nada).
 *
 * Crea o reutiliza el lead de ESA empresa y crea el pedido (`QuoteRequest` en
 * NEW) con sus ítems. No toca `EventInventory`: una preorden no es una reserva.
 * Además del rate-limit por IP hay un tope diario por empresa (`PREORDER_DAILY_LIMIT`, 429).
 * En la empresa demo (solo lectura) no se guarda nada: responde `simulated`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const limited = await rateLimit(`catalog:preorder:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const body = await readJson(request);
  const parsed = preorderSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);

  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return jsonError("Catálogo no encontrado.", 404);

  // Demo de solo lectura: se valida igual, pero no se guarda nada y se dice claro.
  if (context.demo) {
    return Response.json(
      { simulated: true, message: "Esta es una demo: tu pedido no se guardó ni se envió a nadie. En una empresa real quedaría registrado para responderte." },
      { status: 200 },
    );
  }

  // Tope diario por empresa: frena una ráfaga de pedidos aunque venga de muchas IP.
  const daily = await preorderDailyLimit(context.organization.id);
  if (daily.reached) {
    return Response.json(
      { error: "Esta empresa recibió hoy el máximo de pedidos del catálogo. Probá de nuevo mañana o escribinos por WhatsApp." },
      { status: 429, headers: { "Retry-After": String(daily.retryAfter) } },
    );
  }

  const origin = getPublicOrigin(request);
  const { honeypot: _h, website: _w, ...operation } = parsed.data;
  return withIdempotency(
    {
      request,
      organizationId: context.organization.id,
      scope: "catalog:POST:preorder",
      body: { ...operation, ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}) },
    },
    async (tx) => {
      const result = await createPreorder(tx, context, parsed.data, origin);
      if (!result.ok) return jsonError(result.error, result.status);
      return { status: result.status, body: result.body };
    },
  );
}
