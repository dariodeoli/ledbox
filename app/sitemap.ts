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
    return [{ url: `${profile.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 }];
  }
  return [
    { url: `${profile.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${profile.siteUrl}/#productos`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${profile.siteUrl}/#contacto`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    ...products.map(product => ({
      url: `${profile.siteUrl}${productPath(product)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
