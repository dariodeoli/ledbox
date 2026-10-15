import { StoreHeaderControls } from "./StoreHeaderControls";
import { StoreLogo } from "./StoreLogo";

/**
 * Encabezado único de la tienda pública (portada, ficha, acceso, mayorista y seguimiento).
 * A la izquierda el sello «EventOS» (isotipo chico), un separador fino y el logo y nombre de la
 * empresa; luego la navegación, el carrito con contador y, en móvil, un menú compacto. Todo con los
 * tokens de la plantilla (`--cp-*`). Componente de servidor; la parte interactiva está en StoreHeaderControls.
 */
export type StoreNavLink = { href: string; label: string };

export function storeNavLinks(basePath: string, options: { contact: boolean }): StoreNavLink[] {
  return [
    { href: `${basePath}#catalogo`, label: "Catálogo" },
    { href: `${basePath}#como-funciona`, label: "Cómo funciona" },
    ...(options.contact ? [{ href: `${basePath}#contacto`, label: "Contacto" }] : []),
  ];
}

export function StoreHeader({ name, slug, logos, homeHref, nav, cart }: {
  name: string;
  slug: string;
  logos?: { light: boolean; dark: boolean };
  homeHref: string;
  nav: StoreNavLink[];
  /** `button`: abre el pedido de esta página; `{ href }`: lleva al catálogo; `null`: sin carrito. */
  cart: "button" | { href: string } | null;
}) {
  const hasLogo = Boolean(logos && (logos.light || logos.dark));
  return (
    <header className="cp-nav cp-hd">
      <div className="cp-nav-inner cp-hd-inner">
        <div className="cp-hd-id">
          <span className="cp-eventos-stamp" aria-label="EventOS">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/eventos-mark.png" width={22} height={22} alt="" />
            <span>EventOS</span>
          </span>
          <span className="cp-hd-sep" aria-hidden="true" />
          <a className={hasLogo ? "cp-brand cp-brand--logo cp-hd-brand" : "cp-brand cp-hd-brand"} href={homeHref} aria-label={`Inicio de ${name}`}>
            <StoreLogo name={name} slug={slug} logos={logos} />
            <span className="cp-brand-name">{name}</span>
          </a>
        </div>
        <StoreHeaderControls nav={nav} cart={cart} />
      </div>
    </header>
  );
}
