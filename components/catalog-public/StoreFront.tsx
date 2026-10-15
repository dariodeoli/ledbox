import { PREORDER_RESPONSE_HOURS, preorderWhatsappUrl } from "@/lib/catalog-public";
import type { PublicCatalogItem, PublicStorefront } from "@/lib/server/catalog-public";
import { CatalogBrowser, type CatalogZoneView } from "./CatalogBrowser";
import { featuredCategories } from "@/lib/featured-categories";
import { CompanyInfo } from "./CompanyInfo";
import { locationLine } from "@/lib/org-profile";
import { StoreFooter, StoreWhatsappFloat, storeFooterLinks } from "./StoreFooter";
import { StoreHeader, storeNavLinks } from "./StoreHeader";
import { StoreChrome } from "./StoreChrome";

/**
 * Tienda web de una empresa (portada + catálogo). Componente de servidor: arma la
 * portada (logo, frase, categorías destacadas, cómo funciona y contacto) y monta el
 * catálogo interactivo. Sirve a la tienda pública y al catálogo mayorista: cambian
 * el encabezado, la lista de precios y el endpoint del pedido, nunca el diseño.
 */

type Props = {
  store: PublicStorefront;
  items: PublicCatalogItem[];
  showPrices: boolean;
  demo: boolean;
  range: { fromKey: string; toKey: string; days: number } | null;
  /** Zonas de flete de la empresa (sin precios si la tienda no los muestra). */
  zones?: CatalogZoneView[];
  initialCategory: string | null;
  /** Ruta de la tienda (para los links de categoría). */
  basePath: string;
  preorderPath: string;
  wholesale?: { clientName: string } | null;
  /** Acceso aprobado de cliente final (`/acceso/<token>`): saludo con su nombre. */
  member?: { clientName: string } | null;
  /** Foto propia de cada categoría (por nombre); sin ella se usa la del primer producto. */
  categoryImages?: Record<string, string | null | undefined>;
  /** Endpoint del carrito (por defecto el de `preorderPath`) y tipo de acceso; el enlace mágico del visitante usa el suyo. */
  cartPath?: string;
  cartScope?: "public" | "acceso" | "mayorista" | "visitor";
  /** Base de las fichas de producto (`<base>/p/<id>`); por defecto `basePath`. */
  fichaBase?: string;
};

const DEFAULT_TAGLINE = "Alquiler de equipos para tu evento. Elegí lo que necesitás y te respondemos con una cotización.";

const STEPS = [
  { title: "Elegí tus equipos", text: "Marcá las fechas y sumá al pedido lo que necesitás. Ves la disponibilidad al instante, como referencia." },
  { title: "Enviá tu pedido", text: "Dejanos tus datos y el lugar del evento. No hace falta cuenta ni pago." },
  { title: "Te respondemos con la cotización", text: `En hasta ${PREORDER_RESPONSE_HOURS} horas hábiles. Recién ahí se confirma la reserva: el pedido solo no la asegura.` },
] as const;

