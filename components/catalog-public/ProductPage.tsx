import { PREORDER_RESPONSE_HOURS, catalogLine, catalogTierHints, preorderWhatsappUrl } from "@/lib/catalog-public";
import { capacityText, cardSpecs } from "@/lib/catalog-card";
import { HANDOVER_KINDS, HANDOVER_LABEL, locationLine, rangesLabel } from "@/lib/org-profile";
import { formatGs, priceUnitLabel, quantityStep } from "@/lib/storefront-ui";
import type { ProductDetail } from "@/lib/server/catalog-product";
import type { PublicStorefront } from "@/lib/server/catalog-public";
import { BuyPanel } from "./BuyPanel";
import { MiniAdd } from "./MiniAdd";
import { ProductGallery } from "./ProductGallery";
import { StoreFooter, StoreWhatsappFloat, storeFooterLinks } from "./StoreFooter";
import { StoreHeader, storeNavLinks } from "./StoreHeader";
import { StoreChrome } from "./StoreChrome";
import { ProductPlaceholder, XIcon } from "./StoreIcons";

/**
 * Ficha de producto: galería al 58 % y panel sticky al 42 %. El panel, en orden: migas, «SECTOR · COD», nombre, subtítulo,
 * el precio UNA sola vez, «Incluye» con checks, fechas con disponibilidad, cantidad y «Agregar al pedido» ancho, WhatsApp con
 * mensaje prearmado y la nota. Debajo: acordeón (descripción, medidas y piezas, condiciones, entrega y retiro), «Completá el
 * ambiente» y «Otros» con los similares que ya existen. Todo con los tokens del tema. Componente de servidor.
 */

const codeOf = (sku: string) => `COD #${sku.replace(/^cod\s*#?\s*/i, "")}`;
const rootOf = (category: string) => category.split("›")[0].trim();

type Props = {
  store: PublicStorefront;
  detail: ProductDetail;
  showPrices: boolean;
  /** Inicio de la tienda en este modo de acceso (público, link de acceso o mayorista). */
  basePath: string;
  scope: "public" | "acceso" | "mayorista";
  /** Endpoint del carrito guardado en el servidor (acceso / mayorista); `null` para el visitante. */
  cartPath: string | null;
  wholesale?: boolean;
  /** Fechas elegidas (de la dirección): con ellas el servidor calculó la disponibilidad indicativa. */
  range?: { fromKey: string; toKey: string; days: number } | null;
  /** Nombres de las zonas de entrega de la empresa. */
  zones?: string[];
};

