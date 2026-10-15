import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import { publicConfig } from "@/lib/public-config";
import { APP_VERSION } from "@/lib/version";
import type { StoreNavLink } from "./StoreHeader";

/**
 * Pie único de la tienda pública: se usa igual en portada, ficha, acceso, mayorista y seguimiento.
 * Datos breves de la empresa (solo lo que cargó), enlaces y una línea inferior con el crédito y la
 * versión de EventOS (la de package.json, la misma que informa /api/health). Componente de servidor.
 */
export type StoreFooterLink = { href: string; label: string; external?: boolean };

/** Enlaces del pie: los mismos del encabezado más la privacidad de EventOS. */
export function storeFooterLinks(nav: StoreNavLink[]): StoreFooterLink[] {
  return [...nav, { href: `${publicConfig.productUrl}/privacidad`, label: "Privacidad" }];
}

/** Línea inferior: «Desarrollado por OwnCoding · EventOS v<versión>». */
export const STORE_CREDIT_TEXT = `Desarrollado por OwnCoding · EventOS v${APP_VERSION}`;

export function StoreFooter({ name, tagline, location, whatsappUrl, email, links }: {
  name: string;
  tagline?: string | null;
  location?: string | null;
  whatsappUrl?: string | null;
  email?: string | null;
  links: StoreFooterLink[];
}) {
  return (
    <footer className="cp-footer" data-testid="store-footer">
      <div className="cp-footer-inner">
        <div className="cp-footer-about">
          <p className="cp-footer-name">{name}</p>
          {tagline ? <p className="cp-footer-text">{tagline}</p> : null}
          {location ? <p className="cp-footer-text">{location}</p> : null}
          {whatsappUrl ? <a className="cp-footer-text" href={whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
          {email ? <a className="cp-footer-text" href={`mailto:${email}`}>{email}</a> : null}
        </div>
        <nav className="cp-footer-links" aria-label="Enlaces de la tienda">
          {links.map((link) => (
            <a key={link.label} href={link.href} {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{link.label}</a>
          ))}
        </nav>
        <p className="cp-footer-note">Los precios son de referencia en guaraníes y se confirman en la cotización. Un pedido no es una reserva hasta que la confirmamos.</p>
      </div>
      <p className="cp-footer-credit">
        Desarrollado por <a href="https://owncoding.dev" target="_blank" rel="noopener noreferrer">OwnCoding</a> · EventOS v{APP_VERSION}
      </p>
    </footer>
  );
}

/** Botón flotante de WhatsApp de la tienda: se acomoda solo sobre la barra del pedido (ver `.cp-wa` en globals.css). */
export function StoreWhatsappFloat({ href }: { href: string }) {
  return (
    <a className="cp-wa" href={href} target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">
      <WhatsappIcon size={26} />
    </a>
  );
}
