import { handleStoreCart } from "@/lib/server/store-cart-http";
import { resolveWholesaleCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PUT/POST /api/catalog/[orgSlug]/mayorista/[token]/cart`: carrito de la tienda (catálogo mayorista por link privado). `POST` revalida y precia
 * (el precio lo calcula el servidor); `GET`/`PUT` leen y guardan su carrito. Ver `lib/server/store-cart-http.ts`.
 */
type Ctx = { params: Promise<{ orgSlug: string; token: string }> };

async function handle(request: Request, { params }: Ctx) {
  const { orgSlug, token } = await params;
  return handleStoreCart(request, { rateKey: "catalog:cart:wholesale", resolve: () => resolveWholesaleCatalog(orgSlug, token) });
}

export const GET = handle;
export const PUT = handle;
export const POST = handle;
