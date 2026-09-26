import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { siteProfileForHost } from "@/lib/public-config";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "ledbox.online";
  const profile = siteProfileForHost(host);
  const isEventOS = profile.kind === "eventos" || profile.kind === "app" || profile.kind === "admin";
  return {
    metadataBase: new URL(profile.siteUrl),
    title: { default: profile.title, template: `%s | ${isEventOS ? "EventOS" : "LedBox Paraguay"}` },
    description: profile.description,
    keywords: isEventOS
      ? ["gestión de eventos", "software para eventos", "presupuestos para eventos", "inventario para eventos", "EventOS"]
      : ["alquiler pantallas LED Paraguay", "tótem touch", "kiosko touch", "pantallas para eventos", "LedBox"],
    authors: [{ name: isEventOS ? "EventOS" : "LedBox Paraguay" }],
    creator: isEventOS ? "EventOS" : "LedBox Paraguay",
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "es_PY",
      url: "/",
      siteName: isEventOS ? "EventOS" : "LedBox Paraguay",
      title: profile.title,
      description: profile.description,
      images: [{ url: "/assets/og-image.png", width: 1200, height: 630, alt: profile.title }],
    },
    twitter: { card: "summary_large_image", title: profile.title, description: profile.description, images: ["/assets/og-image.png"] },
    icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/assets/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: "/assets/apple-touch-icon.png" },
    manifest: "/manifest.webmanifest",
    category: "business",
    formatDetection: { telephone: true, email: true, address: true },
    robots: { index: profile.indexable, follow: profile.indexable, googleBot: { index: profile.indexable, follow: profile.indexable, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  };
}

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#050606" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
