import { adjustBrandColor } from "@/lib/appearance";
import { emailValid, normalizeEmail } from "@/lib/field-rules";
import { locationLine, readOrgProfile } from "@/lib/org-profile";
import { publicConfig } from "@/lib/public-config";
import { db } from "../db";
import { PLATFORM_BRAND, type MailBrand } from "./template";
import { formatSender } from "./transport";

/**
 * Identidad de un correo: quién lo firma (marca para la plantilla), el remitente visible y el
 * `reply-to`. Es el único lugar donde se decide, para que el HTML y el encabezado `From` no
 * se contradigan.
 *
 * - Correo de una empresa: marca = nombre, logo (variante clara para el encabezado oscuro),
 *   color de Apariencia (con contraste AA) y contacto del perfil; `From` = «<Empresa> vía EventOS»
 *   con el dominio de envío configurado; `reply-to` = correo de contacto de la empresa si lo cargó.
 * - Correo de plataforma (alta de empresa, reset, alertas): marca y remitente «EventOS», sin reply-to.
 *
 * Nunca lanza: si la lectura falla, el correo sale con el nombre de la empresa (si se conoce) o
 * como EventOS, nunca con un nombre inventado ni con una imagen rota.
 */
export type MailIdentity = {
  brand: MailBrand;
  from: string;
  replyTo: string | null;
};

/** Identidad de la plataforma (sin consultar nada). */
export function platformMailIdentity(): MailIdentity {
  return { brand: PLATFORM_BRAND, from: formatSender(null), replyTo: null };
}

/** Ruta pública del logo para correos (no depende de que la tienda esté encendida). */
export function mailOrgLogoUrl(orgSlug: string, variant: "light" | "dark"): string {
  return `${publicConfig.siteUrl}/api/mail/logo/${encodeURIComponent(orgSlug)}/${variant}`;
}

export async function mailIdentityFor(
  organizationId: string | null | undefined,
  options: { platform?: boolean } = {},
): Promise<MailIdentity> {
  if (options.platform || !organizationId) return platformMailIdentity();
  try {
    const [organization, settings, logos] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { slug: true, name: true, profile: true } }),
      db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { storefrontAccent: true, storefrontEmail: true, whatsappPhone: true } }),
      db.organizationLogo.findMany({ where: { organizationId }, select: { variant: true, width: true, height: true } }),
    ]);
    if (!organization) return platformMailIdentity();
    const color = adjustBrandColor(settings?.storefrontAccent ?? null);
    const brandColor = color.ok && color.result ? color.result.color : null;
    // El encabezado del correo es oscuro: va la variante clara (`light`, para fondos oscuros);
    // si solo existe la otra, se apoya sobre una chapa blanca.
    const light = logos.find((logo) => logo.variant === "light");
    const logo = light ?? logos.find((item) => item.variant === "dark") ?? null;
    const profile = readOrgProfile(organization.profile);
    const contactEmail = normalizeEmail(profile.contact.email ?? settings?.storefrontEmail ?? "");
    const brand: MailBrand = {
      name: organization.name,
      color: brandColor,
      logoUrl: logo ? mailOrgLogoUrl(organization.slug, logo.variant) : null,
      logoOnPlate: Boolean(logo && !light),
      logoWidth: logo?.width ?? null,
      logoHeight: logo?.height ?? null,
      contact: {
        phone: profile.contact.phone,
        whatsapp: profile.contact.whatsapp ?? settings?.whatsappPhone ?? null,
        instagram: profile.contact.instagram,
        email: contactEmail && emailValid(contactEmail) ? contactEmail : null,
        website: profile.contact.website,
        address: locationLine(profile),
        mapsUrl: profile.location.mapsUrl,
      },
    };
    return { brand, from: formatSender(organization.name), replyTo: brand.contact?.email ?? null };
  } catch (error) {
    console.error("mail: no se pudo leer la marca de la empresa; el correo sale como EventOS", error);
    return platformMailIdentity();
  }
}

/** Marca para la plantilla (atajo de `mailIdentityFor`). */
export async function mailBrandFor(organizationId: string | null | undefined, options: { platform?: boolean } = {}): Promise<MailBrand> {
  return (await mailIdentityFor(organizationId, options)).brand;
}
