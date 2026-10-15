import { createPreorder, preorderDailyLimit, preorderSchema, type PublicCatalogContext } from "./catalog-public";
import { withIdempotency } from "./idempotency";
import { jsonError, readJson } from "./http";
import { getPublicOrigin } from "./public-origin";
import { getClientIp, rateLimit, rateLimitResponse } from "./rate-limit";
import { isHoneypotTriggered, validationError } from "./validation";

/**
 * Cuerpo común de los dos endpoints de preorden: el público (cliente final) y el
 * mayorista (link privado). Mismas defensas en ambos: rate-limit por IP, honeypot,
 * idempotencia y tope diario por empresa (por lista de precios).
 */
export async function handlePreorder(
  request: Request,
  options: { rateKey: string; scope: string; resolve: () => Promise<PublicCatalogContext | null> },
): Promise<Response> {
  const limited = await rateLimit(`${options.rateKey}:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const body = await readJson(request);
  const parsed = preorderSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);

  const context = await options.resolve();
  if (!context) return jsonError("Catálogo no encontrado.", 404);
  // Tienda «Con solicitud» o «Privada»: sin el link personal no se pide (la UI tampoco lo ofrece).
  if (!context.access && context.settings.catalogAccessMode !== "OPEN") {
    return jsonError("Esta tienda requiere un link de acceso: pedile acceso a la empresa.", 403);
  }

  // Demo de solo lectura: se valida igual, pero no se guarda nada y se dice claro.
  if (context.demo) {
    return Response.json(
      { simulated: true, message: "Esta es una demo: tu pedido no se guardó ni se envió a nadie. En una empresa real quedaría registrado para responderte." },
      { status: 200 },
    );
  }

  // Tope diario por empresa: frena una ráfaga de pedidos aunque venga de muchas IP.
  const daily = await preorderDailyLimit(context.organization.id, { priceList: context.priceList });
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
      // El link mayorista entra en el alcance: la misma clave en dos links distintos nunca se cruza.
      scope: context.access ? `${options.scope}:${context.access.id}` : options.scope,
      body: { ...operation, ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}) },
    },
    async (tx) => {
      const result = await createPreorder(tx, context, parsed.data, origin);
      if (!result.ok) return jsonError(result.error, result.status);
      return { status: result.status, body: result.body };
    },
  );
}
