import type { Metadata } from "next";
import { publicConfig } from "@/lib/public-config";

export type StoreMetadataInput = {
  organizationSlug: string;
  organizationName: string;
  title: string;
  description: string;
  canonicalPath: string;
  /** URL relativa a una portada o logo servido por el endpoint público de ESTA empresa. */
  socialImagePath?: string | null;
  indexable: boolean;
};

function normalizedStoreOrigin(origin: string): URL {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed;
  } catch {
    // Fall through to the configured site origin.
  }
  return new URL(publicConfig.siteUrl);
}

export function storeMetadataBase(origin = publicConfig.storeUrl): URL {
  return normalizedStoreOrigin(origin);
}

/** URL absoluta usando el origen de tiendas configurado, nunca un Host arbitrario del request. */
export function storeAbsoluteUrl(path: string, origin = publicConfig.storeUrl): string {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return new URL(safePath, normalizedStoreOrigin(origin)).toString();
}

function safeTenantImagePath(slug: string, path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/")) return null;
  const tenantPrefix = `/api/catalog/${encodeURIComponent(slug)}/`;
  if (path.startsWith("//") || path.includes("\\") || path.includes("#")) return null;
  try {
    const parsed = new URL(path, "https://store-assets.invalid");
    if (parsed.origin !== "https://store-assets.invalid" || !parsed.pathname.startsWith(tenantPrefix)) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/** Metadata SEO/social de la tienda. Las rutas privadas reciben robots=false y no llevan previews. */
export function storefrontMetadata(input: StoreMetadataInput, origin = publicConfig.storeUrl): Metadata {
  const canonical = storeAbsoluteUrl(input.canonicalPath, origin);
  const imagePath = input.indexable ? safeTenantImagePath(input.organizationSlug, input.socialImagePath) : null;
  const image = imagePath ? storeAbsoluteUrl(imagePath, origin) : null;
  const description = input.description.trim().slice(0, 300);
  const robots: Metadata["robots"] = input.indexable
    ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } }
    : { index: false, follow: false, nocache: true };

  return {
    title: { absolute: input.title },
    description,
    // Next combina la metadata del layout raíz con la de la tienda. Estos
    // campos reemplazan la identidad global (LedBox/EventOS) por la del
    // comercio dueño del catálogo cuando se comparte su URL.
    applicationName: input.organizationName,
    authors: [{ name: input.organizationName }],
    creator: input.organizationName,
    publisher: input.organizationName,
    keywords: [input.organizationName, "tienda", "alquiler para eventos"],
    metadataBase: normalizedStoreOrigin(origin),
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "es_PY",
      url: canonical,
      siteName: input.organizationName,
      title: input.title,
      description,
      ...(image ? { images: [{ url: image, alt: input.organizationName }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: input.title,
      description,
      ...(image ? { images: [{ url: image, alt: input.organizationName }] } : {}),
    },
    robots,
    ...(input.indexable ? {} : { referrer: "no-referrer" }),
  };
}
