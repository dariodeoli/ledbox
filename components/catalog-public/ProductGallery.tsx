"use client";

import { useRef, useState } from "react";
import { ProductPlaceholder, XIcon } from "./StoreIcons";
import { ThemePortal, useModalBehavior } from "./ThemePortal";

/**
 * Galería de la ficha: foto 1:1 sobre fondo limpio (`contain`), zoom en una ventana, miniaturas solo si hay más de una foto
 * (con una sola, sin miniaturas), puntos en móvil y la nota «Imagen referencial». Hoy el producto tiene una sola foto; el
 * componente ya recibe una lista para cuando haya varias.
 */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const current = images[index] ?? null;
  return (
    <div className="cp-gallery" data-testid="product-gallery">
      <div className="cp-gallery-main">
        {current ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current} alt={name} />
            <button type="button" className="cp-gallery-zoom" onClick={() => setZoom(true)} aria-label={`Ampliar la foto de ${name}`} />
          </>
        ) : (
          <ProductPlaceholder size={72} label={`${name}: todavía sin foto`} />
        )}
      </div>
      {images.length > 1 ? (
        <>
          <div className="cp-gallery-thumbs" role="group" aria-label="Fotos del producto">
            {images.map((src, position) => (
              <button key={src} type="button" className="cp-gallery-thumb" aria-current={position === index} aria-label={`Ver la foto ${position + 1} de ${images.length}`} onClick={() => setIndex(position)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          <div className="cp-gallery-dots" aria-hidden="true">{images.map((src, position) => <span key={src} aria-current={position === index} />)}</div>
        </>
      ) : null}
      {current ? <p className="cp-gallery-ref">Imagen referencial</p> : null}
      {zoom && current ? (
        <ThemePortal>
          <ZoomDialog src={current} name={name} onClose={() => setZoom(false)} />
        </ThemePortal>
      ) : null}
    </div>
  );
}

function ZoomDialog({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useModalBehavior(panel, onClose, { initialFocus: close });
  return (
    <div className="cp-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-zoom" role="dialog" aria-modal="true" aria-label={`Foto ampliada de ${name}`} ref={panel} tabIndex={-1}>
        <button type="button" ref={close} className="cp-btn cp-btn--icon" onClick={onClose} aria-label="Cerrar la foto"><XIcon name="close" size={20} /></button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} />
      </div>
    </div>
  );
}
