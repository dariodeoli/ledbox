import { normalizePhone } from "@/lib/field-rules";
import { publicConfig, whatsappUrl } from "@/lib/public-config";

/** Contacto de ayuda de la plataforma para códigos inexistentes; no datos de un cliente. */
export function PortalSupportLink() {
  const label = normalizePhone(`+${publicConfig.whatsappNumber.replace(/\D/g, "")}`) || "WhatsApp";
  const href = whatsappUrl("Hola, necesito ayuda con un enlace del portal de LedBox.");
  return href ? <a className="portal-link" href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>;
}
