import { formatDate, formatDateTime } from "@/lib/admin-format";
import { renderMail, renderMailText, type MailBrand, type MailContent } from "./template";

/**
 * Correos del portal de firma (issue #79): la solicitud al cliente con el link
 * y el código, el aviso de finalización con el identificador y el código OTP.
 * Usan la plantilla única (`template.ts`) y la categoría `signature` del
 * historial de correo; el envío lo hace `sendMail`.
 */

export type SignatureRequestMailInput = {
  organizationName: string;
  /** Marca de la empresa para el encabezado y el pie (`mailIdentityFor`); sin ella, solo el nombre. */
  brand?: MailBrand | null;
  title: string;
  recipientName: string;
  senderName: string;
  code: string;
  portalUrl: string;
  expiresAt: Date;
  methodLabel: string;
  /** Mensaje corto escrito por el equipo (opcional). */
  message?: string | null;
};

export type SignatureRequestMailContent = { subject: string; html: string; text: string };

const MAX_MESSAGE = 600;

function clientLabel(name: string): string {
  return name.trim() || "hola";
}

/** Correo de solicitud: link, código, vencimiento y método de firma. */
export function buildSignatureRequestMail(input: SignatureRequestMailInput): SignatureRequestMailContent {
  const message = (input.message ?? "").trim().slice(0, MAX_MESSAGE);
  const subject = `Firma pendiente · ${input.title}`;
  const content: MailContent = {
    title: `Te pedimos firmar · ${input.title}`,
    intro: [
      `Hola ${clientLabel(input.recipientName)},`,
      `${input.senderName} de ${input.organizationName} te envía una solicitud para firmar «${input.title}» electrónicamente.`,
      ...(message ? [message] : []),
    ],
    rows: [
      { label: "Documento", value: input.title, strong: true },
      { label: "Código de la solicitud", value: input.code, strong: true },
      { label: "Método de firma", value: input.methodLabel },
      { label: "Vence", value: formatDate(input.expiresAt) },
    ],
    cta: { label: "Revisar y firmar", url: input.portalUrl },
    note: [
      "El código de arriba es personal: no lo compartas con nadie.",
      "Vas a poder leer el documento completo antes de firmar y descargar la auditoría del proceso.",
    ],
    preheader: `${input.title} · vence el ${formatDate(input.expiresAt)} · código ${input.code}`,
    eyebrow: "Firma de documentos",
    status: { label: "Requiere tu firma", tone: "accent" },
    organization: input.organizationName,
    brand: input.brand ?? null,
    reason: `te pedimos firmar el documento «${input.title}»`,
  };
  return { subject, html: renderMail(content), text: renderMailText(content) };
}

export type SignatureCompletedMailInput = {
  organizationName: string;
  /** Marca de la empresa para el encabezado y el pie (`mailIdentityFor`); sin ella, solo el nombre. */
  brand?: MailBrand | null;
  title: string;
  recipientName: string;
  code: string;
  identifier: string;
  signedAt: Date;
};

/** Correo de finalización: el documento quedó firmado y validado. */
export function buildSignatureCompletedMail(input: SignatureCompletedMailInput): SignatureRequestMailContent {
  const subject = `Documento firmado · ${input.title}`;
  const content: MailContent = {
    title: `Documento firmado correctamente · ${input.title}`,
    intro: [
      `Hola ${clientLabel(input.recipientName)},`,
      `Registramos tu firma de «${input.title}» y validamos el documento. Guardá este correo como constancia.`,
    ],
    rows: [
      { label: "Documento", value: input.title, strong: true },
      { label: "Identificador de firma", value: input.identifier, strong: true },
      { label: "Fecha y hora", value: formatDateTime(input.signedAt) },
      { label: "Código de la solicitud", value: input.code },
    ],
    note: "La auditoría completa del proceso (eventos, huellas y evidencias) está disponible desde el mismo enlace de firma.",
    preheader: `Identificador ${input.identifier}`,
    eyebrow: "Firma de documentos",
    status: { label: "Firmado y validado", tone: "success" },
    organization: input.organizationName,
    brand: input.brand ?? null,
    reason: `firmaste el documento «${input.title}»`,
  };
  return { subject, html: renderMail(content), text: renderMailText(content) };
}

