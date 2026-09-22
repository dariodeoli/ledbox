import type { Metadata } from "next";
import Link from "next/link";
import { AppFooter } from "@/components/app-footer";
import { BrandMark } from "@/components/brand-mark";
import { publicConfig } from "@/lib/public-config";

export const metadata: Metadata = {
  title: { default: "Portal del cliente", template: "%s | LedBox" },
  description: "Consultá y aprobá tu presupuesto de LedBox con el código del QR.",
  robots: { index: false, follow: false },
};

/**
 * Portal del cliente (issue #12): superficie pública de los presupuestos.
 * No monta el shell del panel: identidad del sitio (negro/cyan) y una sola
 * columna de contenido.
 */
export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="portal">
      <header className="portal-top">
        <Link href="/" className="portal-brand" aria-label="LedBox · Portal del cliente">
          <BrandMark className="portal-brand-mark" size={34} />
          <span className="portal-brand-name">
            LEDBOX<span aria-hidden="true">.</span>
          </span>
        </Link>
        <span className="portal-top-label">Portal del cliente</span>
      </header>

      <main className="portal-main">{children}</main>

      <AppFooter variant="portal" />
    </div>
  );
}
