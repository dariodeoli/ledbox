import { PREORDER_RESPONSE_HOURS, preorderWhatsappUrl } from "@/lib/catalog-public";
import type { PublicCatalogItem, PublicStorefront } from "@/lib/server/catalog-public";
import { CatalogBrowser, type CatalogZoneView } from "./CatalogBrowser";
import type { StoreListState } from "@/lib/storefront-list-state";
import { CategoryAccordion } from "./CategoryAccordion";
import { CategoryCard } from "./CategoryCard";
import { EventPicker } from "./EventPicker";
import { storeCategories, storeCategoryHref, withStoreDates } from "@/lib/store-categories";
import { featuredCategories } from "@/lib/featured-categories";
import { CompanyInfo } from "./CompanyInfo";
import { locationLine } from "@/lib/org-profile";
import { StoreFooter, StoreWhatsappFloat, storeFooterLinks } from "./StoreFooter";
import { StoreHeader, storeNavLinks } from "./StoreHeader";
import { StoreChrome } from "./StoreChrome";
import { CollectionsSection, EditorialBlock, FeaturedSection, InspirationSection } from "./HomeSections";
import { editorialHasContent, visibleSections, type HomeSectionId } from "@/lib/store-home";
import type { PublicCollection } from "@/lib/server/catalog-public";
import { Fragment, type ReactNode } from "react";

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
  /** Colecciones visibles con productos publicados. */
  collections?: PublicCollection[];
  /** Ruta de la tienda pública para las landings `/c/<coleccion>`; sin ella (mayorista, acceso) las colecciones solo filtran el catálogo. */
  collectionsBase?: string | null;
  initialCollection?: string | null;
  initialListState?: StoreListState;
};

const DEFAULT_TITLE = "Alquiler para tu próximo evento";
const DEFAULT_SUB = "Elegí lo que necesitás y te respondemos con una cotización.";

const STEPS = [
  { title: "Elegí tus productos", text: "Marcá las fechas y sumá al pedido lo que necesitás. Ves la disponibilidad al instante, como referencia." },
  { title: "Indicá fecha y datos", text: "Dejanos tus datos y el lugar del evento. No hace falta cuenta ni pago." },
  { title: "Recibí tu cotización", text: `En hasta ${PREORDER_RESPONSE_HOURS} horas hábiles. Un pedido no es una reserva: recién ahí se confirma.` },
  { title: "Confirmá y disfrutá", text: "Si te conviene, confirmamos la reserva y coordinamos la entrega y el retiro." },
] as const;

