import { preorderWhatsappUrl } from "@/lib/catalog-public";
import type { PublicStorefront } from "@/lib/server/catalog-public";
import { AccessGate } from "./AccessGate";
import { CompanyInfo } from "./CompanyInfo";
import { locationLine } from "@/lib/org-profile";
import { StoreFooter, storeFooterLinks } from "./StoreFooter";
import { StoreHeader, storeNavLinks } from "./StoreHeader";
import { StoreChrome } from "./StoreChrome";

/** Página de una tienda «Con solicitud» o «Privada» sin link: portada mínima + la puerta de acceso. */
export function AccessPage({ store, demo, endpoint }: { store: PublicStorefront; demo: boolean; endpoint: string }) {
  const mode = store.accessMode === "PRIVATE" ? "PRIVATE" : "REQUEST";
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Quiero acceso a su catálogo de alquiler.`);
  return (
    <StoreChrome theme={store.theme} appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={`/tienda/${encodeURIComponent(store.slug)}`} nav={[]} cart={null} />
      <main className="cp-main cp-narrow">
        {store.covers.desktop || store.covers.mobile ? (
          <picture className="cp-cover" data-testid="store-cover">
            {store.covers.mobile ? <source media="(max-width: 640px)" srcSet={store.covers.mobile} /> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={store.covers.desktop ?? store.covers.mobile ?? ""} alt={`Portada de ${store.name}`} />
          </picture>
        ) : null}
        <header className="cp-header">
          <p className="cp-eyebrow">Tienda de alquiler</p>
          <h1 className="cp-h1">{store.name}</h1>
          {store.tagline ? <p className="cp-tagline">{store.tagline}</p> : null}
        </header>
        <AccessGate mode={mode} organizationName={store.name} endpoint={endpoint} whatsappUrl={whatsapp} demo={demo} />
        {store.profile ? <section className="cp-card"><CompanyInfo profile={store.profile} /></section> : null}
      </main>
      <StoreFooter name={store.name} tagline={store.tagline} location={store.profile ? locationLine(store.profile) : null} whatsappUrl={whatsapp} email={store.email} links={storeFooterLinks([])} />
    </StoreChrome>
  );
}
