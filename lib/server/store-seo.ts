import { storeFavicon } from "@/lib/store-branding";
import { storeAbsoluteUrl } from "@/lib/store-seo";
import { loadOrganizationLogos } from "./branding";
import { loadCoverVersions, coverUrl } from "./org-presentation";

/** Usa solo la portada o el logo público de la empresa identificada por el contexto. */
export async function loadStoreSocialImage(organizationId: string, slug: string): Promise<string | null> {
  const [covers, logos] = await Promise.all([
    loadCoverVersions(organizationId),
    loadOrganizationLogos(organizationId),
  ]);
  const cover = coverUrl(slug, "desktop", covers.desktop) ?? coverUrl(slug, "mobile", covers.mobile);
  if (cover) return cover;
  const favicon = storeFavicon(slug, logos);
  return favicon?.url ?? null;
}

/** Tenant favicon for metadata in the public store route tree only. */
export async function loadStoreFavicon(organizationId: string, slug: string) {
  const logos = await loadOrganizationLogos(organizationId);
  const favicon = storeFavicon(slug, logos);
  return favicon ? { ...favicon, url: storeAbsoluteUrl(favicon.url) } : null;
}