export function StoreFront({ store, items, showPrices: showPricesProp, demo, range, initialCategory, basePath, preorderPath, wholesale = null, zones = [], member = null, categoryImages, cartPath, cartScope, fichaBase, collections = [], collectionsBase = null, initialCollection = null, initialListState }: Props) {
  const priceMode = store.appearance.priceMode;
  // «A cotizar»: la tienda no muestra montos aunque la empresa los tenga cargados.
  const showPrices = showPricesProp && priceMode !== "quote";
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Quiero consultar por ${wholesale ? "el catálogo mayorista" : "su catálogo de alquiler"}.`);
  const featured = featuredCategories(items);
  const minByCategory = new Map<string, number>();
  const countsByCategory = new Map<string, number>();
  const imagesByCategory = new Map<string, string>();
  for (const item of items) {
    countsByCategory.set(item.category, (countsByCategory.get(item.category) ?? 0) + 1);
    if (item.imageUrl && !imagesByCategory.has(item.category)) imagesByCategory.set(item.category, item.imageUrl);
    const unit = item.price?.unit ?? 0;
    if (unit > 0) minByCategory.set(item.category, Math.min(minByCategory.get(item.category) ?? unit, unit));
  }
  const publicCategories = !member && !wholesale && (!cartScope || cartScope === "public") && store.accessMode === "OPEN";
  const categoryIndex = storeCategories(items);
  const categoryHref = (name: string) => {
    const category = categoryIndex.find((entry) => entry.name === name)!;
    return publicCategories ? storeCategoryHref(basePath, category, range) : withStoreDates(`${basePath}?categoria=${encodeURIComponent(name)}`, range) + "#catalogo";
  };
  const hasContact = Boolean(whatsapp || store.email || store.profile);
  const home = store.appearance.home;
  const accordionCategories = "categoryLayout" in home && home.categoryLayout === "accordion";
  const order = visibleSections(home);
  const shownIds = new Set<HomeSectionId>(order);
  const nav = storeNavLinks("", { contact: hasContact && shownIds.has("contacto"), howItWorks: shownIds.has("como-funciona"), categories: featured.length > 1 ? featured.slice(0, 3).map((entry) => ({ name: entry.category, href: categoryHref(entry.category) })) : [] });
  const hasCover = Boolean(store.covers.desktop || store.covers.mobile);
  const title = store.tagline || DEFAULT_TITLE;
  const sub = wholesale ? `Hola ${wholesale.clientName}. Este es tu catálogo con precios mayoristas.` : member ? `Hola ${member.clientName}. ${DEFAULT_SUB}` : DEFAULT_SUB;

  const featuredItems = items.filter((item) => item.featured).slice(0, 8);
  const hasCollections = collections.length > 0;
  const heroNode = (
        <section className="cp-hero cp-home-hero" aria-labelledby="titulo" data-cover={hasCover ? "yes" : "no"} data-testid="store-hero">
          {hasCover ? (
            <picture className="cp-hero-media" data-testid="store-cover">
              {/* Escritorio (≥ 768 px): la de 1920×600. Celular: la de 1080×1350. Si falta una, la otra (centrada, sin deformar). */}
              {store.covers.desktop ? <source media="(min-width: 768px)" srcSet={store.covers.desktop} /> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={store.covers.mobile ?? store.covers.desktop ?? ""} alt={`Portada de ${store.name}`} fetchPriority="high" />
            </picture>
          ) : null}
          <div className="cp-hero-inner">
            <div className="cp-home-intro">
              <div className="cp-hero-copy">
                <p className="cp-eyebrow">{wholesale ? "Tu catálogo mayorista" : "Alquiler para eventos"}</p>
                <h1 id="titulo" className="cp-h1"><span className="cp-sr">{store.name}: </span>{title}</h1>
                <p className="cp-hero-sub">{sub}</p>
              </div>
              <div className="cp-hero-actions">
                <a className="cp-btn cp-btn--primary" href="#catalogo">Ver catálogo</a>
                {shownIds.has("como-funciona") ? <a className="cp-link" href="#como-funciona">Cómo funciona</a> : null}
              </div>
            </div>
            <div className="cp-home-booking">
              <EventPicker slug={store.slug} range={range} variant="hero" restore />
            </div>
            {demo ? <p className="cp-note cp-demo-notice" role="note">Esto es una demo con datos de ejemplo: los pedidos no se guardan.</p> : null}
          </div>
        </section>
  );
  const sectionNodes: Record<Exclude<HomeSectionId, "hero">, ReactNode> = {
    categorias: (
      <>
          {(accordionCategories ? categoryIndex.length > 0 : featured.length > 1) ? (
            <section className="cp-section" aria-labelledby="categorias">
              <div className="cp-section-head">
                <h2 id="categorias" className="cp-h2">Categorías</h2>
                <p className="cp-lead">Encontrá lo que necesitás para tu evento.</p>
              </div>
              {accordionCategories ? <CategoryAccordion
                catalogKey={basePath}
                showPrices={showPrices}
                priceMode={priceMode}
                categories={categoryIndex.map((entry) => ({ name: entry.name, href: categoryHref(entry.name), imageUrl: categoryImages?.[entry.name] ?? imagesByCategory.get(entry.name) ?? null, count: countsByCategory.get(entry.name) ?? 0, minUnit: minByCategory.get(entry.name) ?? null }))}
              /> : <div className="cp-catgrid">
                {featured.map((entry) => (
                  <CategoryCard
                    key={entry.category}
                    name={entry.category}
                    href={categoryHref(entry.category)}
                    imageUrl={categoryImages?.[entry.category] ?? entry.imageUrl}
                    count={entry.count}
                    minUnit={minByCategory.get(entry.category) ?? null}
                    showPrices={showPrices}
                    priceMode={priceMode}
                  />
                ))}
              </div>}
            </section>
          ) : null}
      </>
    ),
    destacados: <FeaturedSection items={featuredItems} fichaBase={fichaBase ?? basePath} showPrices={showPrices} priceMode={priceMode} />,
    colecciones: (
      <>
        {editorialHasContent(home.editorial) ? <EditorialBlock editorial={home.editorial} photo={store.homePhotos.editorial} ctaHref={collectionsBase && hasCollections ? "#colecciones" : "#catalogo"} /> : null}
        {collectionsBase && hasCollections ? <CollectionsSection collections={collections} items={items} base={collectionsBase} /> : null}
      </>
    ),
    catalogo: (
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
            showEventPicker={!shownIds.has("hero")}
            categoryPreviewKey={accordionCategories && shownIds.has("categorias") ? basePath : undefined}
            categoryNavigation={publicCategories ? { allHref: `${withStoreDates(basePath, range)}#catalogo`, links: categoryIndex.map((entry) => ({ name: entry.name, href: categoryHref(entry.name) })), clientSide: true } : undefined}
            zones={zones}
            priceMode={priceMode}
            slug={store.slug}
            cartScope={cartScope ?? (member ? "acceso" : wholesale ? "mayorista" : "public")}
            savedCart={Boolean(member || wholesale || cartScope === "visitor")}
            cartPath={cartPath}
            fichaBase={fichaBase ?? basePath}
            storeName={store.name}
            collections={collections.map((entry) => ({ slug: entry.slug, name: entry.name }))}
            initialCollection={initialCollection}
            initialListState={initialListState}
          />
    ),
    "como-funciona": (
          <section id="como-funciona" className="cp-section cp-block-sand" aria-labelledby="como">
            <div className="cp-section-head">
              <h2 id="como" className="cp-h2">Tu evento, paso a paso</h2>
              <p className="cp-lead">Elegís, consultás y coordinamos con vos.</p>
            </div>
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
    ),
    inspiracion: <InspirationSection inspiration={home.inspiration} photos={[store.homePhotos["inspiracion-1"], store.homePhotos["inspiracion-2"], store.homePhotos["inspiracion-3"]]} instagram={store.profile?.contact.instagram ?? null} />,
    contacto: (
      <>
          {zones.length > 0 ? (
            <section className="cp-section" aria-labelledby="zonas" data-testid="delivery-zones">
              <div className="cp-section-head">
                <h2 id="zonas" className="cp-h2">Zonas de entrega</h2>
                <p className="cp-lead">Llevamos y retiramos en estas zonas. El flete se cotiza junto con tu pedido.</p>
              </div>
              <ul className="cp-zones">{zones.map((zone) => <li key={zone.id}>{zone.name}</li>)}</ul>
            </section>
          ) : null}
          {hasContact ? (
            <section id="contacto" className="cp-section cp-contact" aria-labelledby="contacto-titulo">
              <div className="cp-section-head">
                <h2 id="contacto-titulo" className="cp-h2">Contacto</h2>
                <p className="cp-lead">¿Dudas o algo que no encontrás en el catálogo? Escribinos.</p>
              </div>
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
      </>
    ),
  };
  // Se agrupan las secciones seguidas dentro de un mismo contenedor; la portada va a sangre, fuera de él.
  const groups: Array<{ kind: "hero" } | { kind: "sections"; nodes: ReactNode[] }> = [];
  for (const id of order) {
    if (id === "hero") { groups.push({ kind: "hero" }); continue; }
    const last = groups[groups.length - 1];
    const node = <Fragment key={id}>{sectionNodes[id]}</Fragment>;
    if (last && last.kind === "sections") last.nodes.push(node);
    else groups.push({ kind: "sections", nodes: [node] });
  }

  return (
    <StoreChrome theme={store.theme} appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={withStoreDates(basePath, range)} nav={nav} cart="button" cartScope={cartScope === "acceso" || cartScope === "mayorista" ? cartScope : "public"} searchHref={`${withStoreDates(basePath, range)}#catalogo`} />

      <main className="cp-page">
        {!shownIds.has("hero") ? <h1 className="cp-sr">{store.name}</h1> : null}
        {groups.map((group, index) => (group.kind === "hero" ? <Fragment key={`hero-${index}`}>{heroNode}</Fragment> : <div key={`group-${index}`} className="cp-container cp-sections">{group.nodes}</div>))}
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
        categories={featured.map((entry) => ({ name: entry.category, href: categoryHref(entry.category) }))}
      />
      {whatsapp ? <StoreWhatsappFloat href={whatsapp} /> : null}
    </StoreChrome>
  );
}

export { featuredCategories };
