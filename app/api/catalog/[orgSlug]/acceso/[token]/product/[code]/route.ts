import { handleStoreProduct } from "@/lib/server/store-product-http";
import { resolveAccessCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/catalog/[orgSlug]/acceso/[token]/product/[code]`: ficha para la vista rápida (cliente con link de acceso). */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; token: string; code: string }> }) {
  const { orgSlug, token, code } = await params;
  return handleStoreProduct(request, { rateKey: "catalog:product:acceso", code, resolve: () => resolveAccessCatalog(orgSlug, token) });
}
