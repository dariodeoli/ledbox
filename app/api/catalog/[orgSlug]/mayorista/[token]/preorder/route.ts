import { handlePreorder } from "@/lib/server/catalog-preorder-http";
import { resolveWholesaleCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/mayorista/[token]/preorder`: preorden del catálogo
 * mayorista. El link privado identifica al cliente (sin cuentas): el pedido nace
 * vinculado a ESE cliente y con la lista de precios mayorista. Un token inexistente,
 * revocado o de otra empresa responde 404. Mismas defensas que el público: rate-limit
 * por IP, honeypot, idempotencia y tope diario por empresa (propio del mayorista).
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; token: string }> }) {
  const { orgSlug, token } = await params;
  return handlePreorder(request, {
    rateKey: "catalog:wholesale",
    scope: "catalog:POST:wholesale-preorder",
    resolve: () => resolveWholesaleCatalog(orgSlug, token),
  });
}
