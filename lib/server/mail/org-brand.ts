import { adjustBrandColor } from "@/lib/appearance";
import { publicConfig } from "@/lib/public-config";
import { db } from "../db";
import type { MailBrand } from "./template";

/**
 * Marca de la empresa para sus correos: solo el **color** (con contraste AA validado contra
 * blanco, que es donde vive el botón) y el **logo**. El logo es un recurso público de la
 * tienda, así que solo viaja si la empresa tiene la tienda encendida; si no, el encabezado
 * queda con la marca de LedBox (nunca una imagen rota). Nunca lanza: sin marca devuelve `null`.
 */
export async function mailBrandFor(organizationId: string | null | undefined): Promise<MailBrand | null> {
  if (!organizationId) return null;
  try {
    const [organization, settings, logos] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { slug: true, name: true } }),
      db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { storefrontAccent: true, publicCatalogEnabled: true } }),
      db.organizationLogo.findMany({ where: { organizationId }, select: { variant: true } }),
    ]);
    if (!organization) return null;
    const color = adjustBrandColor(settings?.storefrontAccent ?? null);
    const brandColor = color.ok && color.result ? color.result.color : null;
    const variants = new Set(logos.map((logo) => logo.variant));
    // El encabezado del correo es oscuro: va la variante para fondo oscuro; si solo hay la otra, sobre chapa.
    const variant = variants.has("light") ? "light" : variants.has("dark") ? "dark" : null;
    const logoUrl = settings?.publicCatalogEnabled && variant ? `${publicConfig.siteUrl}/api/catalog/${encodeURIComponent(organization.slug)}/logo/${variant}` : null;
    if (!brandColor && !logoUrl) return null;
    return { color: brandColor, logoUrl, logoOnPlate: variant === "dark", name: organization.name };
  } catch (error) {
    console.error("mail: no se pudo leer la marca de la empresa; el correo sale con la marca de LedBox", error);
    return null;
  }
}
