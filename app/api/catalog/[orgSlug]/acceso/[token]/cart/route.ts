import { handleStoreCart } from "@/lib/server/store-cart-http";
import { resolveAccessCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PUT/POST /api/catalog/[orgSlug]/acceso/[token]/cart`: carrito de la tienda (link de acceso del cliente final). `POST` revalida y precia
 * (el precio lo calcula el servidor); `GET`/`PUT` leen y guardan su carrito. Ver `lib/server/store-cart-http.ts`.
 */
type Ctx = { params: Promise<{ orgSlug: string; token: string }> };

async function handle(request: Request, { params }: Ctx) {
  const { orgSlug, token } = await params;
  return handleStoreCart(request, { rateKey: "catalog:cart:access", resolve: () => resolveAccessCatalog(orgSlug, token) });
}

export const GET = handle;
export const PUT = handle;
export const POST = handle;
