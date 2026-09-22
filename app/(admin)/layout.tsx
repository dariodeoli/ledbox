import type { Metadata } from "next";
import { ADMIN_BOOT_SCRIPT, ADMIN_ROOT_ID } from "@/lib/admin-theme";

export const metadata: Metadata = {
  title: "Panel privado",
  description: "Panel privado de gestión de contactos y cotizaciones de LedBox.",
  robots: { index: false, follow: false },
  // PWA del panel (issue #23): instalable desde el subdominio admin, con el
  // dashboard como inicio y su propio manifest (el sitio público conserva el suyo).
  manifest: "/manifest-panel.webmanifest",
  applicationName: "LedBox Panel",
  appleWebApp: { capable: true, title: "LedBox Panel", statusBarStyle: "black-translucent" },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="admin-root" id={ADMIN_ROOT_ID} data-theme="dark" suppressHydrationWarning>
      {/* Aplica tema y sidebar guardados (localStorage) antes del primer pintado. */}
      <script dangerouslySetInnerHTML={{ __html: ADMIN_BOOT_SCRIPT }} />
      {children}
    </div>
  );
}
