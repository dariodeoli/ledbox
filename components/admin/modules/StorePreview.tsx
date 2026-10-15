"use client";

import { COVER_ASPECT, type Appearance, appearanceView, type CoverKind } from "@/lib/appearance";
import { storefrontTheme } from "@/lib/storefront-theme";
import { StoreChrome } from "../../catalog-public/StoreChrome";

/**
 * Vista previa en vivo de la tienda con la apariencia que se está editando (antes de guardar).
 * Usa **las mismas clases y tokens CSS** que la tienda real (`.cp-*`), así que lo que se ve acá es lo que
 * verá el cliente: plantilla, tipografía, color, fondo y el recorte real de la portada (la caja tiene
 * la proporción de cada dispositivo y la imagen la cubre). El contenido es de ejemplo y está rotulado.
 */
export function StorePreview({
  frame,
  appearance,
  brandColor,
  name,
  coverSrc,
}: {
  frame: "desktop" | "mobile";
  appearance: Appearance;
  brandColor: string | null;
  name: string;
  coverSrc: string | null;
}) {
  const view = appearanceView(appearance);
  const theme = storefrontTheme(brandColor);
  const initials = (name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("") || "·").toUpperCase();
  const kind: CoverKind = frame;
  return (
    <div className="cp-root cp-preview" data-frame={frame} data-testid={`store-preview-${frame}`} role="img" aria-label={`Vista previa de la tienda en ${frame === "desktop" ? "escritorio" : "celular"}`}>
      <StoreChrome theme={theme} appearance={view}>
        <div className="cp-nav cp-nav--static">
          <div className="cp-nav-inner">
            <span className="cp-brand"><span className="cp-mono" aria-hidden="true">{initials}</span><span className="cp-brand-name">{name || "Tu empresa"}</span></span>
            <span className="cp-nav-links" aria-hidden="true"><a>Catálogo</a><a>Cómo funciona</a></span>
          </div>
        </div>
        <div className="cp-main">
          {coverSrc ? (
            <div className="cp-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverSrc} alt="" style={{ aspectRatio: COVER_ASPECT[kind] }} />
            </div>
          ) : null}
          <section className="cp-hero">
            <p className="cp-eyebrow">Tienda de alquiler</p>
            <h2 className="cp-h1">{name || "Tu empresa"}</h2>
            <p className="cp-tagline">Alquiler de equipos para tu evento.</p>
            <div className="cp-row cp-hero-actions">
              <span className="cp-btn cp-btn--primary">Ver catálogo</span>
              <span className="cp-btn">Consultar</span>
            </div>
          </section>
          <ul className="cp-grid">
            {["Equipo de ejemplo", "Otro equipo de ejemplo"].map((label) => (
              <li className="cp-item" key={label}>
                <div className="cp-photo"><span className="cp-feat-ph" aria-hidden="true">{initials}</span></div>
                <div className="cp-item-body">
                  <h3 className="cp-item-name">{label}</h3>
                  <p className="cp-price"><strong>Gs. 100.000</strong> <span>por día</span></p>
                  <p><span className="cp-chip cp-chip--ok">Disponible</span></p>
                  <span className="cp-btn cp-btn--block">Agregar al pedido</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </StoreChrome>
    </div>
  );
}
