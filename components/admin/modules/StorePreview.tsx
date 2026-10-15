"use client";

import "../../../app/tienda.css";
import type { ReactNode } from "react";
import { visibleSections, type HomeSectionId } from "@/lib/store-home";
import { CategoryAccordion } from "../../catalog-public/CategoryAccordion";
import { appearanceView, type Appearance } from "@/lib/appearance";
import { categoryDatum, formatGs, priceUnitLabel } from "@/lib/storefront-ui";
import { ProductPlaceholder, XIcon } from "../../catalog-public/StoreIcons";
import { StoreChrome } from "../../catalog-public/StoreChrome";

/** Datos ficticios de cada rubro, únicamente para distinguir las plantillas en Apariencia. */
const PREVIEW_EXAMPLES: Record<string, { categories: string[]; products: string[] }> = {
  boutique: { categories: ["Ceremonia", "Recepción"], products: ["Arco de boda de ejemplo", "Mesa de novios de ejemplo"] },
  escenario: { categories: ["Sonido", "Iluminación"], products: ["Sistema de sonido de ejemplo", "Cabezal móvil de ejemplo"] },
  corporativo: { categories: ["Conferencias", "Stands"], products: ["Atril de ejemplo", "Stand modular de ejemplo"] },
  industrial: { categories: ["Estructuras", "Generadores"], products: ["Carpa de ejemplo", "Generador de ejemplo"] },
  gourmet: { categories: ["Vajilla", "Catering"], products: ["Juego de platos de ejemplo", "Chafing de ejemplo"] },
  kids: { categories: ["Juegos", "Mobiliario infantil"], products: ["Inflable de ejemplo", "Mesa infantil de ejemplo"] },
  fiesta: { categories: ["Fiestas", "Pista y barras"], products: ["Barra de ejemplo", "Pista de baile de ejemplo"] },
};

/**
 * Vista previa en vivo de la tienda con la apariencia que se está editando (antes de guardar). Usa **las mismas clases y
 * tokens CSS** que la tienda real (`.cp-*`, `--color-*`…): plantilla, color primario, tipografía de títulos, barra de anuncio,
 * frase y modo de precio. El contenido es de ejemplo y está rotulado; el ancho se adapta al panel sin recortar sus precios ni controles.
 */
