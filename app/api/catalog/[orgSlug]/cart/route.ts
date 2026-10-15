import { handleStoreCart } from "@/lib/server/store-cart-http";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/cart`: carrito de la tienda (cliente final, sin cuenta). `POST` revalida y precia
 * (el precio lo calcula el servidor); no hay carrito guardado en el servidor para visitantes. Ver `lib/server/store-cart-http.ts`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return handleStoreCart(request, { rateKey: "catalog:cart", resolve: () => resolvePublicCatalog(orgSlug) });
}
