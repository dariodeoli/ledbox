import { Prisma } from "@prisma/client";
import { adjustBrandColor, parseAppearance, readAppearance, type Appearance, type CoverKind } from "@/lib/appearance";
import { parseOrgProfile, readOrgProfile, type OrgProfile } from "@/lib/org-profile";
import { storefrontTheme, type StorefrontTheme } from "@/lib/storefront-theme";
import { auditChanges, recordAudit } from "./audit";
import { db } from "./db";
import { isJsonObject, jsonError } from "./http";
import { STOREFRONT_TAGLINE_MAX, saveRentalSettings } from "./rental-settings";
import type { AdminContext } from "./tenancy";

/**
 * Cómo se presenta una empresa a sus clientes: perfil, apariencia, color de marca,
 * logos y portadas. Una sola lectura que usan la tienda, el seguimiento del pedido, el
 * portal, la hoja impresa y los correos (cada uno toma lo que le corresponde).
 */

export type CoverVersions = Record<CoverKind, string | null>;

export type OrgPresentation = {
  profile: OrgProfile;
  appearance: Appearance;
  accent: string | null;
  theme: StorefrontTheme;
  logos: { light: boolean; dark: boolean };
  covers: CoverVersions;
};

export async function loadCoverVersions(organizationId: string): Promise<CoverVersions> {
  const rows = await db.organizationCover.findMany({ where: { organizationId }, select: { kind: true, updatedAt: true } });
  const result: CoverVersions = { desktop: null, mobile: null };
  for (const row of rows) if (row.kind === "desktop" || row.kind === "mobile") result[row.kind] = row.updatedAt.toISOString();
  return result;
}

export async function loadOrgPresentation(organizationId: string): Promise<OrgPresentation> {
  const [organization, settings, logos, covers] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { profile: true, appearance: true } }),
    db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { storefrontAccent: true } }),
    db.organizationLogo.findMany({ where: { organizationId }, select: { variant: true } }),
    loadCoverVersions(organizationId),
  ]);
  const variants = new Set(logos.map((logo) => logo.variant));
  const appearance = readAppearance(organization?.appearance);
  const accent = settings?.storefrontAccent ?? null;
  return {
    profile: readOrgProfile(organization?.profile),
    appearance,
    accent,
    theme: storefrontTheme(accent),
    logos: { light: variants.has("light"), dark: variants.has("dark") },
    covers,
  };
}

/** URL pública de la portada (con versión para el caché); `null` si no hay. */
export function coverUrl(slug: string, kind: CoverKind, version: string | null): string | null {
  return version ? `/api/catalog/${encodeURIComponent(slug)}/cover/${kind}?v=${encodeURIComponent(version)}` : null;
}


/**
 * Guarda el perfil de la empresa activa (el cuerpo es el perfil completo; se revalida acá). Siempre
 * escribe la empresa del contexto: nunca otra. Devuelve la respuesta HTTP del endpoint del panel.
 */
export async function saveOrgProfile(context: AdminContext, body: unknown): Promise<Response> {
  const { organizationId, organization } = context;
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!record) return jsonError("El perfil debe ser un objeto JSON.", 400);
  const profileBody = "profile" in record ? record.profile : record;
  if (!isJsonObject(profileBody)) return jsonError("El perfil debe ser un objeto JSON.", 400);
  const parsed = parseOrgProfile(profileBody);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const row = await db.organization.findUnique({ where: { id: organizationId }, select: { profile: true } });
  const before = readOrgProfile(row?.profile);
  const flat = (profile: OrgProfile) => ({
    contacto: JSON.stringify(profile.contact),
    ubicacion: JSON.stringify(profile.location),
    horario: JSON.stringify(profile.hours),
    entrega: JSON.stringify(profile.handover),
    medios: JSON.stringify([profile.paymentMethods, profile.paymentMethodsOther]),
    condiciones: profile.conditions,
  });
  const changes = auditChanges(flat(before), flat(parsed.value), ["contacto", "ubicacion", "horario", "entrega", "medios", "condiciones"]);
  if (!changes) return Response.json({ profile: before, unchanged: true });

  await db.organization.update({ where: { id: organizationId }, data: { profile: parsed.value as unknown as Prisma.InputJsonValue } });
  await recordAudit({
    context,
    action: "update",
    entity: "Organization",
    entityId: organizationId,
    summary: `Actualizó el perfil de «${organization.name}»`,
    detail: { fields: Object.fromEntries(Object.keys(changes).map((key) => [key, "actualizado"])) },
  });
  return Response.json({ profile: parsed.value });
}

