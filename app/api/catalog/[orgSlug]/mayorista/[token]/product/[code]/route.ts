import { handleStoreProduct } from "@/lib/server/store-product-http";
import { resolveWholesaleCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/catalog/[orgSlug]/mayorista/[token]/product/[code]`: ficha para la vista rápida (catálogo mayorista). */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; token: string; code: string }> }) {
  const { orgSlug, token, code } = await params;
  return handleStoreProduct(request, { rateKey: "catalog:product:wholesale", code, resolve: () => resolveWholesaleCatalog(orgSlug, token) });
}
