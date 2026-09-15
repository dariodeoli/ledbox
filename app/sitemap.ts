import type { MetadataRoute } from "next";
import { publicConfig } from "@/lib/public-config";
export default function sitemap(): MetadataRoute.Sitemap { return [{ url: `${publicConfig.siteUrl}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 }]; }
