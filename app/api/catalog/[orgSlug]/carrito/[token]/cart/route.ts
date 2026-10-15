import { handleStoreCart } from "@/lib/server/store-cart-http";
import { resolveVisitorCartCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PUT/POST /api/catalog/[orgSlug]/carrito/[token]/cart`: el carrito guardado de un visitante, por su enlace
 * mágico (vencido, inexistente o de otra empresa: 404). `GET`/`PUT` leen y guardan; `POST` revalida y precia
 * (el precio lo calcula el servidor). Ver `lib/server/store-cart-http.ts`.
 */
type Ctx = { params: Promise<{ orgSlug: string; token: string }> };

async function handle(request: Request, { params }: Ctx) {
  const { orgSlug, token } = await params;
  return handleStoreCart(request, { rateKey: "catalog:cart:visitor", resolve: () => resolveVisitorCartCatalog(orgSlug, token) });
}

export const GET = handle;
export const PUT = handle;
export const POST = handle;
