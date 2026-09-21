import type { Metadata } from "next";
import { AdminInvitationForm, AdminInvitationMissing } from "@/components/admin/AdminInvitationForm";
import { findInvitationByToken, invitationPublicView } from "@/lib/server/invitations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invitación al panel",
  description: "Aceptá la invitación para sumarte al equipo de una empresa en el panel de LedBox.",
  robots: { index: false, follow: false },
};

/**
 * Página pública de aceptación de una invitación al equipo (issue #31).
 *
 * Vive en el host del panel (`admin.ledbox.online/invitacion/<token>`, sin
 * prefijo `/admin` como el resto de las rutas del panel) y **no** está dentro de
 * `(panel)`: no pide sesión. El link lo arma `invitationAcceptUrl` con el host
 * `NEXT_PUBLIC_ADMIN_URL`, así la invitación vive donde vive el panel y el botón
 * de Google vuelve al mismo origen. Se suma a `lib/admin-routes.ts` para que el
 * host público la redirija al subdominio del panel.
 */
export default async function InvitationAcceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const invitation = await findInvitationByToken(token);
  if (!invitation) return <AdminInvitationMissing />;
  const view = await invitationPublicView(invitation);
  return <AdminInvitationForm token={token} view={view} errorParam={error ?? ""} />;
}
