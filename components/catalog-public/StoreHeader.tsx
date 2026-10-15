import { StoreHeaderControls } from "./StoreHeaderControls";
import { StoreLogo } from "./StoreLogo";

/**
 * Encabezado único de la tienda pública (portada, ficha, acceso, mayorista y seguimiento), sticky y compacto. La identidad de la empresa ocupa el encabezado; el crédito del producto vive en el pie.
 * Al centro, catálogo y contacto; a la derecha la búsqueda y la
 * píldora «Pedido (N)». En móvil: menú y píldora solo con icono y contador. Todo con los tokens del tema.
 * Componente de servidor; la parte interactiva está en StoreHeaderControls.
 */
export type StoreNavLink = { href: string; label: string };

export function storeNavLinks(basePath: string, options: { contact: boolean; howItWorks?: boolean; categories?: ReadonlyArray<{ name: string; href: string }> }): StoreNavLink[] {
  return [
    { href: `${basePath}#catalogo`, label: "Catálogo" },
    ...(options.howItWorks === false ? [] : [{ href: `${basePath}#como-funciona`, label: "Cómo funciona" }]),
    ...(options.contact ? [{ href: `${basePath}#contacto`, label: "Contacto" }] : []),
  ];
}

export function StoreHeader({ name, slug, logos, homeHref, nav, cart, cartScope = "public", searchHref = null }: {
  name: string;
  slug: string;
  logos?: { light: boolean; dark: boolean };
  homeHref: string;
  nav: StoreNavLink[];
  /** `button`: abre el pedido de esta página; `{ href }`: lleva al catálogo; `null`: sin carrito. */
  cart: "button" | { href: string } | null;
  /** Tipo de acceso: separa el carrito guardado de cada tienda (el contador sale de ahí en la ficha). */
  cartScope?: "public" | "acceso" | "mayorista";
  /** Enlace del botón de búsqueda (lleva al buscador del catálogo); `null` = sin botón. */
  searchHref?: string | null;
}) {
  const hasLogo = Boolean(logos && (logos.light || logos.dark));
  return (
    <header className="cp-hd">
      <div className="cp-hd-inner">
        <div className="cp-hd-id">
          <a className={hasLogo ? "cp-brand cp-brand--logo cp-hd-brand" : "cp-brand cp-hd-brand"} href={homeHref} aria-label={`Inicio de ${name}`}>
            <StoreLogo name={name} slug={slug} logos={logos} />
            {!hasLogo ? <span className="cp-brand-name">{name}</span> : null}
          </a>
        </div>
        <StoreHeaderControls nav={nav.filter((link) => link.label !== "Cómo funciona")} cart={cart} slug={slug} cartScope={cartScope} searchHref={searchHref} />
      </div>
    </header>
  );
}
