import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ledbox.online"),
  title: { default: "LedBox Paraguay — Pantallas LED y tecnología para eventos", template: "%s | LedBox Paraguay" },
  description: "Alquiler de pantallas LED, tótems, kioskos touch y soluciones visuales para eventos en todo Paraguay.",
  keywords: ["alquiler pantallas LED Paraguay", "tótem touch", "kiosko touch", "pantallas para eventos", "LedBox"],
  authors: [{ name: "LedBox Paraguay" }],
  creator: "LedBox Paraguay",
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_PY", url: "/", siteName: "LedBox Paraguay", title: "LedBox Paraguay — Tecnología visual que impulsa tu marca", description: "Equipos, soporte e instalación para eventos que buscan impacto.", images: [{ url: "/assets/og-image.png", width: 1200, height: 630, alt: "LedBox Paraguay" }] },
  twitter: { card: "summary_large_image", title: "LedBox Paraguay — Tecnología visual", description: "Pantallas LED, tótems y experiencias visuales para eventos.", images: ["/assets/og-image.png"] },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/assets/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: "/assets/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
