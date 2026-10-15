"use client";

import type { PublicCatalogItem, PublicStorefront } from "@/lib/server/catalog-public";
import { appearanceView, DEFAULT_APPEARANCE } from "@/lib/appearance";
import { CatalogBrowser, type CatalogZoneView } from "@/components/catalog-public/CatalogBrowser";
import { StoreChrome } from "@/components/catalog-public/StoreChrome";
import { storeInitials } from "@/components/catalog-public/StoreLogo";
import { LandingHero } from "@/components/public/LandingHero";
import { InstagramIcon } from "@/components/public/InstagramIcon";
import { PREORDER_COPY } from "@/lib/storefront-ui";

const skin = appearanceView({ ...DEFAULT_APPEARANCE, template: "escenario" }, "#00e5ff");
const steps = [
  ["01", "Elegí tus productos", "Explorá el catálogo de la empresa y agregá productos a tu preorden."],
  ["02", "Indicá tus fechas", "Revisá el período y las cantidades en el carrito."],
  ["03", "Revisá el estimado", "Los productos sin precio requieren consultar precio y disponibilidad. La logística pendiente se cotiza aparte."],
  ["04", "Probá el envío", "En este laboratorio el envío es simulado: no genera una cotización ni reserva productos."],
];

/** Internal landing skin; uses exactly one canonical catalogue/cart engine. */
export function LandingStoreLab({ store, items, zones, organizationId, range }: {
  store: PublicStorefront; items: PublicCatalogItem[]; zones: CatalogZoneView[]; organizationId: string;
  range: { fromKey: string; toKey: string; days: number } | null;
}) {
  const base = `/api/admin/store-lab/${encodeURIComponent(organizationId)}`;
  const instagram = store.profile?.contact.instagram;
  const categories = [...new Set(items.map(item => item.category))];
  const title = store.tagline || "Alquiler para tu próximo evento";
  const logoVariant = store.logos.light ? "light" : store.logos.dark ? "dark" : null;
  const desktop = store.covers.desktop ? "/api/admin/organization/appearance/covers/desktop" : null;
  const mobile = store.covers.mobile ? "/api/admin/organization/appearance/covers/mobile" : null;
  return <div className="site lb-shop-lab" data-theme="dark" data-testid="store-lab">
    <StoreChrome appearance={skin}>
      <div className="led-grid-bg" aria-hidden="true" />
      <aside className="lab-notice" aria-label="Prueba interna"><strong>Laboratorio · Sólo prueba</strong><span>No publica cambios, no envía preórdenes y no reserva stock.</span><a href="/ajustes/tienda">Volver a Tienda</a></aside>
      <nav className="lab-nav" aria-label="Navegación de la tienda">
        <a href="#hero" className="lab-brand">{logoVariant ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/admin/organization/branding/logos/${logoVariant}`} alt="" /> : <span className="logo-box">{storeInitials(store.name)}</span>}<span>{store.name}</span></a>
        <div className="nav-center"><a href="#productos">Productos</a><a href="#proceso">Proceso</a><a href="#contacto">Contacto</a></div>
        <a href="#catalogo" className="nav-cta">Ver catálogo →</a>
      </nav>
      <main>
        <LandingHero kicker={`${store.name} · Alquileres & Eventos`} title={<>{title}<span className="led glow">.</span></>} description="Elegí los productos para tu evento y armá una preorden. La disponibilidad y el importe final se confirman en la cotización." actions={<><a href="#catalogo" className="btn-led">Consultar disponibilidad</a><a href="#productos" className="btn-line">Ver productos</a></>} foot={<><span><b>Catálogo</b> de {store.name}</span><span><b>Preorden</b> sin confirmación automática</span></>} />
        {(desktop || mobile) ? <picture className="lab-cover">{desktop ? <source media="(min-width: 768px)" srcSet={desktop} /> : null}{/* eslint-disable-next-line @next/next/no-img-element */}<img src={mobile ?? desktop!} alt={`Portada de ${store.name}`} /></picture> : null}
        {categories.length > 0 ? <div className="ticker" aria-hidden="true"><div className="ticker-track">{[0, 1].map(copy => <span key={copy}>{categories.join(" ● ")} ● </span>)}</div></div> : null}
        <section id="productos" aria-labelledby="lab-products-title"><div className="sec-head"><div><div className="sec-kicker">Catálogo de alquiler</div><h2 id="lab-products-title" className="sec-title rise">Productos<span className="led">.</span></h2></div><p className="sec-desc rise">Los productos y precios publicados por {store.name}, en una nueva presentación de prueba.</p></div><p className="catalog-note">{PREORDER_COPY.notice} {PREORDER_COPY.logistics}</p>
          <CatalogBrowser organizationName={store.name} storeName={store.name} slug={store.slug} cartScope="lab" preorderPath={`${base}/preorder`} cartPath={`${base}/cart`} wholesale={false} clientName={null} demo items={items} range={range} initialCategory={null} zones={zones} showPrices={store.appearance.priceMode !== "quote" && items.some(item => item.price !== null)} priceMode={store.appearance.priceMode} />
        </section>
        <section id="proceso" aria-labelledby="lab-process-title"><div className="sec-head"><div><div className="sec-kicker">Así trabajamos</div><h2 id="lab-process-title" className="sec-title rise">Proceso<span className="led">.</span></h2></div><p className="sec-desc rise">Una preorden permite preparar una propuesta para tu evento.</p></div><div className="steps">{steps.map(([number, heading, text]) => <div className="stp rise" key={number}><div className="n">{number}</div><h3>{heading}</h3><p>{text}</p></div>)}</div></section>
        <section id="contacto" aria-labelledby="lab-contact-title"><div className="c-left"><div><div className="sec-kicker">Hablemos</div><h2 id="lab-contact-title" className="c-title rise">Tu evento.<br /><span className="led">En grande.</span></h2><p className="c-desc">{store.name}</p></div><div className="c-meta">{instagram ? <a href={`https://www.instagram.com/${encodeURIComponent(instagram)}/`} target="_blank" rel="noopener noreferrer"><InstagramIcon /><b>Instagram:</b> @{instagram}</a> : <span>Podés cargar tu Instagram en Mi empresa.</span>}{store.email ? <span>{store.email}</span> : null}{store.profile?.location.city ? <span>{store.profile.location.city}</span> : null}</div></div><div className="c-right rise"><p className="chips-title">Probá la experiencia completa</p><a href="#catalogo" className="btn-led">Armar una preorden →</a><p className="f-note contact-note">Los contactos y envíos comerciales están desactivados en esta prueba interna.</p></div></section>
      </main>
      <footer className="lab-footer"><strong>{store.name}</strong><p>Laboratorio interno · Esta presentación todavía no está disponible como plantilla pública.</p><a href="/ajustes/apariencia">Volver a Apariencia</a></footer>
    </StoreChrome>
  </div>;
}