export function StorePreview({
  frame,
  appearance,
  brandColor,
  name,
  coverDesktop,
  coverMobile,
  tagline,
}: {
  frame: "desktop" | "mobile";
  appearance: Appearance;
  brandColor: string | null;
  name: string;
  coverDesktop?: string | null;
  coverMobile?: string | null;
  tagline?: string | null;
}) {
  const view = appearanceView(appearance, brandColor);
  const shownName = name || "Tu empresa";
  const mobile = frame === "mobile";
  const cover = mobile ? (coverMobile ?? coverDesktop ?? null) : (coverDesktop ?? coverMobile ?? null);
  const showPrices = appearance.priceMode !== "quote";
  const unitText = priceUnitLabel(appearance.priceMode, "PER_DAY", null);
  // Solo ejemplos rotulados del selector: elegir plantilla nunca modifica el catálogo real de la empresa.
  const niche = PREVIEW_EXAMPLES[appearance.template] ?? PREVIEW_EXAMPLES.boutique;
  const examples = niche.products.map((name, index) => ({ name, price: index === 0 ? 250000 : 120000 }));
  const home = appearance.home;
  const products = (categoryIndex?: number) => (
    <ul className="cp-grid">
            {examples.filter((_, index) => categoryIndex === undefined || index === categoryIndex).map((example) => (
              <li className="cp-tile" key={example.name}>
                <div className="cp-tile-media">
                  <ProductPlaceholder />
                </div>
                <div className="cp-tile-body">
                  <p className="cp-tile-meta">COD #101 · Ejemplo</p>
                  <h3 className="cp-tile-name">{example.name}</h3>
                  <div className="cp-tile-foot">
                    <div className="cp-tile-price">
                      {showPrices ? <><span className="cp-price">{formatGs(example.price)}</span><span className="cp-price-unit">{unitText}</span></> : <span className="cp-price-unit">A cotizar</span>}
                    </div>
                    <span className="cp-btn cp-tile-add"><XIcon name="plus" size={16} />{showPrices ? "Agregar" : "Consultar precio y disponibilidad"}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
  );
  const categories = (
    <section className="cp-section" data-testid="preview-categories" data-layout={home.categoryLayout}>
      <h2 className="cp-h2">Categorías</h2>
      {home.categoryLayout === "accordion" ? <CategoryAccordion categories={niche.categories.map((name, index) => ({ name, href: `#ejemplo-categoria-${index}`, imageUrl: null, count: 1, minUnit: examples[index].price }))}
        catalogKey={`preview-${frame}-${appearance.template}`} showPrices={showPrices} priceMode={appearance.priceMode} renderProducts={(name) => products(niche.categories.indexOf(name))} /> : (
        <div className="cp-catgrid">
            {niche.categories.map((label, index) => (
              <span className="cp-catcard" key={label}>
                <span className="cp-catcard-media"><ProductPlaceholder size={36} /></span>
                <span className="cp-catcard-body">
                  <span className="cp-catcard-name">{label}</span>
                  <span className="cp-catcard-datum">{categoryDatum({ count: 1, minUnit: examples[index].price }, showPrices, appearance.priceMode)}</span>
                </span>
              </span>
            ))}
          </div>
      )}
    </section>
  );
  const sections: Record<HomeSectionId, ReactNode> = {
    hero: (
      <section className="cp-hero cp-home-hero" data-cover={cover ? "yes" : "no"}>
          {cover ? (
            <div className="cp-hero-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover} alt="" />
            </div>
          ) : null}
          <div className="cp-hero-inner">
            <div className="cp-hero-copy">
              <p className="cp-eyebrow">Tienda de alquiler</p>
              <h2 className="cp-h1">{tagline || "Alquiler para tu próximo evento"}</h2>
              <p className="cp-hero-sub">Elegí lo que necesitás y te respondemos con una cotización.</p>
              <div className="cp-hero-actions">
                <span className="cp-btn cp-btn--lg cp-btn--primary">Ver catálogo</span>
                <span className="cp-btn cp-btn--lg">Cómo funciona</span>
              </div>
            </div>
          </div>
        </section>
    ),
    categorias: categories,
    catalogo: <section className="cp-section" data-testid="preview-catalog"><h2 className="cp-h2">Catálogo</h2>{products()}</section>,
    destacados: <section className="cp-section"><h2 className="cp-h2">Nuestra selección</h2>{products(0)}</section>,
    colecciones: <section className="cp-section"><h2 className="cp-h2">{home.editorial.title || "Colecciones"}</h2>{home.editorial.eyebrow ? <p className="cp-eyebrow">{home.editorial.eyebrow}</p> : null}{home.editorial.text ? <p className="cp-lead">{home.editorial.text}</p> : null}<span className="cp-btn">{home.editorial.cta || "Ver el catálogo"}</span></section>,
    "como-funciona": <section className="cp-section"><h2 className="cp-h2">Cómo funciona</h2><p className="cp-lead">Elegí productos, enviá tu consulta y recibí una cotización.</p></section>,
    inspiracion: <section className="cp-section"><h2 className="cp-h2">{home.inspiration.title || "Ideas para tu evento"}</h2>{home.inspiration.captions.filter(Boolean).map((caption, index) => <p className="cp-lead" key={index}>{caption}</p>)}</section>,
    contacto: <section className="cp-section"><h2 className="cp-h2">Contacto y entrega</h2><p className="cp-lead">Coordiná la disponibilidad y la entrega con {shownName}.</p></section>,
  };
  const body = (
    <StoreChrome appearance={view}>
      <div className="cp-hd" aria-hidden="true">
        <div className="cp-hd-inner">
          <div className="cp-hd-id">
            <span className="cp-eventos-stamp"><span>EventOS</span></span>
            <span className="cp-hd-sep" />
            <span className="cp-brand"><span className="cp-mono">{shownName.trim().slice(0, 1).toUpperCase() || "·"}</span><span className="cp-brand-name">{shownName}</span></span>
          </div>
          <div className="cp-hd-actions">
            <span className="cp-hd-cart"><XIcon name="bag" size={18} /><span className="cp-hd-cart-label">Pedido</span></span>
          </div>
        </div>
      </div>
      <div className="cp-page cp-preview-body">
        {visibleSections(home).map((id) => <div key={id} data-preview-section={id}>{sections[id]}</div>)}
      </div>
    </StoreChrome>
  );
  return (
    <div className="cp-root cp-preview" data-frame={mobile ? "mobile" : "desktop"} data-testid={`store-preview-${frame}`} role="region" aria-label={`Vista previa de la tienda en ${frame === "desktop" ? "escritorio" : "celular"}, con datos de ejemplo`}>
      {body}
    </div>
  );
}
