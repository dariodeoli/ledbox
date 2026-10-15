import { handleStoreProduct } from "@/lib/server/store-product-http";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/catalog/[orgSlug]/product/[code]`: ficha para la vista rápida de la tienda (cliente final). Ver `store-product-http.ts`. */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; code: string }> }) {
  const { orgSlug, code } = await params;
  return handleStoreProduct(request, { rateKey: "catalog:product", code, resolve: () => resolvePublicCatalog(orgSlug) });
}
