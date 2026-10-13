import { handlePreorder } from "@/lib/server/catalog-preorder-http";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/preorder`: preorden del catálogo público (cliente
 * final), sin cuenta. Endpoint público: rate-limit por IP, honeypot e
 * `Idempotency-Key` (reenviar la misma clave devuelve la misma respuesta y no
 * duplica nada).
 *
 * Crea o reutiliza el lead de ESA empresa y crea el pedido (`QuoteRequest` en
 * NEW) con sus ítems. No toca `EventInventory`: una preorden no es una reserva.
 * Además del rate-limit por IP hay un tope diario por empresa (`PREORDER_DAILY_LIMIT`, 429).
 * En la empresa demo (solo lectura) no se guarda nada: responde `simulated`.
 * El pedido mayorista tiene su propio endpoint (`.../mayorista/[token]/preorder`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return handlePreorder(request, { rateKey: "catalog:preorder", scope: "catalog:POST:preorder", resolve: () => resolvePublicCatalog(orgSlug) });
}
