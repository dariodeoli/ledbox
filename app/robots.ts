import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { siteProfileForHost } from "@/lib/public-config";
export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "ledbox.online";
  const profile = siteProfileForHost(host);
  return { rules: [{ userAgent: "*", allow: profile.indexable ? "/" : [], disallow: profile.indexable ? ["/admin", "/api/"] : ["/"] }], sitemap: `${profile.siteUrl}/sitemap.xml` };
}
