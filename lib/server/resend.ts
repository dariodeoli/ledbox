import { db } from "./db";
import { publicConfig } from "@/lib/public-config";
import { normalizeEmail } from "@/lib/field-rules";
import { appEmailSender, emailConfigured, renderMail, renderMailText, sendMail } from "./mail";

/**
 * Correos de la app: fachada sobre `lib/server/mail/**` (plantilla única +
 * `sendMail` con historial). Acá viven los correos concretos que ya existían
 * —reset de contraseña y recordatorio de cobro— con **su contrato y sus textos
 * clave intactos**; el envío, el remitente y la verificación son compartidos.
 */

export { appEmailSender, emailConfigured };

/**
 * Empresa visible en el pie y en el historial del reset: la primera membresía
 * activa del usuario (el reset es de la cuenta, no de una empresa puntual; sin
 * membresía queda sin empresa y fuera del historial de las empresas).
 */
async function resetOwnerOrganization(email: string): Promise<{ id: string; name: string } | null> {
  const user = await db.adminUser.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true } });
  if (!user) return null;
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: user.id, active: true, organization: { active: true } },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { id: true, name: true } } },
  });
  return membership?.organization ?? null;
}

/** Reset de contraseña (mismos textos clave; plantilla única e historial). */
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${publicConfig.adminUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const organization = await resetOwnerOrganization(to);
  const content = {
    title: "Restablecé tu contraseña",
    intro: "Solicitaste restablecer tu contraseña de LedBox.",
    cta: { label: "Restablecer contraseña", url },
    note: "El enlace vence en 30 minutos. Si no fuiste vos, ignorá este mensaje.",
    preheader: "El enlace vence en 30 minutos.",
    organization: organization?.name ?? null,
    reason: "solicitaste restablecer tu contraseña de LedBox",
  };
  const result = await sendMail({
    to,
    subject: "Restablecé tu contraseña de LedBox",
    category: "reset",
    html: renderMail(content),
    text: renderMailText(content),
    organizationId: organization?.id ?? null,
  });
  if (result.status === "failed") throw new Error(result.error ?? "Password reset email could not be sent");
}

export type ReminderEmailPayload = {
  to: string;
  subject: string;
  html: string;
  /** Alternativa en texto plano del mismo correo. */
  text?: string;
  /** Empresa activa y cobro recordado: contexto del historial de correos. */
  organizationId?: string | null;
  paymentId?: string | null;
  actor?: { id?: string | null; name?: string | null; email?: string | null } | null;
};

/**
 * Recordatorio de cobro al cliente (issue #19). Mantiene el contrato: devuelve
 * el id del proveedor implícito en el historial y lanza si Resend rechaza el
 * envío, para que el llamador lo registre en `PaymentReminderLog`.
 */
export async function sendReminderEmail(payload: ReminderEmailPayload): Promise<void> {
  const result = await sendMail({
    to: payload.to,
    subject: payload.subject,
    category: "reminder",
    html: payload.html,
    text: payload.text,
    organizationId: payload.organizationId ?? null,
    entity: payload.paymentId ? "ClientPayment" : null,
    entityId: payload.paymentId ?? null,
    actor: payload.actor ?? null,
  });
  if (result.status === "failed") throw new Error(result.error ? `Resend: ${result.error}` : "Reminder email could not be sent");
  if (result.status === "skipped") throw new Error(result.error ?? "Reminder email could not be sent");
}
