import type { Metadata } from "next";
import { publicConfig } from "@/lib/public-config";

export type ProductLandingVariant = "a" | "b" | "c";

export const PRODUCT_LANDING_VARIANTS: Record<ProductLandingVariant, {
  name: string;
  title: string;
  description: string;
  headline: string;
}> = {
  a: {
    name: "Presentación actual",
    title: "EventOS — presentación actual",
    description: "La presentación actual de EventOS, con su flujo de presupuestos, eventos, inventario, proveedores y finanzas.",
    headline: "Todo tu evento, de la cotización al cobro.",
  },
  b: {
    name: "Gestión multiempresa",
    title: "EventOS — gestión multiempresa",
    description: "Una vista de EventOS enfocada en ordenar equipos, empresas, roles y tareas alrededor de cada evento.",
    headline: "Administrá cada evento.",
  },
  c: {
    name: "Catálogo y presupuestos",
    title: "EventOS — catálogo y presupuestos",
    description: "Una vista de EventOS enfocada en presentar productos, comparar propuestas y facilitar la decisión del cliente.",
    headline: "Presupuestos claros.",
  },
};

export function isProductLandingVariant(value: string): value is ProductLandingVariant {
  return value === "a" || value === "b" || value === "c";
}

export function productLandingPreviewPath(variant: ProductLandingVariant): string {
  return `/preview/landing/${variant}`;
}

export function productLandingPreviewMetadata(variant: ProductLandingVariant): Metadata {
  const content = PRODUCT_LANDING_VARIANTS[variant];
  const path = productLandingPreviewPath(variant);
  const image = `${path}/og`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical: new URL(path, publicConfig.productUrl).toString() },
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false, noimageindex: true, "max-snippet": 0, "max-video-preview": 0 },
    },
    openGraph: {
      title: content.title,
      description: content.description,
      url: new URL(path, publicConfig.productUrl).toString(),
      siteName: "EventOS",
      type: "website",
      locale: "es_PY",
      images: [{ url: image, width: 1200, height: 630, alt: `Vista previa ${variant.toUpperCase()}: ${content.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: content.title,
      description: content.description,
      images: [{ url: image, alt: `Vista previa ${variant.toUpperCase()}: ${content.name}` }],
    },
  };
}
