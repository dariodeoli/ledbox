import type { Metadata } from "next";
import { FormulariosPro } from "owncoding-ui";
import { ADMIN_BOOT_SCRIPT, ADMIN_ROOT_ID } from "@/lib/admin-theme";
import { requirePlatformAdmin } from "@/lib/platform/guard";

// Cada request pasa por el guard: nada de este panel se cachea ni se prerenderiza.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plataforma",
  description: "Panel de plataforma de LedBox.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SuperadminRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requirePlatformAdmin();
  return (
    <div className="admin-root" id={ADMIN_ROOT_ID} data-theme="dark" data-oc-formularios="pro" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: ADMIN_BOOT_SCRIPT }} />
      <FormulariosPro contenedor={false}>{children}</FormulariosPro>
    </div>
  );
}