export type SignatureReminderMailInput = {
  organizationName: string;
  /** Marca de la empresa para el encabezado y el pie (`mailIdentityFor`); sin ella, solo el nombre. */
  brand?: MailBrand | null;
  title: string;
  recipientName: string;
  senderName: string;
  code: string;
  portalUrl: string;
  expiresAt: Date;
  /** Días de Asunción que faltan para el vencimiento (0 = hoy). */
  daysLeft: number;
  methodLabel: string;
};

/** Texto del vencimiento en lenguaje del cliente: "vence hoy", "vence en 3 días". */
export function signatureDueText(daysLeft: number): string {
  if (daysLeft <= 0) return "vence hoy";
  if (daysLeft === 1) return "vence mañana";
  return `vence en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`;
}

/**
 * Recordatorio de vencimiento (issue #81): el cliente ya recibió la solicitud y
 * todavía no firmó. Lleva el link, el código, el vencimiento y cuánto falta; el
 * asunto lo distingue del aviso original.
 */
export function buildSignatureReminderMail(input: SignatureReminderMailInput): SignatureRequestMailContent {
  const dueText = signatureDueText(input.daysLeft);
  const subject = `Recordatorio · falta firmar «${input.title}» · ${dueText}`;
  const content: MailContent = {
    title: `Recordatorio · ${dueText === "vence hoy" ? "firma hoy" : "tu firma sigue pendiente"}`,
    intro: [
      `Hola ${clientLabel(input.recipientName)},`,
      `${input.senderName} de ${input.organizationName} te recuerda que falta firmar «${input.title}»: el enlace ${dueText}.`,
    ],
    rows: [
      { label: "Documento", value: input.title, strong: true },
      { label: "Vencimiento", value: `${formatDate(input.expiresAt)} · ${dueText}`, strong: true },
      { label: "Código de la solicitud", value: input.code },
      { label: "Método de firma", value: input.methodLabel },
    ],
    cta: { label: "Firmar ahora", url: input.portalUrl },
    note: "Si ya firmaste, ignorá este mensaje: la solicitud queda registrada con fecha y hora.",
    preheader: `${dueText} · ${input.title} · código ${input.code}`,
    eyebrow: "Firma de documentos",
    status: { label: "Firma pendiente", tone: "warning" },
    organization: input.organizationName,
    brand: input.brand ?? null,
    reason: `te recordamos firmar el documento «${input.title}»`,
  };
  return { subject, html: renderMail(content), text: renderMailText(content) };
}

export type SignatureOtpMailInput = {
  organizationName: string;
  /** Marca de la empresa para el encabezado y el pie (`mailIdentityFor`); sin ella, solo el nombre. */
  brand?: MailBrand | null;
  title: string;
  code: string;
  expiresInMinutes: number;
};

/** Código de verificación (OTP por correo) para habilitar la firma. */
export function buildSignatureOtpMail(input: SignatureOtpMailInput): SignatureRequestMailContent {
  const subject = `Código de verificación · ${input.title}`;
  const content: MailContent = {
    title: "Tu código de verificación",
    intro: [
      `Para firmar «${input.title}» en ${input.organizationName} ingresá este código en el portal de firma.`,
    ],
    rows: [
      { label: "Código", value: input.code, strong: true },
      { label: "Vence", value: `en ${input.expiresInMinutes} minutos` },
    ],
    note: "Si no pediste este código, ignorá el correo: nadie puede firmar sin vos.",
    preheader: `Código ${input.code}`,
    eyebrow: "Firma de documentos",
    organization: input.organizationName,
    brand: input.brand ?? null,
    reason: `pediste el código para firmar «${input.title}»`,
  };
  return { subject, html: renderMail(content), text: renderMailText(content) };
}
