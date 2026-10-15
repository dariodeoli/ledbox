import { jsonError, readJson } from "./http";
import type { PublicCatalogContext } from "./catalog-public";
import { hasSavedCart, loadMemberCart, priceStoreCart, saveMemberCart } from "./store-cart";
import { getClientIp, rateLimit, rateLimitResponse } from "./rate-limit";

/**
 * Cuerpo común de los endpoints del carrito de la tienda (público, link de acceso y mayorista):
 *
 * - `POST`  revalida y precia el carrito (todos): el precio lo calcula el servidor.
 * - `GET`   carrito guardado (solo con link de acceso o mayorista).
 * - `PUT`   guarda el carrito (solo con link): referencias, fechas y zona; nunca precios.
 *
 * Mismas defensas que la preorden: rate-limit por IP, 404 si el catálogo o el link no resuelven y
 * 403 si la tienda exige link y no hay. La demo es de solo lectura: no guarda nada.
 */
export async function handleStoreCart(
  request: Request,
  options: { rateKey: string; resolve: () => Promise<PublicCatalogContext | null> },
): Promise<Response> {
  const limited = await rateLimit(`${options.rateKey}:${getClientIp(request)}`, request.method === "PUT" ? 120 : 90);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const context = await options.resolve();
  if (!context) return jsonError("Catálogo no encontrado.", 404);
  if (!context.access && !context.visitorCartId && context.settings.catalogAccessMode !== "OPEN") {
    return jsonError("Esta tienda requiere un link de acceso: pedile acceso a la empresa.", 403);
  }

  if (request.method === "GET") {
    if (!hasSavedCart(context)) return jsonError("El carrito guardado es solo para clientes con acceso o con enlace.", 404);
    const cart = await loadMemberCart(context);
    return Response.json({ cart: { items: cart.items, from: cart.from, to: cart.to, zone: cart.zone, seenTotal: cart.seenTotal } });
  }

  const body = (await readJson(request).catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Pedido inválido.", 400);

  if (request.method === "PUT") {
    if (!hasSavedCart(context)) return jsonError("El carrito guardado es solo para clientes con acceso o con enlace.", 404);
    if (context.demo) return Response.json({ simulated: true });
    const cart = await saveMemberCart(context, body);
    return Response.json({ cart: { items: cart.items, from: cart.from, to: cart.to, zone: cart.zone, seenTotal: cart.seenTotal } });
  }

  return Response.json({ cart: await priceStoreCart(context, body) });
}
