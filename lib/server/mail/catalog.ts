import { formatDayKey } from "@/lib/catalog-public";
import { dayKeyOf } from "../notifications";
import { renderMail, renderMailText, type MailBrand, type MailContent, type MailRow } from "./template";

/**
 * Correos del catálogo de la empresa: acceso aprobado, pedido rechazado y propuesta
 * modificada. Usan la plantilla única y llevan solo el color y el logo de la empresa.
 */

export type CatalogMail = { subject: string; html: string; text: string };

function build(subject: string, content: MailContent): CatalogMail {
  return { subject, html: renderMail(content), text: renderMailText(content) };
}

export function buildAccessApprovedMail(input: { organizationName: string; name: string; url: string; kind: "RETAIL" | "WHOLESALE"; brand?: MailBrand | null }): CatalogMail {
  const wholesale = input.kind === "WHOLESALE";
  return build(`Tu acceso al catálogo de ${input.organizationName}`, {
    title: `Ya podés entrar al catálogo de ${input.organizationName}`,
    intro: [
      `Hola ${input.name},`,
      `${input.organizationName} aprobó tu solicitud. Con este enlace entrás a ${wholesale ? "el catálogo mayorista con tus precios" : "el catálogo"} y hacés tu pedido.`,
      "El enlace es personal: no lo compartas.",
    ],
    cta: { label: "Abrir el catálogo", url: input.url },
    note: "Un pedido no es una reserva hasta que la empresa lo confirma.",
    preheader: `${input.organizationName} aprobó tu acceso al catálogo`,
    eyebrow: "Acceso al catálogo",
    status: { label: "Aprobado", tone: "success" },
    organization: input.organizationName,
    reason: `pediste acceso al catálogo de ${input.organizationName}`,
    brand: input.brand ?? null,
  });
}

export function buildOrderRejectedMail(input: { organizationName: string; name: string; reason: string; trackingUrl: string; brand?: MailBrand | null }): CatalogMail {
  return build(`Sobre tu pedido en ${input.organizationName}`, {
    title: "No pudimos atender tu pedido",
    intro: [`Hola ${input.name},`, `${input.organizationName} no pudo atender tu pedido. Este es el motivo que nos dejaron:`, input.reason],
    cta: { label: "Ver mi pedido", url: input.trackingUrl },
    note: "Podés escribirnos para buscar una alternativa. Tu pedido no llegó a ser una reserva.",
    preheader: `${input.organizationName} no pudo atender tu pedido`,
    eyebrow: "Tu pedido",
    status: { label: "No atendido", tone: "warning" },
    organization: input.organizationName,
    reason: `hiciste un pedido en el catálogo de ${input.organizationName}`,
    brand: input.brand ?? null,
  });
}

export function buildOrderProposalMail(input: {
  organizationName: string;
  name: string;
  trackingUrl: string;
  note: string | null;
  changes: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  brand?: MailBrand | null;
}): CatalogMail {
  const rows: MailRow[] = input.changes.slice(0, 12).map((change) => ({ label: "Cambio", value: change }));
  if (input.startsAt && input.endsAt) rows.push({ label: "Fechas", value: `${formatDayKey(dayKeyOf(input.startsAt))} al ${formatDayKey(dayKeyOf(input.endsAt))}` });
  return build(`Propuesta para tu pedido en ${input.organizationName}`, {
    title: "Te enviamos una propuesta para tu pedido",
    intro: [
      `Hola ${input.name},`,
      `${input.organizationName} revisó tu pedido y te propone una versión ajustada a lo que tiene disponible.`,
      ...(input.note ? [input.note] : []),
      "Revisala y aprobala desde el seguimiento de tu pedido. Todavía no es una reserva confirmada.",
    ],
    rows,
    cta: { label: "Revisar y aprobar", url: input.trackingUrl },
    preheader: `${input.organizationName} te propone una versión de tu pedido`,
    eyebrow: "Tu pedido",
    status: { label: "Esperando tu aprobación", tone: "accent" },
    organization: input.organizationName,
    reason: `hiciste un pedido en el catálogo de ${input.organizationName}`,
    brand: input.brand ?? null,
  });
}
