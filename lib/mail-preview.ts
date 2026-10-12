/** Payload real generado por el servidor; el navegador no aporta HTML al envío. */
export type MailPreview = {
  status: "preview";
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  confirmationToken: string;
  expiresAt: string;
};
