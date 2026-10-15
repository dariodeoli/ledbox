import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import { publicConfig } from "@/lib/public-config";
import { acceptedPaymentMethods, hoursSummary, locationLine, type OrgProfile } from "@/lib/org-profile";
import { APP_VERSION } from "@/lib/version";
import type { StoreNavLink } from "./StoreHeader";

/**
 * Pie único y completo de la tienda pública (portada, ficha, acceso, mayorista y seguimiento): marca y frase, catálogo,
 * contacto, horarios, zonas de entrega y medios de pago (solo lo que la empresa cargó: nada se inventa), términos y, al
 * final, el crédito «Desarrollado por OwnCoding · EventOS v<versión>» (la de package.json, la misma que informa
 * /api/health). Fondo `--color-ink` del tema. Componente de servidor.
 */
export type StoreFooterLink = { href: string; label: string; external?: boolean };

/** Enlaces del pie: los mismos del encabezado más la privacidad de EventOS. */
export function storeFooterLinks(nav: StoreNavLink[]): StoreFooterLink[] {
  return [...nav, { href: `${publicConfig.productUrl}/privacidad`, label: "Privacidad" }];
}

/** Línea inferior: «Desarrollado por OwnCoding · EventOS v<versión>». */
export const STORE_CREDIT_TEXT = `Desarrollado por OwnCoding · EventOS v${APP_VERSION}`;

export function StoreFooter({ name, tagline, location, whatsappUrl, email, links, profile = null, zones = [], categories = [] }: {
  name: string;
  tagline?: string | null;
  location?: string | null;
  whatsappUrl?: string | null;
  email?: string | null;
  links: StoreFooterLink[];
  profile?: OrgProfile | null;
  /** Nombres de las zonas de entrega que la empresa configuró. */
  zones?: string[];
  /** Categorías para la columna «Catálogo»: nombre y enlace. */
  categories?: Array<{ name: string; href: string }>;
}) {
  const place = location ?? (profile ? locationLine(profile) : null);
  const hours = profile ? hoursSummary(profile.hours) : [];
  const methods = profile ? acceptedPaymentMethods(profile) : [];
  const phones = profile ? [profile.contact.phone, profile.contact.phone2].filter((phone): phone is string => Boolean(phone)) : [];
  const mail = email ?? profile?.contact.email ?? null;
  const instagram = profile?.contact.instagram ?? null;
  const hasContact = Boolean(whatsappUrl || phones.length > 0 || mail || instagram);
  return (
    <footer className="cp-footer" data-testid="store-footer">
      <div className="cp-footer-inner">
        <div className="cp-footer-col">
          <p className="cp-footer-name">{name}</p>
          {tagline ? <p className="cp-footer-tag">{tagline}</p> : null}
          {place ? <p className="cp-footer-text">{place}</p> : null}
          {zones.length > 0 ? <p className="cp-footer-text"><strong>Entregas:</strong> {zones.join(", ")}</p> : null}
          {methods.length > 0 ? <p className="cp-footer-text"><strong>Medios de pago:</strong> {methods.join(", ")}</p> : null}
        </div>
        <nav className="cp-footer-col" aria-label="Catálogo">
          <h2>Catálogo</h2>
          {links.find((link) => link.label === "Catálogo") ? <a href={links.find((link) => link.label === "Catálogo")!.href}>Ver todos los productos</a> : null}
          {categories.slice(0, 6).map((category) => <a key={category.name} href={category.href}>{category.name}</a>)}
        </nav>
        <div className="cp-footer-col">
          <h2>{hasContact ? "Contacto" : "Información"}</h2>
          {whatsappUrl ? <a className="cp-footer-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer"><WhatsappIcon size={18} />WhatsApp</a> : null}
          {phones.map((phone) => <a key={phone} href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a>)}
          {mail ? <a href={`mailto:${mail}`}>{mail}</a> : null}
          {instagram ? <a href={`https://instagram.com/${instagram}`} target="_blank" rel="noopener noreferrer">Instagram @{instagram}</a> : null}
          {hours.length > 0 ? <div className="cp-footer-hours" aria-label="Horarios de atención">{hours.map((line) => <div key={line.days}><span>{line.days}</span><span className="cp-nowrap">{line.text}</span></div>)}</div> : null}
          {!hasContact && hours.length === 0 ? <p className="cp-footer-text">Armá tu pedido y recibí una cotización antes de confirmar.</p> : null}
        </div>
      </div>
      <div className="cp-footer-legal">
        <p>Todas las imágenes son referenciales. Los precios son de referencia en guaraníes y se confirman en la cotización. Un pedido no es una reserva hasta que la confirmamos.</p>
        <nav aria-label="Enlaces de la tienda" className="cp-row">
          {links.map((link) => (
            <a key={link.label} href={link.href} {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{link.label}</a>
          ))}
        </nav>
        <p className="cp-footer-credit">
          Desarrollado por <a href="https://owncoding.dev" target="_blank" rel="noopener noreferrer">OwnCoding</a> · EventOS v{APP_VERSION}
        </p>
      </div>
    </footer>
  );
}

/** Botón flotante de WhatsApp de la tienda: uno solo, del color del tema; se sube sobre la barra del pedido y se oculta con un cajón abierto (ver `.cp-wa` en tienda.css). */
export function StoreWhatsappFloat({ href }: { href: string }) {
  return (
    <a className="cp-wa" href={href} target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">
      <WhatsappIcon size={26} />
    </a>
  );
}
