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
    { label: "Organización", value: input.organizationName, strong: true },
    { label: "Acceso", value: role },
    { label: "Invita", value: input.invitedByName },
    { label: "Vigencia", value: expiry },
  ];

  const content: MailContent = {
    title: input.resend ? `Tu invitación sigue abierta` : `Te invitaron al panel de ${input.organizationName}`,
    intro: [
      `Hola,`,
      input.resend
        ? `${input.invitedByName} volvió a enviarte la invitación para sumarte al equipo de ${input.organizationName} en EventOS.`
        : `${input.invitedByName} te invitó a sumarte al equipo de ${input.organizationName} en EventOS.`,
      `Vas a ingresar con el rol ${role}. El enlace es personal: elegí tu contraseña o continuá con Google si ya usás esa cuenta.`,
    ],
    rows,
    cta: { label: "Aceptar invitación", url, note: `El enlace vence el ${expiry}.` },
    note: "Si no esperabas esta invitación, podés ignorar este correo. No se crea ningún acceso sin aceptarla.",
    preheader: `${input.organizationName} · rol ${role} · vence el ${expiry}`,
    eyebrow: "Invitación · acceso al equipo",
    status: { label: "Acción requerida", tone: "accent" },
    organization: input.organizationName,
    reason: `te invitamos a sumarte al equipo de ${input.organizationName}`,
  };

  return { subject, html: renderMail(content), text: renderMailText(content), url };
}