/**
 * Guarda la apariencia de la empresa activa. El color de marca se valida con contraste AA
 * (≥ 4,5:1): si no alcanza se **ajusta** y la respuesta lo avisa en `brandNotice`; nunca se guarda
 * un color ilegible. Siempre escribe la empresa del contexto.
 */
export async function saveOrgAppearance(context: AdminContext, body: unknown): Promise<Response> {
  const { organizationId, organization } = context;
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const row = await db.organization.findUnique({ where: { id: organizationId }, select: { appearance: true } });
  const settings = await db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { storefrontAccent: true, storefrontTagline: true } });
  const currentAppearance = readAppearance(row?.appearance);
  const parsed = parseAppearance(record, currentAppearance);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const requestedColor = record && "brandColor" in record ? record.brandColor : settings?.storefrontAccent ?? null;
  const color = adjustBrandColor(requestedColor);
  if (!color.ok) return jsonError(color.error, 400);
  const brandColor = color.result?.color ?? null;

  // La frase de la tienda (título del héroe) se edita acá junto con el resto; se valida con la misma regla de Tienda web.
  let tagline = settings?.storefrontTagline ?? null;
  if (record && "tagline" in record) {
    if (record.tagline !== null && typeof record.tagline !== "string") return jsonError("La frase de la tienda tiene que ser un texto.", 400);
    const phrase = (typeof record.tagline === "string" ? record.tagline : "").replace(/\s+/g, " ").trim();
    if (phrase.length > STOREFRONT_TAGLINE_MAX) return jsonError(`La frase de la tienda no puede superar los ${STOREFRONT_TAGLINE_MAX} caracteres.`, 400);
    tagline = phrase || null;
  }

  const flat = (a: Appearance, accent: string | null, phrase: string | null) => ({
    template: a.template, font: a.font, displayFont: a.displayFont, anuncio: JSON.stringify(a.announcement), priceMode: a.priceMode, brandColor: accent, tagline: phrase, inicio: JSON.stringify(a.home),
  });
  const changes = auditChanges(flat(currentAppearance, settings?.storefrontAccent ?? null, settings?.storefrontTagline ?? null), flat(parsed.appearance, brandColor, tagline), [
    "template", "font", "displayFont", "anuncio", "priceMode", "brandColor", "tagline", "inicio",
  ]);
  if (changes) {
    await db.organization.update({ where: { id: organizationId }, data: { appearance: parsed.appearance as unknown as Prisma.InputJsonValue } });
    const settingsPatch: Record<string, unknown> = {};
    if (brandColor !== (settings?.storefrontAccent ?? null)) settingsPatch.storefrontAccent = brandColor;
    if (tagline !== (settings?.storefrontTagline ?? null)) settingsPatch.storefrontTagline = tagline;
    if (Object.keys(settingsPatch).length > 0) await saveRentalSettings(organizationId, settingsPatch as Parameters<typeof saveRentalSettings>[1]);
    await recordAudit({
      context,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: `Cambió la apariencia de la tienda de «${organization.name}»`,
      detail: { changes },
    });
  }
  return Response.json({
    appearance: parsed.appearance,
    brandColor,
    tagline,
    brandAdjusted: color.result?.adjusted ?? false,
    brandNotice: color.result?.notice ?? null,
    unchanged: !changes,
  });
}
