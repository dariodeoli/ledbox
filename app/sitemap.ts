import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { productPath, products } from "@/lib/catalog";
import { siteProfileForHost } from "@/lib/public-config";

/**
 * Sitemap del sitio público (issue #38): la landing y una URL por producto.
 * Las anclas (`/#productos`) no son URLs propias: no se listan.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "ledbox.online";
  const profile = siteProfileForHost(host);
  if (!profile.indexable) return [];
  const now = new Date();
  if (profile.kind === "eventos") {
    // EventOS (issue #168): la landing más sus páginas legales y de estado.
    return [
      { url: `${profile.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
      { url: `${profile.siteUrl}/privacidad`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
      { url: `${profile.siteUrl}/terminos`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
      { url: `${profile.siteUrl}/status`, lastModified: now, changeFrequency: "daily", priority: 0.4 },
    ];
  }
  return [
    { url: `${profile.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    // Política de privacidad (issue #92): pública e indexable, igual que la landing.
    { url: `${profile.siteUrl}/privacidad`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    ...products.map(product => ({
      url: `${profile.siteUrl}${productPath(product)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
