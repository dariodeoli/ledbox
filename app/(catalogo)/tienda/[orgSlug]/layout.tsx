import type { Metadata } from "next";
import type { ReactNode } from "react";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";
import { loadOrganizationLogos } from "@/lib/server/branding";
import { storeFavicon } from "@/lib/store-branding";

export const dynamic = "force-dynamic";

type LayoutProps = { params: Promise<{ orgSlug: string }>; children: ReactNode };

/** La identidad de una empresa solo reemplaza el favicon en su tienda pública. */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context || context.settings.catalogAccessMode !== "OPEN") return {};

  const logos = await loadOrganizationLogos(context.organization.id);
  const icon = storeFavicon(context.organization.slug, logos);
  return icon ? { icons: { icon: { url: icon.url, type: icon.type } } } : {};
}

export default function StoreOrganizationLayout({ children }: LayoutProps) {
  return children;
}
