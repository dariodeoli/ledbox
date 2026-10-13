import type { CSSProperties } from "react";
import { PREORDER_RESPONSE_HOURS, preorderWhatsappUrl } from "@/lib/catalog-public";
import { storefrontThemeVars } from "@/lib/storefront-theme";
import type { PublicCatalogItem, PublicStorefront } from "@/lib/server/catalog-public";
import { CatalogBrowser } from "./CatalogBrowser";

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
  initialCategory: string | null;
  /** Ruta de la tienda (para los links de categoría). */
  basePath: string;
  preorderPath: string;
  wholesale?: { clientName: string } | null;
};

const DEFAULT_TAGLINE = "Alquiler de equipos para tu evento. Elegí lo que necesitás y te respondemos con una cotización.";

function initials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("");
  return (letters || "·").toUpperCase();
}

function Logo({ store }: { store: PublicStorefront }) {
  const light = `/api/catalog/${encodeURIComponent(store.slug)}/logo/light`;
  const dark = `/api/catalog/${encodeURIComponent(store.slug)}/logo/dark`;
  if (!store.logos.light && !store.logos.dark) {
    return <span className="cp-mono" aria-hidden="true">{initials(store.name)}</span>;
  }
  // `dark` es el logo para fondos claros y `light` para fondos oscuros. Con una sola
  // variante se usa en ambos temas; la clara va sobre una chapa oscura para que se lea.
  const onlyLight = store.logos.light && !store.logos.dark;
  return (
    <picture className={onlyLight ? "cp-logo cp-logo--plate" : "cp-logo"}>
      {store.logos.light && store.logos.dark ? <source media="(prefers-color-scheme: dark)" srcSet={light} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={store.logos.dark ? dark : light} alt={`Logo de ${store.name}`} />
    </picture>
  );
}

const STEPS = [
  { title: "Elegí tus equipos", text: "Marcá las fechas y sumá al pedido lo que necesitás. Ves la disponibilidad al instante, como referencia." },
  { title: "Enviá tu pedido", text: "Dejanos tus datos y el lugar del evento. No hace falta cuenta ni pago." },
  { title: "Te respondemos con la cotización", text: `En hasta ${PREORDER_RESPONSE_HOURS} horas hábiles. Recién ahí se confirma la reserva: el pedido solo no la asegura.` },
] as const;

export function StoreFront({ store, items, showPrices, demo, range, initialCategory, basePath, preorderPath, wholesale = null }: Props) {
  const style = storefrontThemeVars(store.theme) as CSSProperties;
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Quiero consultar por ${wholesale ? "el catálogo mayorista" : "su catálogo de alquiler"}.`);
  const featured = featuredCategories(items);
  const hasContact = Boolean(whatsapp || store.email);

  return (
    <div className="cp-theme" style={style}>
      <header className="cp-nav">
        <div className="cp-nav-inner">
          <a className="cp-brand" href={basePath} aria-label={`Inicio de ${store.name}`}>
            <Logo store={store} />
            <span className="cp-brand-name">{store.name}</span>
          </a>
          <nav className="cp-nav-links" aria-label="Secciones de la tienda">
            <a href="#catalogo">Catálogo</a>
            <a href="#como-funciona">Cómo funciona</a>
            {hasContact ? <a href="#contacto">Contacto</a> : null}
          </nav>
        </div>
      </header>

      <main className="cp-main">
        <section className="cp-hero" aria-labelledby="titulo">
          <p className="cp-eyebrow">{wholesale ? "Catálogo mayorista" : "Tienda de alquiler"}</p>
          <h1 id="titulo" className="cp-h1">{store.name}</h1>
          <p className="cp-tagline">
            {wholesale ? `Hola ${wholesale.clientName}. Este es tu catálogo con precios mayoristas.` : store.tagline || DEFAULT_TAGLINE}
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
                    <span className="cp-feat-photo">
                      {entry.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="cp-feat-ph" aria-hidden="true">{initials(entry.category)}</span>
                      )}
                    </span>
                    <span className="cp-feat-name">{entry.category}</span>
                    <span className="cp-feat-count">{entry.count} {entry.count === 1 ? "equipo" : "equipos"}</span>
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
        />

        <section id="como-funciona" className="cp-section" aria-labelledby="como">
          <h2 id="como" className="cp-h2 cp-h2--lg">Cómo funciona</h2>
          <ol className="cp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="cp-step">
                <span className="cp-step-n" aria-hidden="true">{index + 1}</span>
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
            <div className="cp-row">
              {whatsapp ? <a className="cp-btn cp-btn--primary" href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
              {store.email ? <a className="cp-btn" href={`mailto:${store.email}`}>{store.email}</a> : null}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="cp-foot">
        <p>{store.name} · Los precios son de referencia en guaraníes y se confirman en la cotización. Un pedido no es una reserva hasta que la confirmamos.</p>
      </footer>
    </div>
  );
}

/** Categorías con más equipos (hasta 6), cada una con la foto de su primer equipo que la tenga. */
export function featuredCategories(items: ReadonlyArray<Pick<PublicCatalogItem, "category" | "imageUrl">>) {
  const map = new Map<string, { category: string; count: number; imageUrl: string | null }>();
  for (const item of items) {
    const entry = map.get(item.category) ?? { category: item.category, count: 0, imageUrl: null };
    entry.count += 1;
    entry.imageUrl = entry.imageUrl ?? item.imageUrl;
    map.set(item.category, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "es")).slice(0, 6);
}
