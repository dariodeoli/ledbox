"use client";

import "../../../app/tienda.css";
import { appearanceView, type Appearance } from "@/lib/appearance";
import { THEMES } from "@/lib/storefront-templates";
import { categoryDatum, formatGs, priceUnitLabel } from "@/lib/storefront-ui";
import { ProductPlaceholder, XIcon } from "../../catalog-public/StoreIcons";
import { StoreChrome } from "../../catalog-public/StoreChrome";

/**
 * Vista previa en vivo de la tienda con la apariencia que se está editando (antes de guardar). Usa **las mismas clases y
 * tokens CSS** que la tienda real (`.cp-*`, `--color-*`…): plantilla, color primario, tipografía de títulos, barra de anuncio,
 * frase y modo de precio. El contenido es de ejemplo y está rotulado. Con `size="thumb"` es la miniatura de la tarjeta de
 * plantilla (la misma página, reducida): se ve exactamente lo que el cliente va a ver.
 */
export function StorePreview({
  frame,
  appearance,
  brandColor,
  name,
  coverSrc,
  tagline,
  size = "full",
}: {
  frame: "desktop" | "mobile";
  appearance: Appearance;
  brandColor: string | null;
  name: string;
  coverSrc: string | null;
  tagline?: string | null;
  size?: "full" | "thumb";
}) {
  const view = appearanceView(appearance, brandColor);
  const layout = THEMES[appearance.template].layout;
  const shownName = name || "Tu empresa";
  const photoHero = layout.hero === "photo" && Boolean(coverSrc);
  const showPrices = appearance.priceMode !== "quote";
  const mobile = frame === "mobile" || size === "thumb";
  const unitText = priceUnitLabel(appearance.priceMode, "PER_DAY", null);
  const examples = [
    { name: "Producto de ejemplo", price: 250000, capacity: "8 personas" },
    { name: "Otro producto de ejemplo", price: 120000, capacity: null },
  ];
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
      <div className="cp-page">
        <section className="cp-hero" data-cover={coverSrc ? "yes" : "no"}>
          {coverSrc ? (
            <div className="cp-hero-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverSrc} alt="" />
            </div>
          ) : null}
          <div className="cp-hero-inner">
            <div className="cp-hero-copy">
              <p className="cp-eyebrow">Tienda de alquiler</p>
              <h2 className="cp-h1">{tagline || "Alquiler para tu próximo evento"}</h2>
              <p className="cp-hero-sub">Elegí lo que necesitás y te respondemos con una cotización.</p>
              <div className="cp-hero-actions">
                <span className={photoHero ? "cp-btn cp-btn--lg cp-btn--on-image" : "cp-btn cp-btn--lg cp-btn--primary"}>Ver catálogo</span>
                <span className={photoHero ? "cp-btn cp-btn--lg cp-btn--ghost-image" : "cp-btn cp-btn--lg"}>Cómo funciona</span>
              </div>
            </div>
          </div>
        </section>
        <div className="cp-container cp-preview-body">
          <div className="cp-catgrid">
            {["Categoría de ejemplo", "Otra categoría"].map((label) => (
              <span className="cp-catcard" key={label}>
                <span className="cp-catcard-media"><ProductPlaceholder size={36} /></span>
                <span className="cp-catcard-body">
                  <span className="cp-catcard-name">{label}</span>
                  <span className="cp-catcard-datum">{categoryDatum({ count: 12, minUnit: 45000 }, showPrices, appearance.priceMode)}</span>
                </span>
              </span>
            ))}
          </div>
          <ul className="cp-grid">
            {examples.map((example) => (
              <li className="cp-tile" key={example.name}>
                <div className="cp-tile-media">
                  <ProductPlaceholder />
                  {example.capacity ? <span className="cp-tile-badge"><XIcon name="users" size={14} />{example.capacity}</span> : null}
                </div>
                <div className="cp-tile-body">
                  <p className="cp-tile-meta">COD #101 · Ejemplo</p>
                  <h3 className="cp-tile-name">{example.name}</h3>
                  <div className="cp-tile-foot">
                    <div className="cp-tile-price">
                      {showPrices ? <><span className="cp-price">{formatGs(example.price)}</span><span className="cp-price-unit">{unitText}</span></> : <span className="cp-price-unit">A cotizar</span>}
                    </div>
                    <span className="cp-btn cp-tile-add"><XIcon name="plus" size={16} />Agregar</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </StoreChrome>
  );
  if (size === "thumb") {
    return (
      <div className="cp-root cp-thumb" data-testid={`store-thumb-${appearance.template}`} aria-hidden="true" inert>
        <div className="cp-thumb-scale">{body}</div>
      </div>
    );
  }
  return (
    <div className="cp-root cp-preview" data-frame={mobile ? "mobile" : "desktop"} data-testid={`store-preview-${frame}`} role="img" aria-label={`Vista previa de la tienda en ${frame === "desktop" ? "escritorio" : "celular"}, con datos de ejemplo`}>
      {body}
    </div>
  );
}
