import { resolveOrganizationSlugId } from "@/lib/server/organization-slugs";
import { isLogoVariant } from "@/lib/admin-types";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/mail/logo/[orgSlug]/[variant]`: logo de la empresa para el encabezado de sus correos.
 * Es un recurso de marca que la empresa subió para mostrarse ante sus clientes: público, solo
 * lectura y solo el logo de ESA empresa activa. A diferencia del de la tienda, no depende de que
 * la tienda esté encendida (los correos salen igual). `light` es para fondos oscuros y `dark`
 * para claros. Nada más de la empresa viaja por acá.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; variant: string }> }) {
  const { orgSlug, variant } = await params;
  if (!isLogoVariant(variant)) return jsonError("Logo no encontrado.", 404);
  const organizationId = await resolveOrganizationSlugId(orgSlug);
  if (!organizationId) return jsonError("Logo no encontrado.", 404);
  const organization = await db.organization.findFirst({ where: { id: organizationId, active: true }, select: { id: true } });
  if (!organization) return jsonError("Logo no encontrado.", 404);
  const logo = await db.organizationLogo.findUnique({
    where: { organizationId_variant: { organizationId: organization.id, variant } },
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
