import type { Metadata } from "next";
import { ADMIN_ROOT_ID, ADMIN_THEME_SCRIPT } from "@/lib/admin-theme";

export const metadata: Metadata = {
  title: "Panel privado",
  description: "Panel privado de gestión de contactos y cotizaciones de LedBox.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="admin-root" id={ADMIN_ROOT_ID} data-theme="dark" suppressHydrationWarning>
      {/* Aplica el tema guardado (localStorage "ledbox-admin-theme") antes del primer pintado. */}
      <script dangerouslySetInnerHTML={{ __html: ADMIN_THEME_SCRIPT }} />
      {children}
    </div>
  );
}
