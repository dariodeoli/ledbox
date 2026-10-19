import type { LogoVariant } from "@/lib/admin-types";

export type StoreLogoMetadata = {
  variant: LogoVariant;
  mime: string;
  updatedAt: Date;
};

/**
 * The dark logo is intended for light surfaces and is the clearest tab icon.
 * If a company only uploaded its light logo, use that one; never borrow another
 * organization's brand or the admin app's metadata for a storefront.
 */
export function storeFavicon(organizationSlug: string, logos: Record<LogoVariant, StoreLogoMetadata | null>) {
  const logo = logos.dark ?? logos.light;
  if (!logo) return null;
  const version = encodeURIComponent(logo.updatedAt.toISOString());
  return {
    url: `/api/catalog/${encodeURIComponent(organizationSlug)}/logo/${logo.variant}?v=${version}`,
    type: logo.mime,
  };
}
