import { selfShareLinks, parseVisitorContact } from "@/lib/store-contact";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";
import { isHoneypotTriggered } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";
import { getPublicOrigin } from "@/lib/server/public-origin";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { createVisitorCart } from "@/lib/server/store-cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/catalog/[orgSlug]/cart/visitor` con `{ name, phone?, email?, items?, from?, to?, zone? }`: un visitante
 * de la tienda abierta deja su contacto (nombre y WhatsApp o correo, al menos uno) y se crea su carrito guardado
 * en el servidor. Responde el enlace mágico (vence a los 30 días y se renueva al guardar); en la base solo vive su
 * hash. No consulta ni revela si el correo o el teléfono ya existen: cada alta es un carrito nuevo. Rate limit por
 * IP (5 cada 15 minutos) y honeypot. Las tiendas con acceso por link no lo usan: el link ya identifica al cliente.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const limited = await rateLimit(`catalog:cart-visitor:${getClientIp(request)}`, 5);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const { orgSlug } = await params;
  const body = (await readJson(request).catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Pedido inválido.", 400);
  if (isHoneypotTriggered(body.honeypot as string | undefined, body.website as string | undefined)) return jsonError("Invalid request.", 400);
  const contact = parseVisitorContact(body);
  if (!contact.ok) return jsonError(contact.error, 400);
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return jsonError("Catálogo no encontrado.", 404);
  if (context.settings.catalogAccessMode !== "OPEN") return jsonError("Esta tienda funciona con link de acceso: usá el que te enviaron.", 403);
  if (context.demo) return Response.json({ simulated: true, message: "Esto es una demo: no se guardó tu carrito." });
  const created = await createVisitorCart(context, contact.value, body);
  const url = `${getPublicOrigin(request)}${created.path}`;
  return Response.json({ token: created.token, path: created.path, url, expiresAt: created.expiresAt.toISOString(), share: selfShareLinks(contact.value, url, context.organization.name) }, { status: 201 });
}