export function ProductPage({ store, detail, showPrices: showPricesProp, basePath, scope, cartPath, wholesale = false, range = null, zones = [] }: Props) {
  const { item, includes, related } = detail;
  const priceMode = store.appearance.priceMode;
  const showPrices = showPricesProp && priceMode !== "quote";
  const days = range?.days ?? 1;
  const unit = item.price ? catalogLine(item.price, days) : null;
  const tiers = showPrices ? catalogTierHints(item.price) : [];
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Consulto por ${item.name}${item.sku ? ` (${codeOf(item.sku)})` : ""}.`);
  const specs = cardSpecs(item);
  const descriptionLines = (specs.description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasContact = Boolean(whatsapp || store.email || store.profile);
  const nav = storeNavLinks(basePath, { contact: hasContact });
  const fichaOf = (id: string) => `${basePath}/p/${encodeURIComponent(id)}`;
  const sector = rootOf(item.category);
  const isPackage = includes.length > 0;
  const step = quantityStep(priceMode, isPackage);
  const complement = related.filter((entry) => entry.category !== item.category).slice(0, 4);
  const others = related.filter((entry) => entry.category === item.category).slice(0, 4);
  const handover = store.profile ? HANDOVER_KINDS.filter((kind) => store.profile!.handover[kind].length > 0) : [];
  const conditions = store.profile?.conditions ?? null;

  const mini = (entry: (typeof related)[number]) => {
    const price = showPrices && entry.price ? catalogLine(entry.price, 1) : null;
    return (
      <li key={entry.id}>
        <div className="cp-mini">
          <a className="cp-mini-open" href={fichaOf(entry.id)} aria-label={`Ver la ficha de ${entry.name}`} />
          <div className="cp-mini-media">
            {entry.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.imageUrl} alt="" loading="lazy" />
            ) : (
              <ProductPlaceholder size={28} />
            )}
          </div>
          <div className="cp-mini-body">
            <span className="cp-mini-name">{entry.name}</span>
            <div className="cp-mini-foot">
              {price && price.unitPrice > 0 ? <span className="cp-price-unit"><strong className="cp-price">{formatGs(price.unitPrice)}</strong> {priceUnitLabel(priceMode, price.mode, null)}</span> : <span className="cp-price-unit">Consultar precio</span>}
              <MiniAdd itemId={entry.id} name={entry.name} slug={store.slug} scope={scope} cartPath={cartPath} />
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <StoreChrome theme={store.theme} appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={basePath} nav={nav} cart={{ href: `${basePath}#catalogo` }} cartScope={scope} searchHref={`${basePath}#catalogo`} />
      <main className="cp-page" data-testid="product-page">
        <div className="cp-container cp-main-pad">
          <div className="cp-ficha-grid">
            <ProductGallery images={item.imageUrl ? [item.imageUrl] : []} name={item.name} />
            <div className="cp-panel">
              <nav className="cp-crumbs" aria-label="Ruta">
                <a href={basePath}>Inicio</a><span aria-hidden="true">/</span>
                <a href={`${basePath}?categoria=${encodeURIComponent(item.category)}#catalogo`}>{sector}</a><span aria-hidden="true">/</span>
                <span aria-current="page">{item.name}</span>
              </nav>
              <p className="cp-panel-meta">{sector}{item.sku ? ` · ${codeOf(item.sku)}` : ""}{wholesale ? " · Mayorista" : ""}</p>
              <h1 className="cp-panel-title">{item.name}</h1>
              {item.capacity ? <p className="cp-panel-sub">{isPackage ? "Juego" : "Apto"} para {capacityText(item.capacity)}</p> : isPackage ? <p className="cp-panel-sub">Juego completo</p> : null}
              {showPrices ? (
                <div data-testid="product-price">
                  {unit && unit.unitPrice > 0 ? (
                    <p className="cp-panel-price"><span className="cp-price-lg">{formatGs(unit.unitPrice)}</span><span className="cp-price-unit">{priceUnitLabel(priceMode, unit.mode, range ? days : null)}</span></p>
                  ) : (
                    <p className="cp-price-unit">Consultar precio</p>
                  )}
                  {tiers.length > 0 ? <ul className="cp-plain cp-hint" aria-label="Escalones por días">{tiers.map((hint) => <li key={hint}>{hint}</li>)}</ul> : null}
                </div>
              ) : null}
              {includes.length > 0 ? (
                <section aria-labelledby="incluye">
                  <h2 id="incluye" className="cp-qv-h">Incluye</h2>
                  <ul className="cp-checks">
                    {includes.map((part) => (
                      <li key={`${part.name}-${part.sku ?? ""}`}>
                        <XIcon name="check" size={16} />
                        <span>{part.quantity} × {part.name}{part.sku ? <small className="cp-hint"> {codeOf(part.sku)}</small> : null}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <BuyPanel
                itemId={item.id}
                name={item.name}
                sku={item.sku}
                slug={store.slug}
                scope={scope}
                cartPath={cartPath}
                range={range}
                availability={item.availability}
                step={step}
                storeName={store.name}
                whatsappPhone={store.whatsappPhone}
                showPrices={showPrices}
                basePath={basePath}
              />
            </div>
          </div>

          <div className="cp-acc" data-testid="product-accordion">
            {descriptionLines.length > 0 ? (
              <details open>
                <summary>Descripción</summary>
                <div className="cp-acc-body cp-pre">{descriptionLines.join("\n")}</div>
              </details>
            ) : null}
            {specs.dimensions || specs.capacity || includes.length > 0 ? (
              <details open={descriptionLines.length === 0}>
                <summary>Medidas y piezas</summary>
                <div className="cp-acc-body">
                  <table className="cp-datatable" aria-label="Medidas y piezas">
                    <tbody>
                      {specs.dimensions ? <tr><th scope="row">Medidas</th><td>{specs.dimensions}</td></tr> : null}
                      {specs.capacity ? <tr><th scope="row">Capacidad</th><td>{capacityText(specs.capacity)}</td></tr> : null}
                      {includes.map((part) => <tr key={`${part.name}-${part.sku ?? ""}`}><th scope="row">{part.quantity} ×</th><td>{part.name}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
            <details>
              <summary>Condiciones de alquiler</summary>
              <div className="cp-acc-body">
                <p>Un pedido no es una reserva: te respondemos en hasta {PREORDER_RESPONSE_HOURS} horas hábiles con la cotización y, recién ahí, se confirma.</p>
                <p>La disponibilidad que ves es indicativa y se confirma al cotizar.</p>
                {conditions ? <p className="cp-pre">{conditions}</p> : null}
              </div>
            </details>
            {handover.length > 0 || zones.length > 0 || (store.profile && locationLine(store.profile)) ? (
              <details>
                <summary>Entrega y retiro</summary>
                <div className="cp-acc-body">
                  {handover.length > 0 ? (
                    <table className="cp-datatable" aria-label="Horarios de entrega y retiro">
                      <tbody>{handover.map((kind) => <tr key={kind}><th scope="row">{HANDOVER_LABEL[kind]}</th><td>{rangesLabel(store.profile!.handover[kind])}</td></tr>)}</tbody>
                    </table>
                  ) : null}
                  {zones.length > 0 ? <p><strong>Zonas de entrega:</strong> {zones.join(", ")}. El flete se cotiza con tu pedido.</p> : null}
                  {store.profile && locationLine(store.profile) ? <p><strong>Retiro en:</strong> {locationLine(store.profile)}</p> : null}
                </div>
              </details>
            ) : null}
          </div>

          {complement.length > 0 ? (
            <section className="cp-section" aria-labelledby="ambiente" data-testid="related">
              <div className="cp-section-head">
                <p className="cp-eyebrow">Combiná</p>
                <h2 id="ambiente" className="cp-h2">Completá el ambiente</h2>
              </div>
              <ul className="cp-rail">{complement.map(mini)}</ul>
            </section>
          ) : null}
          {others.length > 0 ? (
            <section className="cp-section" aria-labelledby="otros" data-testid="related-others">
              <div className="cp-section-head">
                <h2 id="otros" className="cp-h2">Otros: {sector}</h2>
              </div>
              <ul className="cp-rail">{others.map(mini)}</ul>
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
        zones={zones}
      />
      {whatsapp ? <StoreWhatsappFloat href={whatsapp} /> : null}
    </StoreChrome>
  );
}
