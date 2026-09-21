import { Resend } from "resend";
import { publicConfig } from "@/lib/public-config";
import { authConfig, requireEnv } from "./config";

/**
 * Envío de correo por Resend: fuente única de la app.
 *
 * `RESEND_BASE_URL` (opcional) permite apuntar el SDK a un mock local al probar
 * el circuito de recordatorios; en producción va sin definir y el SDK usa su
 * API real. Ningún envío se intenta sin `RESEND_API_KEY`: los llamadores lo
 * verifican antes y omiten el trabajo con un log claro.
 */

/** Remitente de los correos de la app (el de recuperación y el de recordatorios). */
export function appEmailSender(): string {
  return process.env.EMAIL_FROM?.trim() || authConfig.resetSender;
}

/** ¿Está configurado el proveedor de correo? (sin clave no se manda nada) */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function resendClient(): Resend {
  const key = requireEnv("RESEND_API_KEY");
  const baseUrl = process.env.RESEND_BASE_URL?.trim();
  return baseUrl ? new Resend(key, { baseUrl }) : new Resend(key);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resend = resendClient();
  const appUrl = publicConfig.adminUrl;
  const result = await resend.emails.send({
    from: appEmailSender(),
    to,
    subject: "Restablecé tu contraseña de LedBox",
    html: `<p>Solicitaste restablecer tu contraseña de LedBox.</p><p><a href="${appUrl}/reset-password?token=${encodeURIComponent(token)}">Restablecer contraseña</a></p><p>El enlace vence en 30 minutos.</p>`,
  });
  if (result.error) throw new Error("Password reset email could not be sent");
}

export type ReminderEmailPayload = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Recordatorio de cobro al cliente (issue #19). Devuelve el id del proveedor y
 * lanza si Resend rechaza el envío: el llamador decide cómo registrarlo.
 */
export async function sendReminderEmail(payload: ReminderEmailPayload): Promise<void> {
  const resend = resendClient();
  const result = await resend.emails.send({
    from: appEmailSender(),
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
  if (result.error) {
    const message = typeof result.error === "object" && result.error && "message" in result.error
      ? String((result.error as { message?: unknown }).message ?? "")
      : "";
    throw new Error(message ? `Resend: ${message}` : "Reminder email could not be sent");
  }
}
