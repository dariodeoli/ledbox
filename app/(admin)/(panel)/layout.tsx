import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminOfflineProvider } from "@/components/admin/AdminOffline";
import { AdminShell } from "@/components/admin/AdminShell";
import { hostnameOf, publicConfig } from "@/lib/public-config";
import { getAuthenticatedAdmin } from "@/lib/server/auth";

/**
 * Layout del panel.
 *
 * Sin sesión no se dibuja nada: en el **host de la demo** (raíz servida con
 * rewrite a `/demo`, issue #53, o la ruta `/demo` en cualquier host) el visitante
 * entra a la demo (se crea la sesión demo) y en el panel real va al login. La
 * decisión se toma en el servidor, antes de que el cliente pida nada, así
 * funciona igual en la entrada y en un link profundo compartido
 * (`demo.ledbox.online/finanzas`), sin carrera con los módulos (bug del
 * 22-09-2026: el visitante terminaba en el login) y sin el parpadeo del shell
 * antes del login (issue #51).
 */
export default async function AdminPanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuthenticatedAdmin();
  const requestHeaders = await headers();
  const host = (requestHeaders.get("host") || "").split(":")[0].toLowerCase();
  const onDemoHost = Boolean(host && host === hostnameOf(publicConfig.demoUrl));
  const pathname = requestHeaders.get("x-pathname") || "";
  if (!auth) {
    // La entrada a la demo (host de la demo o la ruta `/demo`) crea la sesión de
    // visitante; el resto, sin sesión, va al login **antes** de dibujar el shell:
    // el cliente llegaba tarde y el panel se veía un instante (issue #51).
    if (onDemoHost || pathname === "/demo" || pathname.startsWith("/demo/")) {
      redirect(`/api/demo/session?next=${encodeURIComponent(pathname || "/demo")}`);
    }
    redirect("/login");
  }
  return (
    <AdminOfflineProvider>
      <AdminShell demoHost={onDemoHost}>{children}</AdminShell>
    </AdminOfflineProvider>
  );
}
