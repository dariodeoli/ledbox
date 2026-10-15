import { Prisma } from "@prisma/client";
import { adjustBrandColor, parseAppearance, readAppearance, type Appearance, type CoverKind } from "@/lib/appearance";
import { parseOrgProfile, readOrgProfile, type OrgProfile } from "@/lib/org-profile";
import { storefrontTheme, type StorefrontTheme } from "@/lib/storefront-theme";
import { auditChanges, recordAudit } from "./audit";
import { db } from "./db";
import { jsonError } from "./http";
import { saveRentalSettings } from "./rental-settings";
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
  const parsed = parseOrgProfile(record?.profile ?? record);
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
  const settings = await db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { storefrontAccent: true } });
  const currentAppearance = readAppearance(row?.appearance);
  const parsed = parseAppearance(record, currentAppearance);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const requestedColor = record && "brandColor" in record ? record.brandColor : settings?.storefrontAccent ?? null;
  const color = adjustBrandColor(requestedColor, { background: parsed.appearance.background });
  if (!color.ok) return jsonError(color.error, 400);
  const brandColor = color.result?.color ?? null;

  const changes = auditChanges(
    { template: currentAppearance.template, font: currentAppearance.font, background: currentAppearance.background, brandColor: settings?.storefrontAccent ?? null },
    { ...parsed.appearance, brandColor },
    ["template", "font", "background", "brandColor"],
  );
  if (changes) {
    await db.organization.update({ where: { id: organizationId }, data: { appearance: parsed.appearance as unknown as Prisma.InputJsonValue } });
    if (brandColor !== (settings?.storefrontAccent ?? null)) await saveRentalSettings(organizationId, { storefrontAccent: brandColor });
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
    brandAdjusted: color.result?.adjusted ?? false,
    brandNotice: color.result?.notice ?? null,
    unchanged: !changes,
  });
}
