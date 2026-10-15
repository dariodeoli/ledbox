"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ProductPlaceholder, XIcon } from "./StoreIcons";
import { ThemePortal, useModalBehavior } from "./ThemePortal";

/**
 * Galería de la ficha y de la vista rápida. Una pista horizontal con `scroll-snap`: en el celular se desliza con el dedo
 * (carrusel con puntos), en escritorio se elige con las miniaturas (a la izquierda del cuadro grande, o debajo en la
 * vista rápida). Un click en la foto la amplía en una ventana con flechas y teclado. Con una sola foto no hay miniaturas
 * ni puntos; sin ninguna, un marcador neutro. La primera foto es la principal del producto.
 */
export function ProductGallery({ images, name, compact = false }: { images: string[]; name: string; compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const count = images.length;

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    setIndex(clamped);
    const node = track.current;
    if (node) node.scrollTo({ left: clamped * node.clientWidth, behavior: "smooth" });
  }, [count]);

  // El dedo mueve la pista: el índice sale de dónde quedó.
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (node.clientWidth > 0) setIndex(Math.max(0, Math.min(count - 1, Math.round(node.scrollLeft / node.clientWidth))));
      });
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); node.removeEventListener("scroll", onScroll); };
  }, [count]);

  const onKey = (event: KeyboardEvent) => {
    if (count < 2) return;
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
  };

  return (
    <div className="cp-gallery" data-testid="product-gallery" data-count={count} data-compact={compact ? "yes" : "no"}>
      {count > 1 ? (
        <div className="cp-gallery-thumbs" role="group" aria-label="Fotos del producto">
          {images.map((src, position) => (
            <button key={`${src}-${position}`} type="button" className="cp-gallery-thumb" aria-current={position === index} aria-label={`Ver la foto ${position + 1} de ${count}`} onClick={() => go(position)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="cp-gallery-stage">
        <div className="cp-gallery-main" ref={track} tabIndex={count > 1 ? 0 : -1} role="group" aria-roledescription="carrusel" aria-label={`Fotos de ${name}`} onKeyDown={onKey}>
          {count > 0 ? images.map((src, position) => (
            <div key={`${src}-${position}`} className="cp-gallery-slide" role="group" aria-roledescription="foto" aria-label={`${position + 1} de ${count}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={position === 0 ? name : `${name}, foto ${position + 1}`} loading={position === 0 ? "eager" : "lazy"} />
              <button type="button" className="cp-gallery-zoom" onClick={() => { setIndex(position); setZoom(true); }} aria-label={`Ampliar la foto ${position + 1} de ${name}`} />
            </div>
          )) : (
            <div className="cp-gallery-slide"><ProductPlaceholder size={72} label={`${name}: todavía sin foto`} /></div>
          )}
        </div>
        {count > 1 ? (
          <>
            <button type="button" className="cp-gallery-nav cp-gallery-nav--prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Foto anterior"><XIcon name="prev" size={20} /></button>
            <button type="button" className="cp-gallery-nav cp-gallery-nav--next" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Foto siguiente"><XIcon name="next" size={20} /></button>
          </>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="cp-gallery-dots" role="group" aria-label="Elegir foto">
          {images.map((src, position) => (
            <button key={`${src}-${position}`} type="button" aria-current={position === index} aria-label={`Foto ${position + 1} de ${count}`} onClick={() => go(position)}><span /></button>
          ))}
        </div>
      ) : null}
      {count > 0 ? <p className="cp-gallery-ref">Imagen referencial</p> : null}
      {zoom && count > 0 ? (
        <ThemePortal>
          <ZoomDialog images={images} start={index} name={name} onClose={(last) => { setZoom(false); go(last); }} />
        </ThemePortal>
      ) : null}
    </div>
  );
}

function ZoomDialog({ images, start, name, onClose }: { images: string[]; start: number; name: string; onClose: (last: number) => void }) {
  const [at, setAt] = useState(start);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const atRef = useRef(at);
  atRef.current = at;
  useModalBehavior(panel, () => onClose(atRef.current), { initialFocus: close });
  const step = (direction: -1 | 1) => setAt((current) => Math.max(0, Math.min(images.length - 1, current + direction)));
  return (
    <div className="cp-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(at); }}>
      <div
        className="cp-zoom"
        role="dialog"
        aria-modal="true"
        aria-label={`Foto ampliada de ${name}`}
        ref={panel}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          else if (event.key === "ArrowLeft") step(-1);
        }}
      >
        <button type="button" ref={close} className="cp-btn cp-btn--icon" onClick={() => onClose(at)} aria-label="Cerrar la foto"><XIcon name="close" size={20} /></button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[at]} alt={at === 0 ? name : `${name}, foto ${at + 1}`} />
        {images.length > 1 ? (
          <>
            <button type="button" className="cp-gallery-nav cp-gallery-nav--prev" onClick={() => step(-1)} disabled={at === 0} aria-label="Foto anterior"><XIcon name="prev" size={20} /></button>
            <button type="button" className="cp-gallery-nav cp-gallery-nav--next" onClick={() => step(1)} disabled={at === images.length - 1} aria-label="Foto siguiente"><XIcon name="next" size={20} /></button>
            <p className="cp-zoom-count" role="status">{at + 1} de {images.length}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
