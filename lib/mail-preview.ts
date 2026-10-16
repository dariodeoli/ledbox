/**
 * Correo que una sandbox de la demo «simuló» (docs/DEMO-INTERACTIVA.md §3): no salió nada, pero el panel
 * muestra cómo se vería. Es el mismo contenido que se iba a enviar (asunto, HTML y texto).
 */
export type SimulatedMail = Pick<MailPreview, "from" | "to" | "subject" | "html" | "text">;

/** Texto único de la demo cuando un correo se simula (panel y respuestas del API). */
export const SIMULATED_MAIL_NOTICE = "Demo: el correo se simuló, así se vería";
/** Texto de los accesos al catálogo público (mayorista, tienda web) que una sandbox no tiene. */
export const SANDBOX_UNAVAILABLE = "No disponible en la demo";
/** Ídem para WhatsApp: en la demo no se abre wa.me. */
export const SIMULATED_WHATSAPP_NOTICE = "Así se vería el mensaje";
export const MAIL_UNCERTAIN_PREFIX = "Resultado no confirmado: ";
export const uncertainMailError = (value: string | null | undefined) => Boolean(value?.startsWith(MAIL_UNCERTAIN_PREFIX));

/** Payload real generado por el servidor; el navegador no aporta HTML al envío. */
export type MailPreview = {
  status: "preview";
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  confirmationToken: string;
  /** Recibo del intento, sin JWT ni datos del correo; sólo consumidores con recibo durable. */
  attemptId?: string;
  expiresAt: string;
};
