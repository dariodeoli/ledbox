import type { Metadata } from "next";
import { FormulariosPro } from "owncoding-ui";
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
    <div className="admin-root" id={ADMIN_ROOT_ID} data-theme="dark" data-oc-formularios="pro" suppressHydrationWarning>
      {/* Aplica tema y sidebar guardados (localStorage) antes del primer pintado. */}
      <script dangerouslySetInnerHTML={{ __html: ADMIN_BOOT_SCRIPT }} />
      {/* «Formularios pro» de owncoding-ui: el atributo de arriba activa el CSS
          (también para los diálogos, que se montan dentro de `.admin-root`) y el
          contexto activa el movimiento de Checkbox, Switch y SegmentedField. */}
      <FormulariosPro contenedor={false}>{children}</FormulariosPro>
    </div>
  );
}
