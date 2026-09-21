import { Resend } from "resend";
import { publicConfig } from "@/lib/public-config";
import { authConfig, requireEnv } from "./config";

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resend = new Resend(requireEnv("RESEND_API_KEY"));
  const appUrl = publicConfig.adminUrl;
  const result = await resend.emails.send({
    from: authConfig.resetSender,
    to,
    subject: "Restablecé tu contraseña de LedBox",
    html: `<p>Solicitaste restablecer tu contraseña de LedBox.</p><p><a href="${appUrl}/reset-password?token=${encodeURIComponent(token)}">Restablecer contraseña</a></p><p>El enlace vence en 30 minutos.</p>`,
  });
  if (result.error) throw new Error("Password reset email could not be sent");
}