export function StoreFront({ store, items, showPrices, demo, range, initialCategory, basePath, preorderPath, wholesale = null, zones = [], member = null, categoryImages, cartPath, cartScope, fichaBase }: Props) {
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Quiero consultar por ${wholesale ? "el catálogo mayorista" : "su catálogo de alquiler"}.`);
  const featured = featuredCategories(items);
  const hasContact = Boolean(whatsapp || store.email || store.profile);
  const nav = storeNavLinks("", { contact: hasContact });

  return (
    <StoreChrome theme={store.theme} appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={basePath} nav={nav} cart="button" />

      <main className="cp-main">
        {store.covers.desktop || store.covers.mobile ? (
          <picture className="cp-cover" data-testid="store-cover">
            {store.covers.mobile ? <source media="(max-width: 640px)" srcSet={store.covers.mobile} /> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={store.covers.desktop ?? store.covers.mobile ?? ""} alt={`Portada de ${store.name}`} />
          </picture>
        ) : null}
        <section className="cp-hero" aria-labelledby="titulo">
          <p className="cp-eyebrow">{wholesale ? "Catálogo mayorista" : "Tienda de alquiler"}</p>
          <h1 id="titulo" className="cp-h1">{store.name}</h1>
          <p className="cp-tagline">
            {wholesale ? `Hola ${wholesale.clientName}. Este es tu catálogo con precios mayoristas.` : member ? `Hola ${member.clientName}. Elegí lo que necesitás y te respondemos con una cotización.` : store.tagline || DEFAULT_TAGLINE}
          </p>
          {demo ? <p className="cp-note" role="note">Esto es una demo con datos de ejemplo: los pedidos no se guardan.</p> : null}
          <div className="cp-row cp-hero-actions">
            <a className="cp-btn cp-btn--primary" href="#catalogo">Ver catálogo</a>
            {whatsapp ? (
              <a className="cp-btn" href={whatsapp} target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a>
            ) : null}
          </div>
        </section>

        {featured.length > 1 ? (
          <section className="cp-section" aria-labelledby="categorias">
            <h2 id="categorias" className="cp-h2 cp-h2--lg">Categorías</h2>
            <ul className="cp-feat">
              {featured.map((entry) => (
                <li key={entry.category}>
                  <a className="cp-feat-card" href={`${basePath}?categoria=${encodeURIComponent(entry.category)}#catalogo`}>
                    <span className={categoryImages?.[entry.category] ?? entry.imageUrl ? "cp-feat-photo" : "cp-feat-photo cp-feat-photo--empty"}>
                      {categoryImages?.[entry.category] ?? entry.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={(categoryImages?.[entry.category] ?? entry.imageUrl) as string} alt="" loading="lazy" />
                      ) : (
                        <svg className="cp-feat-ico" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z" />
                          <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
                        </svg>
                      )}
                    </span>
                    <span className="cp-feat-name">{entry.category}</span>
                    <span className="cp-feat-count"><span className="cp-x-chip">{entry.count} {entry.count === 1 ? "equipo" : "equipos"}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <CatalogBrowser
          organizationName={store.name}
          showPrices={showPrices}
          preorderPath={preorderPath}
          wholesale={Boolean(wholesale)}
          clientName={wholesale?.clientName ?? null}
          demo={demo}
          items={items}
          range={range}
          initialCategory={initialCategory}
          zones={zones}
          template={store.appearance.template}
          slug={store.slug}
          cartScope={cartScope ?? (member ? "acceso" : wholesale ? "mayorista" : "public")}
          savedCart={Boolean(member || wholesale || cartScope === "visitor")}
          cartPath={cartPath}
          fichaBase={fichaBase ?? basePath}
          storeName={store.name}
        />

        <section id="como-funciona" className="cp-section" aria-labelledby="como">
          <h2 id="como" className="cp-h2 cp-h2--lg">Cómo funciona</h2>
          <ol className="cp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="cp-step">
                <span className="cp-step-n" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="cp-step-title">{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {hasContact ? (
          <section id="contacto" className="cp-section cp-contact" aria-labelledby="contacto-titulo">
            <h2 id="contacto-titulo" className="cp-h2 cp-h2--lg">Contacto</h2>
            <p className="cp-lead">¿Dudas o algo que no encontrás en el catálogo? Escribinos.</p>
            {store.profile ? (
              <CompanyInfo profile={store.profile} whatsapp={whatsapp} email={store.email} />
            ) : (
              <div className="cp-row">
                {whatsapp ? <a className="cp-btn cp-btn--primary" href={whatsapp} target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a> : null}
                {store.email ? <a className="cp-btn" href={`mailto:${store.email}`}>{store.email}</a> : null}
              </div>
            )}
          </section>
        ) : null}
      </main>

      <StoreFooter name={store.name} tagline={store.tagline} location={store.profile ? locationLine(store.profile) : null} whatsappUrl={whatsapp} email={store.email} links={storeFooterLinks(nav)} />
      {whatsapp ? <StoreWhatsappFloat href={whatsapp} /> : null}
    </StoreChrome>
  );
}

export { featuredCategories };
