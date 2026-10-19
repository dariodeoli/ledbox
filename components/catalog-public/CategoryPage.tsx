import type { PublicCatalogItem, PublicCollection, PublicStorefront } from "@/lib/server/catalog-public";
import Link from "next/link";
import { storeCategoryHref, withStoreDates, type StoreCategory } from "@/lib/store-categories";
import { locationLine } from "@/lib/org-profile";
import { preorderWhatsappUrl } from "@/lib/catalog-public";
import { CatalogBrowser, type CatalogZoneView } from "./CatalogBrowser";
import { StoreChrome } from "./StoreChrome";
import { StoreHeader, storeNavLinks } from "./StoreHeader";
import { StoreFooter, StoreWhatsappFloat, storeFooterLinks } from "./StoreFooter";

/** Página de categoría: el listado queda fijo, mientras el carrito conserva productos de toda la tienda pública. */
export function CategoryPage({ store, category, categories, items, collections, zones, range, basePath, showPrices, demo }: {
  store: PublicStorefront; category: StoreCategory; categories: StoreCategory[]; items: PublicCatalogItem[];
  collections: PublicCollection[]; zones: CatalogZoneView[]; range: { fromKey: string; toKey: string; days: number } | null;
  basePath: string; showPrices: boolean; demo: boolean;
}) {
  const home = withStoreDates(basePath, range);
  const links = categories.map((entry) => ({ name: entry.name, href: storeCategoryHref(basePath, entry, range) }));
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Quiero consultar por ${category.name}.`);
  const nav = storeNavLinks(home, { contact: Boolean(whatsapp || store.email || store.profile), categories: links.slice(0, 3) });
  const count = items.filter((item) => item.category === category.name).length;
  return (
    <StoreChrome appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={home} nav={nav} cart="button" cartScope="public" searchHref="#catalogo" />
      <main className="cp-page" data-testid="category-page">
        <div className="cp-container cp-main-pad">
          <header className="cp-category-head">
            <Link className="cp-link cp-category-back" href={`${home}#catalogo`} scroll={false}>← Catálogo</Link>
            <div className="cp-category-title">
              <h1 className="cp-h3">{category.name}</h1>
              <span className="cp-hint">{count} {count === 1 ? "producto" : "productos"}</span>
            </div>
          </header>
          <CatalogBrowser organizationName={store.name} showPrices={showPrices && store.appearance.priceMode !== "quote"} preorderPath={`/api/catalog/${encodeURIComponent(store.slug)}/preorder`} wholesale={false} clientName={null} demo={demo} items={items} range={range} initialCategory={category.name} categoryName={category.name} categoryNavigation={{ allHref: `${home}#catalogo`, links }} zones={zones} priceMode={store.appearance.priceMode} slug={store.slug} cartScope="public" fichaBase={basePath} storeName={store.name} collections={collections.map((entry) => ({ slug: entry.slug, name: entry.name }))} />
        </div>
      </main>
      <StoreFooter name={store.name} tagline={store.tagline} location={store.profile ? locationLine(store.profile) : null} whatsappUrl={whatsapp} email={store.email} links={storeFooterLinks(nav)} profile={store.profile} zones={zones.map((zone) => zone.name)} categories={links} />
      {whatsapp ? <StoreWhatsappFloat href={whatsapp} /> : null}
    </StoreChrome>
  );
}
