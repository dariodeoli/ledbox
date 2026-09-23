import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminOfflineProvider } from "@/components/admin/AdminOffline";
import { AdminShell } from "@/components/admin/AdminShell";
import { hostnameOf, publicConfig } from "@/lib/public-config";
import { getAuthenticatedAdmin } from "@/lib/server/auth";

/**
 * Layout del panel.
 *
 * En el **host de la demo**, un visitante sin sesión entra a la demo (se crea la
 * sesión demo) en vez de caer al login. La decisión se toma en el servidor,
 * antes de que el cliente pida nada, así funciona igual en la entrada
 * (`demo.ledbox.online` → `/demo`) y en un link profundo compartido
 * (`demo.ledbox.online/finanzas`), sin carrera con los módulos (bug del
 * 22-09-2026: el visitante terminaba en el login).
 */
export default async function AdminPanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuthenticatedAdmin();
  const requestHeaders = await headers();
  const host = (requestHeaders.get("host") || "").split(":")[0].toLowerCase();
  const onDemoHost = Boolean(host && host === hostnameOf(publicConfig.demoUrl));
  if (!auth && onDemoHost) {
    const pathname = requestHeaders.get("x-pathname") || "/demo";
    redirect(`/api/demo/session?next=${encodeURIComponent(pathname)}`);
  }
  return (
    <AdminOfflineProvider>
      <AdminShell demoHost={onDemoHost}>{children}</AdminShell>
    </AdminOfflineProvider>
  );
}
