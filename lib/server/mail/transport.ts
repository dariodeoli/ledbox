import { Resend } from "resend";
import { authConfig, requireEnv } from "../config";

/**
 * Transporte de correo: Resend como único proveedor de la app.
 *
 * `EMAIL_FROM` manda si está definido; si no, el remitente de recuperación
 * (`authConfig.resetSender`, `LedBox <ledbox@weem.com.py>`) es el default de
 * todos los correos. `RESEND_BASE_URL` (opcional) apunta el SDK a un mock local
 * al probar el circuito; en producción va sin definir y el SDK usa su API real.
 * Sin `RESEND_API_KEY` no se intenta ningún envío: el llamador lo verifica con
 * `emailConfigured()` y explica qué configurar.
 */

/** Remitente de todos los correos de la app. */
export function appEmailSender(): string {
  return process.env.EMAIL_FROM?.trim() || authConfig.resetSender;
}

/** ¿Está configurado el proveedor de correo? (sin clave no se manda nada) */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Qué configurar cuando falta la clave (texto único para el panel y la API). */
export function missingApiKeyMessage(): string {
  return "Falta RESEND_API_KEY en el entorno del backend: cargá la clave del proveedor (Resend) para habilitar los envíos.";
}

function resendClient(): Resend {
  const key = requireEnv("RESEND_API_KEY");
  const baseUrl = process.env.RESEND_BASE_URL?.trim();
  return baseUrl ? new Resend(key, { baseUrl }) : new Resend(key);
}

export type ProviderMailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type ProviderMailOutcome = {
  /** Id del mensaje en el proveedor (verificación de entrega). */
  providerId: string | null;
  /** Mensaje del proveedor si rechazó el envío. */
  error: string | null;
};

/** Motivo del rechazo del proveedor, en una línea legible. */
function providerErrorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "El proveedor rechazó el envío.";
}

/**
 * Envía por Resend. **No lanza**: devuelve el error del proveedor para que el
 * llamador lo registre y lo muestre tal cual (verificación de envío honesta).
 */
export async function sendThroughProvider(payload: ProviderMailPayload): Promise<ProviderMailOutcome> {
  try {
    const resend = resendClient();
    const result = await resend.emails.send({
      from: appEmailSender(),
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      ...(payload.text ? { text: payload.text } : {}),
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    });
    if (result.error) return { providerId: null, error: providerErrorMessage(result.error) };
    return { providerId: result.data?.id ?? null, error: null };
  } catch (error) {
    return { providerId: null, error: providerErrorMessage(error) };
  }
}
