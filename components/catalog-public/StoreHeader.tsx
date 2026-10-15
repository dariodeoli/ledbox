import { StoreHeaderControls } from "./StoreHeaderControls";
import { StoreLogo } from "./StoreLogo";

/**
 * Encabezado único de la tienda pública (portada, ficha, acceso, mayorista y seguimiento), sticky: 80 px y se compacta a
 * 64 al hacer scroll. A la izquierda el sello «EventOS» chico (decisión del dueño), un separador fino y el logo y nombre de
 * la empresa; al centro la navegación (catálogo, categorías, cómo funciona, contacto); a la derecha la búsqueda y la
 * píldora «Pedido (N)». En móvil: menú y píldora solo con icono y contador. Todo con los tokens del tema.
 * Componente de servidor; la parte interactiva está en StoreHeaderControls.
 */
export type StoreNavLink = { href: string; label: string };

export function storeNavLinks(basePath: string, options: { contact: boolean; categories?: ReadonlyArray<{ name: string; href: string }> }): StoreNavLink[] {
  return [
    { href: `${basePath}#catalogo`, label: "Catálogo" },
    ...(options.categories ?? []).map((category) => ({ href: category.href, label: category.name })),
    { href: `${basePath}#como-funciona`, label: "Cómo funciona" },
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
          <span className="cp-eventos-stamp" aria-label="EventOS">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/eventos-mark.png" width={16} height={16} alt="" />
            <span>EventOS</span>
          </span>
          <span className="cp-hd-sep" aria-hidden="true" />
          <a className={hasLogo ? "cp-brand cp-brand--logo cp-hd-brand" : "cp-brand cp-hd-brand"} href={homeHref} aria-label={`Inicio de ${name}`}>
            <StoreLogo name={name} slug={slug} logos={logos} />
            <span className="cp-brand-name">{name}</span>
          </a>
        </div>
        <StoreHeaderControls nav={nav} cart={cart} slug={slug} cartScope={cartScope} searchHref={searchHref} />
      </div>
    </header>
  );
}
