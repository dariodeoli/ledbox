import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { PANEL_HOME } from "@/lib/admin-routes";
import { authErrorMessage } from "@/lib/google-auth";
import { sesionDePanelDisponible } from "@/lib/server/admin-session";
import { safeLocalReturnTo } from "@/lib/local-return-to";

/** El login siempre mira la cookie: sin esta marca, Next lo pre-renderiza. */
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  // Con sesión ya iniciada no se muestra el formulario (issue #134): se va
  // directo al panel. Si la sesión está bloqueada por PIN, el shell dibuja el
  // desbloqueo (no se saltea el paso).
  if (await sesionDePanelDisponible()) redirect(PANEL_HOME);
  const { error, next: requestedNext } = await searchParams;
  const next = safeLocalReturnTo(requestedNext) ?? PANEL_HOME;
  // Los errores del flujo de Google llegan como código en la URL; el formulario
  // solo muestra el mensaje seguro (`lib/google-auth.ts`).
  return <AdminLoginForm googleError={authErrorMessage(error)} next={next} />;
}
