import { preorderWhatsappUrl } from "@/lib/catalog-public";
import { locationLine } from "@/lib/org-profile";
import type { PublicCatalogItem, PublicCollection, PublicStorefront } from "@/lib/server/catalog-public";
import { CatalogBrowser, type CatalogZoneView } from "./CatalogBrowser";
import { StoreChrome } from "./StoreChrome";
import { StoreFooter, StoreWhatsappFloat, storeFooterLinks } from "./StoreFooter";
import { StoreHeader, storeNavLinks } from "./StoreHeader";

/**
 * Landing de una colección (`/tienda/<slug>/c/<coleccion>`): encabezado con la foto de ambientación, el nombre y la
 * descripción, y debajo el mismo catálogo con carrito, filtros y vista rápida, limitado a los productos de la colección
 * en el orden que decidió la empresa. Componente de servidor.
 */
export function CollectionPage({ store, collection, items, otherCollections, showPrices, demo, range, zones, basePath }: {
  store: PublicStorefront;
  collection: PublicCollection;
  /** Solo los productos de la colección, ya en su orden. */
  items: PublicCatalogItem[];
  otherCollections: PublicCollection[];
  showPrices: boolean;
  demo: boolean;
  range: { fromKey: string; toKey: string; days: number } | null;
  zones: CatalogZoneView[];
  basePath: string;
}) {
  const priceMode = store.appearance.priceMode;
  const prices = showPrices && priceMode !== "quote";
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Quiero consultar por la colección ${collection.name}.`);
  const hasContact = Boolean(whatsapp || store.email || store.profile);
  const nav = storeNavLinks(basePath, { contact: hasContact });
  const slug = encodeURIComponent(store.slug);
  const cover = collection.imageUrl ?? items.find((item) => item.imageUrl)?.imageUrl ?? null;
  return (
    <StoreChrome theme={store.theme} appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={basePath} nav={nav} cart="button" cartScope="public" searchHref="#catalogo" />
      <main className="cp-page" data-testid="collection-page">
        <div className="cp-container cp-main-pad">
          <nav className="cp-crumbs" aria-label="Ruta">
            <a href={basePath}>Inicio</a><span aria-hidden="true">/</span>
            <a href={`${basePath}#colecciones`}>Colecciones</a><span aria-hidden="true">/</span>
            <span aria-current="page">{collection.name}</span>
          </nav>
          <header className="cp-colhero" data-photo={collection.imageUrl ? "yes" : "no"}>
            {collection.imageUrl ? (
              <div className="cp-colhero-media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={collection.imageUrl} alt={`Ambientación de la colección ${collection.name}`} />
              </div>
            ) : null}
            <div className="cp-colhero-copy">
              <p className="cp-eyebrow">Colección</p>
              <h1 className="cp-h1">{collection.name}</h1>
              {collection.description ? <p className="cp-colhero-text">{collection.description}</p> : null}
              <p className="cp-hint cp-colhero-count">{items.length === 1 ? "1 producto" : `${items.length} productos`}</p>
            </div>
          </header>
          <CatalogBrowser
            organizationName={store.name}
            showPrices={prices}
            preorderPath={`/api/catalog/${slug}/preorder`}
            wholesale={false}
            clientName={null}
            demo={demo}
            items={items}
            range={range}
            initialCategory={null}
            zones={zones}
            priceMode={priceMode}
            slug={store.slug}
            cartScope="public"
            fichaBase={basePath}
            storeName={store.name}
          />
          {otherCollections.length > 0 ? (
            <section className="cp-section" aria-labelledby="otras-colecciones">
              <div className="cp-section-head"><h2 id="otras-colecciones" className="cp-h2">Otras colecciones</h2></div>
              <ul className="cp-fchips">
                {otherCollections.map((entry) => <li key={entry.id}><a className="cp-cat" href={`${basePath}/c/${encodeURIComponent(entry.slug)}`}>{entry.name}</a></li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
      <StoreFooter
        name={store.name}
        tagline={store.tagline}
        location={store.profile ? locationLine(store.profile) : null}
        whatsappUrl={whatsapp}
        email={store.email}
        links={storeFooterLinks(nav)}
        profile={store.profile}
        zones={zones.map((zone) => zone.name)}
      />
      {whatsapp ? <StoreWhatsappFloat href={whatsapp} /> : null}
    </StoreChrome>
  );
}
