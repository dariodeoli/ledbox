import type { MetadataRoute } from "next";
import { productPath, products } from "@/lib/catalog";
import { publicConfig } from "@/lib/public-config";

/**
 * Sitemap del sitio público (issue #38): la landing y una URL por producto.
 * Las anclas (`/#productos`) no son URLs propias: no se listan.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${publicConfig.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...products.map(product => ({
      url: `${publicConfig.siteUrl}${productPath(product)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
