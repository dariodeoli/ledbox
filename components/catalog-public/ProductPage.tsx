import { PREORDER_RESPONSE_HOURS, catalogLine, catalogTierHints, preorderWhatsappUrl } from "@/lib/catalog-public";
import type { ProductDetail } from "@/lib/server/catalog-product";
import type { PublicStorefront } from "@/lib/server/catalog-public";
import { ProductAdd } from "./ProductAdd";
import { locationLine } from "@/lib/org-profile";
import { StoreFooter, StoreWhatsappFloat, storeFooterLinks } from "./StoreFooter";
import { StoreHeader, storeNavLinks } from "./StoreHeader";
import { StoreChrome } from "./StoreChrome";

/**
 * Ficha de producto de la tienda: foto grande, código, nombre, tabla de datos (precio, escalones, capacidad, medidas, incluye con
 * mini-foto y descripción), «Agregar al pedido» con cantidad y «Te puede interesar». Todo con los tokens de la plantilla. Componente de servidor.
 */

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;
const codeOf = (sku: string) => `COD #${sku.replace(/^cod\s*#?\s*/i, "")}`;

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
};

function unitText(mode: string | undefined): string {
  return mode === "EVENT" ? "por evento" : "por día";
}

export function ProductPage({ store, detail, showPrices, basePath, scope, cartPath, wholesale = false }: Props) {
  const { item, includes, related } = detail;
  const unit = item.price ? catalogLine(item.price, 1) : null;
  const tiers = showPrices ? catalogTierHints(item.price) : [];
  const whatsapp = preorderWhatsappUrl(store.whatsappPhone, `Hola ${store.name}! Consulto por ${item.name}${item.sku ? ` (${codeOf(item.sku)})` : ""}.`);
  const specs = (item.description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasContact = Boolean(whatsapp || store.email || store.profile);
  const nav = storeNavLinks(basePath, { contact: hasContact });
  const fichaOf = (id: string) => `${basePath}/p/${encodeURIComponent(id)}`;
  return (
    <StoreChrome theme={store.theme} appearance={store.appearance}>
      <StoreHeader name={store.name} slug={store.slug} logos={store.logos} homeHref={basePath} nav={nav} cart={{ href: `${basePath}#catalogo` }} />
      <main className="cp-main cp-ficha" data-testid="product-page">
        <div className="cp-ficha-grid">
          <div className="cp-ficha-photo">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt={item.name} />
            ) : (
              <span className="cp-feat-ph" aria-hidden="true">{item.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="cp-ficha-info">
            <p className="cp-x-chips">
              <span className="cp-x-chip cp-x-chip--cod">{item.sku ? codeOf(item.sku) : "Sin código"}</span>
              <span className="cp-x-chip">{includes.length > 0 ? "Juego" : item.category.split("›")[0].trim()}</span>
              {wholesale ? <span className="cp-x-chip">Mayorista</span> : null}
            </p>
            <h1 className="cp-h1 cp-ficha-name">{item.name}</h1>
            {item.capacity ? <p><span className="cp-x-cap">{item.capacity} {item.capacity === 1 ? "persona" : "personas"}</span></p> : null}
            {showPrices ? (
              <div className="cp-x-pricebox cp-ficha-price">
                {unit && unit.unitPrice > 0 ? (
                  <span className="cp-x-pricetext"><span className="cp-ed-tag">{money(unit.unitPrice)}</span><span className="cp-ed-unit">{unitText(unit.mode)}</span></span>
                ) : (
                  <span className="cp-ed-unit">Consultar precio</span>
                )}
              </div>
            ) : null}
            <table className="cp-datatable" aria-label="Datos del producto">
              <tbody>
                {showPrices && unit && unit.unitPrice > 0 ? <tr><th scope="row">Precio de lista</th><td>{money(unit.unitPrice)} {unitText(unit.mode)}</td></tr> : null}
                {tiers.length > 0 ? <tr><th scope="row">Escalones por días</th><td><ul className="cp-plain">{tiers.map((hint) => <li key={hint}>{hint}</li>)}</ul></td></tr> : null}
                {item.dimensions ? <tr><th scope="row">Medidas</th><td>{item.dimensions}</td></tr> : null}
                {item.capacity ? <tr><th scope="row">Capacidad</th><td>{item.capacity} {item.capacity === 1 ? "persona" : "personas"}</td></tr> : null}
                <tr><th scope="row">Disponibilidad</th><td>Elegí las fechas en el catálogo para ver la disponibilidad indicativa. La confirmamos al cotizar.</td></tr>
              </tbody>
            </table>
            <ProductAdd itemId={item.id} name={item.name} slug={store.slug} scope={scope} cartPath={cartPath} backHref={basePath} />
            <p className="cp-hint">Un pedido no es una reserva: te respondemos en hasta {PREORDER_RESPONSE_HOURS} horas hábiles con la cotización.</p>
            {whatsapp ? <a className="cp-btn" href={whatsapp} target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a> : null}
          </div>
        </div>

        {includes.length > 0 ? (
          <section className="cp-section" aria-labelledby="incluye">
            <h2 id="incluye" className="cp-h2 cp-h2--lg">Incluido en el alquiler</h2>
            <ul className="cp-includes-grid">
              {includes.map((part) => (
                <li key={part.name} className="cp-include">
                  <span className="cp-cart-thumb" aria-hidden="true">
                    {part.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={part.imageUrl} alt="" loading="lazy" />
                    ) : null}
                  </span>
                  <span><strong>{part.quantity} × {part.name}</strong>{part.sku ? <small className="cp-hint"> {codeOf(part.sku)}</small> : null}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {specs.length > 0 ? (
          <section className="cp-section" aria-labelledby="descripcion">
            <h2 id="descripcion" className="cp-h2 cp-h2--lg">Descripción</h2>
            <div className="cp-pre">{specs.join("\n")}</div>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section className="cp-section" aria-labelledby="interesar" data-testid="related">
            <h2 id="interesar" className="cp-h2 cp-h2--lg">Te puede interesar</h2>
            <ul className="cp-grid cp-related">
              {related.map((entry) => {
                const price = showPrices && entry.price ? catalogLine(entry.price, 1) : null;
                return (
                  <li key={entry.id} className="cp-item cp-x-item">
                    <a className="cp-photo" href={fichaOf(entry.id)} aria-label={`Ver la ficha de ${entry.name}`}>
                      {entry.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.imageUrl} alt="" loading="lazy" />
                      ) : null}
                    </a>
                    <div className="cp-item-body">
                      <div className="cp-x-chips">
                        <span className="cp-x-chip cp-x-chip--cod">{entry.sku ? codeOf(entry.sku) : "Sin código"}</span>
                        <span className="cp-x-chip">{entry.package?.length ? "Juego" : entry.category.split("›")[0].trim()}</span>
                      </div>
                      <h3 className="cp-item-name"><a className="cp-x-namelink" href={fichaOf(entry.id)}>{entry.name}</a></h3>
                      <div className="cp-x-foot">
                        <div className="cp-x-pricebox">
                          {price && price.unitPrice > 0 ? <span className="cp-x-pricetext"><span className="cp-ed-tag">{money(price.unitPrice)}</span><span className="cp-ed-unit">{unitText(price.mode)}</span></span> : <span className="cp-ed-unit">Consultar precio</span>}
                        </div>
                        <a className="cp-btn" href={fichaOf(entry.id)}>Ver ficha</a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </main>
      <StoreFooter name={store.name} tagline={store.tagline} location={store.profile ? locationLine(store.profile) : null} whatsappUrl={whatsapp} email={store.email} links={storeFooterLinks(nav)} />
      {whatsapp ? <StoreWhatsappFloat href={whatsapp} /> : null}
    </StoreChrome>
  );
}
