"use server";

import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { normalizeAltaInput, type AltaFormState } from "@/lib/platform/alta-empresa";
import { createOrganizationWithOwnerInvite, overallMailStatus, resendInvitation } from "@/lib/platform/alta-empresa-server";
import { rateLimit } from "@/lib/server/rate-limit";

/** Altas y reenvíos por dueño en 15 minutos. Pasado el tope no se toca la base ni se manda correo. */
const ALTA_LIMIT = 10;
const RESEND_LIMIT = 10;

export async function crearEmpresaAction(_previous: AltaFormState, formData: FormData): Promise<AltaFormState> {
  const { userId, email } = await requirePlatformAdmin();
  const values = normalizeAltaInput({
    name: formData.get("name"),
    slug: formData.get("slug"),
    planCode: formData.get("planCode"),
    inviteeEmail: formData.getAll("inviteeEmail"),
    inviteeRole: formData.getAll("inviteeRole"),
  });
  const limit = await rateLimit(`superadmin:alta:${userId}`, ALTA_LIMIT);
  if (!limit.allowed) {
    return { error: "Demasiados intentos. Esperá unos minutos y volvé a probar.", fieldErrors: {}, values };
  }
  const result = await createOrganizationWithOwnerInvite(values, { userId, email });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors, values };
  // El resultado se muestra en el detalle de la empresa; el link nunca se devuelve (solo viaja por correo).
  redirect(`/superadmin/empresas?detalle=${encodeURIComponent(result.organizationId)}&alta=${overallMailStatus(result.invitations.map((invitation) => invitation.mail))}`);
}

export async function reenviarInvitacionAction(formData: FormData): Promise<void> {
  const { userId, email } = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  const back = `/superadmin/empresas?detalle=${encodeURIComponent(organizationId)}`;
  const limit = await rateLimit(`superadmin:reenviar:${userId}`, RESEND_LIMIT);
  if (!limit.allowed) redirect(`${back}&reenvio=limite`);
  const result = await resendInvitation({ organizationId, invitationId }, { userId, email });
  redirect(`${back}&reenvio=${result.ok ? result.mail.status : "error"}`);
}
