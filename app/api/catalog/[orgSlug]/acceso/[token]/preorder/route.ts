import { handlePreorder } from "@/lib/server/catalog-preorder-http";
import { resolveAccessCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/acceso/[token]/preorder`: preorden del catálogo de cliente final
 * por link de acceso (tiendas «Con solicitud» o «Privada»). El link identifica al cliente al que
 * se le aprobó el acceso; token inexistente, revocado o de otra empresa responde 404. Mismas
 * defensas que el resto: rate-limit por IP, honeypot, idempotencia y tope diario por empresa.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; token: string }> }) {
  const { orgSlug, token } = await params;
  return handlePreorder(request, {
    rateKey: "catalog:access",
    scope: "catalog:POST:access-preorder",
    resolve: () => resolveAccessCatalog(orgSlug, token),
  });
}
