import type { Metadata } from "next";
import Link from "next/link";
import { AppFooter } from "@/components/app-footer";
import { BrandMark } from "@/components/brand-mark";
import { publicConfig } from "@/lib/public-config";
import { PORTAL_BOOT_SCRIPT, PORTAL_ROOT_ID } from "@/lib/portal-theme";
import { PortalThemeToggle } from "./_components/PortalThemeToggle";

export const metadata: Metadata = {
  title: { default: "Portal del cliente", template: "%s | LedBox" },
  description: "Consultá y aprobá tu presupuesto de LedBox con el código del QR.",
  robots: { index: false, follow: false },
};

/**
 * Portal del cliente (issue #12): superficie pública de los presupuestos.
 * No monta el shell del panel: identidad del sitio (negro/cyan) y una sola
 * columna de contenido. Desde el 25-09-2026 suma modo claro/oscuro propio
 * (preferencia del visitante) y el toggle en la barra superior.
 */
export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="portal" id={PORTAL_ROOT_ID} data-theme="dark" suppressHydrationWarning>
      {/* Aplica el tema guardado (localStorage) antes del primer pintado. */}
      <script dangerouslySetInnerHTML={{ __html: PORTAL_BOOT_SCRIPT }} />
      <header className="portal-top">
        <Link href="/" className="portal-brand" aria-label="LedBox · Portal del cliente">
          <BrandMark className="portal-brand-mark" size={34} />
          <span className="portal-brand-name">
            LEDBOX<span aria-hidden="true">.</span>
          </span>
        </Link>
        <div className="portal-top-actions">
          <span className="portal-top-label">Portal del cliente</span>
          <PortalThemeToggle />
        </div>
      </header>

      <main className="portal-main">{children}</main>

      <AppFooter variant="portal" />
    </div>
  );
}
