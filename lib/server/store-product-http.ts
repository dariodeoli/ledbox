import { jsonError } from "./http";
import type { PublicCatalogContext } from "./catalog-public";
import { loadProductDetail } from "./catalog-product";
import { getClientIp, rateLimit, rateLimitResponse } from "./rate-limit";

/**
 * `GET /api/catalog/<slug>[/acceso|/mayorista/<token>]/product/<id o código>`: la ficha de un producto para la
 * «vista rápida» de la tienda. Es el MISMO DTO público que la ficha (`loadProductDetail`): solo lo que la empresa
 * publicó en ESE catálogo, sin costos ni stock exacto. Mismas defensas que el carrito: rate-limit por IP, 404 si el
 * catálogo, el link o el producto no existen en este catálogo y 403 si la tienda exige link y no hay.
 */
export async function handleStoreProduct(
  request: Request,
  options: { rateKey: string; code: string; resolve: () => Promise<PublicCatalogContext | null> },
): Promise<Response> {
  const limited = await rateLimit(`${options.rateKey}:${getClientIp(request)}`, 120);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const context = await options.resolve();
  if (!context) return jsonError("Catálogo no encontrado.", 404);
  if (!context.access && !context.visitorCartId && context.settings.catalogAccessMode !== "OPEN") {
    return jsonError("Esta tienda requiere un link de acceso: pedile acceso a la empresa.", 403);
  }
  const detail = await loadProductDetail(context, options.code);
  if (!detail) return jsonError("Producto no encontrado.", 404);
  return Response.json({ detail }, { headers: { "Cache-Control": "private, no-store" } });
}
