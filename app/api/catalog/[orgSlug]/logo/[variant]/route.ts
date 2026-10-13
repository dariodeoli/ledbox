import { isLogoVariant } from "@/lib/admin-types";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/catalog/[orgSlug]/logo/[variant]`: logo de la empresa para su tienda web.
 * Público, pero solo si la empresa encendió la tienda (si no, 404 como todo lo demás)
 * y solo el logo de ESA empresa. `light` es para fondos oscuros y `dark` para claros.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; variant: string }> }) {
  const { orgSlug, variant } = await params;
  if (!isLogoVariant(variant)) return jsonError("Logo no encontrado.", 404);
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return jsonError("Logo no encontrado.", 404);
  const logo = await db.organizationLogo.findUnique({
    where: { organizationId_variant: { organizationId: context.organization.id, variant } },
    select: { mime: true, size: true, data: true },
  });
  if (!logo) return jsonError("Logo no encontrado.", 404);
  return new Response(new Uint8Array(logo.data), {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.size),
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
