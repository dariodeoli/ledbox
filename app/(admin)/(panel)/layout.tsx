import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminOfflineProvider } from "@/components/admin/AdminOffline";
import { AdminShell } from "@/components/admin/AdminShell";
import { hostnameOf, publicConfig } from "@/lib/public-config";
import type { AdminSessionPayload } from "@/lib/admin-types";
import { buildAdminSessionPayload } from "@/lib/server/admin-session";
import { getAuthenticatedAdmin } from "@/lib/server/auth";
import { requireAdminContext } from "@/lib/server/tenancy";

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
  // Mismo criterio de host que el middleware (`x-forwarded-host` primero): en el
  // paso interno del rewrite de la raíz (issue #53) Next reemplaza `host` por la
  // dirección del server, y sin esto el host de la demo se perdería y el
  // visitante caería al login en vez de entrar a la demo.
  const requestHost = (requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = requestHost.split(":")[0];
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

  /**
   * Sesión resuelta en el servidor (issue #61): el shell arranca con los datos,
   * así no dibuja el esqueleto de carga ni pide `/api/admin/session` al entrar
   * (menos pedidos fijos y sin salto de layout). Si esta carga falla, el shell
   * conserva su camino de cliente (fetch + esqueleto).
   */
  let initialSession: AdminSessionPayload | null = null;
  try {
    const context = await requireAdminContext(undefined, { allowLocked: true });
    if (context.ok) initialSession = await buildAdminSessionPayload(context.context);
  } catch {
    initialSession = null;
  }

  return (
    <AdminOfflineProvider>
      <AdminShell demoHost={onDemoHost} initialSession={initialSession}>
        {children}
      </AdminShell>
    </AdminOfflineProvider>
  );
}
