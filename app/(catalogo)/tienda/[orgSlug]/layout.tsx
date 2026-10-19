import type { Metadata } from "next";
import type { ReactNode } from "react";
import { publicConfig } from "@/lib/public-config";
import { resolvePublicCatalog } from "@/lib/server/catalog-public";
import { loadStoreFavicon } from "@/lib/server/store-seo";
import { storeMetadataBase } from "@/lib/store-seo";

export const dynamic = "force-dynamic";

type LayoutProps = { params: Promise<{ orgSlug: string }>; children: ReactNode };

/** La identidad de una empresa solo reemplaza el favicon en su tienda pública. */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  const metadataBase = storeMetadataBase(publicConfig.storeUrl);
  if (!context || context.settings.catalogAccessMode !== "OPEN") return { metadataBase };

  const icon = await loadStoreFavicon(context.organization.id, context.organization.slug);
  return { metadataBase, ...(icon ? { icons: { icon: { url: icon.url, type: icon.type } } } : {}) };
}

export default function StoreOrganizationLayout({ children }: LayoutProps) {
  return children;
}
