import type { MetadataRoute } from "next";
import { publicConfig } from "@/lib/public-config";
export default function sitemap(): MetadataRoute.Sitemap { const now = new Date(); return [{ url: `${publicConfig.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 }, { url: `${publicConfig.siteUrl}/#productos`, lastModified: now, changeFrequency: "weekly", priority: 0.9 }, { url: `${publicConfig.siteUrl}/#contacto`, lastModified: now, changeFrequency: "monthly", priority: 0.8 }]; }
