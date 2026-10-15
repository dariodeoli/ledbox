import { catalogLine } from "@/lib/catalog-public";
import type { PriceMode } from "@/lib/appearance";
import type { PublicCatalogItem, PublicCollection } from "@/lib/server/catalog-public";
import { HOME_LIMITS, INSPIRATION_SLOTS, type HomeConfig } from "@/lib/store-home";
import { formatGs, priceUnitLabel } from "@/lib/storefront-ui";
import { ProductPlaceholder } from "./StoreIcons";

/**
 * Secciones del inicio de la tienda que dependen de lo que la empresa cargó: Destacados, bloque editorial (spec 3.8 de
 * Boutique), Colecciones e Inspiración. Todas son de servidor y puras: sin datos no se dibujan (nunca hay un bloque vacío
 * ni texto inventado). El orden y la visibilidad los decide `StoreFront` con `lib/store-home.ts`.
 */

/** «Elegí tu ambiente» con la última palabra en la tipografía manuscrita del tema (si el tema no trae una, queda la de títulos). */
function TitleWithScript({ text }: { text: string }) {
  const words = text.split(" ");
  if (words.length < 2) return <>{text}</>;
  return <>{words.slice(0, -1).join(" ")} <span className="cp-script">{words[words.length - 1]}</span></>;
}

export function FeaturedSection({ items, fichaBase, showPrices, priceMode }: { items: PublicCatalogItem[]; fichaBase: string; showPrices: boolean; priceMode: PriceMode }) {
  if (items.length === 0) return null;
  return (
    <section id="destacados" className="cp-section" aria-labelledby="destacados-titulo" data-testid="home-featured">
      <div className="cp-section-head">
        <p className="cp-eyebrow">Selección</p>
        <h2 id="destacados-titulo" className="cp-h2">Destacados</h2>
      </div>
      <ul className="cp-featgrid">
        {items.map((item) => {
          const line = showPrices && item.price ? catalogLine(item.price, 1) : null;
          return (
            <li key={item.id} className="cp-feat">
              <a className="cp-feat-link" href={`${fichaBase}/p/${encodeURIComponent(item.id)}`} aria-label={`Ver ${item.name}`} />
              <span className="cp-feat-media">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" loading="lazy" />
                ) : (
                  <ProductPlaceholder size={36} />
                )}
              </span>
              <span className="cp-feat-body">
                <span className="cp-feat-cat">{item.category.split("›")[0].trim()}</span>
                <span className="cp-feat-name">{item.name}</span>
                {line && line.unitPrice > 0 ? (
                  <span className="cp-feat-price"><strong>{formatGs(line.unitPrice)}</strong> <span className="cp-price-unit">{priceUnitLabel(priceMode, line.mode, null)}</span></span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function EditorialBlock({ editorial, photo, ctaHref }: { editorial: HomeConfig["editorial"]; photo: string | null; ctaHref: string }) {
  if (!editorial.title && !editorial.text) return null;
  return (
    <section className="cp-editorial" data-photo={photo ? "yes" : "no"} aria-labelledby="editorial-titulo" data-testid="home-editorial">
      {photo ? (
        <div className="cp-editorial-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" loading="lazy" />
        </div>
      ) : null}
      <div className="cp-editorial-copy">
        {editorial.eyebrow ? <p className="cp-eyebrow">{editorial.eyebrow}</p> : null}
        {editorial.title ? <h2 id="editorial-titulo" className="cp-h2"><TitleWithScript text={editorial.title} /></h2> : null}
        {editorial.text ? <p className="cp-editorial-text">{editorial.text}</p> : null}
        <a className="cp-btn cp-btn--lg cp-btn--on-image" href={ctaHref}>{editorial.cta || "Ver el catálogo"}</a>
      </div>
    </section>
  );
}

export function CollectionsSection({ collections, items, base }: { collections: PublicCollection[]; items: PublicCatalogItem[]; base: string }) {
  if (collections.length === 0) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <section id="colecciones" className="cp-section" aria-labelledby="colecciones-titulo" data-testid="home-collections">
      <div className="cp-section-head">
        <p className="cp-eyebrow">Ambientes</p>
        <h2 id="colecciones-titulo" className="cp-h2">Colecciones</h2>
        <p className="cp-lead">Productos pensados para combinar entre sí.</p>
      </div>
      <ul className="cp-colgrid">
        {collections.map((collection) => {
          // Sin foto de ambientación se usa la del primer producto que tenga: nunca una imagen inventada.
          const productPhoto = collection.imageUrl ? null : collection.itemIds.map((id) => byId.get(id)?.imageUrl).find(Boolean) ?? null;
          const cover = collection.imageUrl ?? productPhoto;
          return (
            <li key={collection.id}>
              <a className="cp-colcard" href={`${base}/c/${encodeURIComponent(collection.slug)}`} data-testid="collection-card" data-media={productPhoto ? "product" : "photo"}>
                <span className="cp-colcard-media">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" loading="lazy" />
                  ) : (
                    <ProductPlaceholder size={44} />
                  )}
                </span>
                <span className="cp-colcard-body">
                  <span className="cp-colcard-name">{collection.name}</span>
                  <span className="cp-catcard-datum">{collection.itemIds.length === 1 ? "1 producto" : `${collection.itemIds.length} productos`}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function InspirationSection({ inspiration, photos, instagram }: { inspiration: HomeConfig["inspiration"]; photos: Array<string | null>; instagram: string | null }) {
  const shown = Array.from({ length: INSPIRATION_SLOTS }, (_, index) => ({ src: photos[index] ?? null, caption: (inspiration.captions[index] ?? "").slice(0, HOME_LIMITS.caption) })).filter((entry) => entry.src);
  if (shown.length === 0) return null;
  return (
    <section id="inspiracion" className="cp-section" aria-labelledby="inspiracion-titulo" data-testid="home-inspiration">
      <div className="cp-section-head">
        <p className="cp-eyebrow">Inspiración</p>
        <h2 id="inspiracion-titulo" className="cp-h2">{inspiration.title || "Ideas para tu evento"}</h2>
      </div>
      <ul className="cp-inspo" data-count={shown.length}>
        {shown.map((entry, index) => (
          <li key={index} className="cp-inspo-item">
            <span className="cp-inspo-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={entry.src!} alt={entry.caption || "Ambientación de la empresa"} loading="lazy" />
            </span>
            {entry.caption ? <span className="cp-inspo-caption">{entry.caption}</span> : null}
          </li>
        ))}
      </ul>
      {instagram ? <p><a className="cp-link" href={`https://instagram.com/${instagram}`} target="_blank" rel="noopener noreferrer">Más ideas en @{instagram}</a></p> : null}
    </section>
  );
}
