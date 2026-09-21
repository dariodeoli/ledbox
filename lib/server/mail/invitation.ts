import { adminRoleLabel } from "@/lib/admin-format";
import { invitationAcceptUrl } from "@/lib/public-config";
import { renderMail, renderMailText, type MailContent, type MailRow } from "./template";

/**
 * Correo «Invitación al equipo» (issue #31): el link público de aceptación es la
 * única credencial que viaja. Usa la plantilla única (`renderMail`) con el rol
 * invitado, la empresa y quién invita —los mismos datos que muestra la página de
 * aceptación y la lista del panel— para que el correo no invente nada.
 *
 * El token plano lo genera `lib/server/invitations.ts`; acá solo se arma el
 * contenido (asunto, HTML y texto), y el envío lo registra `sendMail`.
 */

export type InvitationMailInput = {
  /** Empresa a la que se suma la persona. */
  organizationName: string;
  email: string;
  role: string;
  /** Nombre de quien invita (el correo no expone su dirección). */
  invitedByName: string;
  token: string;
  expiresAt: Date;
  /** `true` cuando el Equipo reenvía la invitación. */
  resend?: boolean;
};

export type InvitationMailContent = {
  subject: string;
  html: string;
  text: string;
  url: string;
};

function formatExpiry(value: Date): string {
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value);
}

export function buildInvitationMail(input: InvitationMailInput): InvitationMailContent {
  const url = invitationAcceptUrl(input.token);
  const expiry = formatExpiry(input.expiresAt);
  const role = adminRoleLabel(input.role);
  const subject = `Invitación al equipo de ${input.organizationName} · LedBox`;

  const rows: MailRow[] = [
    { label: "Empresa", value: input.organizationName, strong: true },
    { label: "Rol", value: role },
    { label: "Invita", value: input.invitedByName },
    { label: "Vence", value: expiry },
  ];

  const content: MailContent = {
    title: input.resend ? `Tu invitación sigue abierta` : `Te invitaron al panel de ${input.organizationName}`,
    intro: [
      `Hola:`,
      input.resend
        ? `${input.invitedByName} te reenvió la invitación para sumarte al equipo de ${input.organizationName} en el panel de LedBox.`
        : `${input.invitedByName} te invitó a sumarte al equipo de ${input.organizationName} en el panel de LedBox.`,
      `Vas a entrar con el rol ${role}. El link de abajo es personal: elegí tu contraseña (o entrá con Google si ya usás esa cuenta) y quedás dentro.`,
    ],
    rows,
    cta: { label: "Aceptar la invitación", url, note: `El link vence el ${expiry}.` },
    note: "Si no esperabas esta invitación, ignorá este correo: sin aceptar no se crea ningún acceso.",
    preheader: `${input.organizationName} · rol ${role} · vence el ${expiry}`,
    organization: input.organizationName,
    reason: `te invitamos a sumarte al equipo de ${input.organizationName}`,
  };

  return { subject, html: renderMail(content), text: renderMailText(content), url };
}
