"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { capacityText, cardSpecs } from "@/lib/catalog-card";
import type { ProductDetail } from "@/lib/server/catalog-product";
import type { CatalogItemView } from "./CatalogBrowser";
import { skuLabel } from "./ProductTile";
import { XIcon } from "./StoreIcons";
import { useModalBehavior } from "./ThemePortal";

/**
 * Vista rápida de un producto (popup accesible): la ficha completa (foto grande, código, nombre, precio con escalones,
 * medidas, capacidad, «Incluye» con mini-foto, descripción y «Agregar al pedido» con cantidad) y, al lado, «Opciones
 * similares» (misma categoría y combos que lo contienen) con mini-tarjetas que cambian el contenido del popup.
 * Lo ya cargado en el catálogo se muestra al instante; «Incluye» y las opciones vienen del endpoint público de la ficha
 * (mismo DTO sin costos). El padre maneja la URL (`?p=<id>`), el botón «atrás» y el carrito.
 */

export type QuickPrice = { unit: number; unitText: string; tierHints: string[]; saving: { savings: number; unitSum: number } | null };

type Props = {
  item: CatalogItemView;
  items: CatalogItemView[];
  showPrices: boolean;
  priceOf: (item: CatalogItemView) => QuickPrice;
  /** Base del endpoint JSON de la ficha, terminada en `/product/`. */
  productApi: string;
  /** `<base>/p/<id>`: la página completa del producto. */
  fichaHref: string | null;
  /** Cantidad de este producto que ya está en el pedido. */
  inCart: number;
  onAdd: (id: string, quantity: number) => void;
  onNavigate: (id: string) => void;
  onClose: () => void;
};

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;

type Loaded = { state: "loading" } | { state: "error" } | { state: "ok"; detail: ProductDetail };

export function QuickView({ item, items, showPrices, priceOf, productApi, fichaHref, inCart, onAdd, onNavigate, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useModalBehavior(panel, onClose, { initialFocus: closeButton });

  const cache = useRef(new Map<string, ProductDetail>());
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    setQuantity(1);
    setAdded(0);
    body.current?.scrollTo({ top: 0 });
    const hit = cache.current.get(item.id);
    if (hit) { setLoaded({ state: "ok", detail: hit }); return; }
    setLoaded({ state: "loading" });
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${productApi}${encodeURIComponent(item.id)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const detail = ((await response.json()) as { detail: ProductDetail }).detail;
        cache.current.set(item.id, detail);
        setLoaded({ state: "ok", detail });
      } catch (failure) {
        if ((failure as { name?: string })?.name === "AbortError") return;
        console.error("tienda: no se pudo cargar la vista rápida del producto", failure);
        setLoaded({ state: "error" });
      }
    })();
    return () => controller.abort();
  }, [item.id, productApi]);

  const specs = useMemo(() => cardSpecs(item), [item]);
  const price = priceOf(item);
  const detail = loaded.state === "ok" ? loaded.detail : null;
  const isPackage = Boolean(item.package?.length) || Boolean(detail && detail.includes.length > 0);
  const similar = (detail?.similar ?? []).map((entry) => items.find((candidate) => candidate.id === entry.id) ?? (entry as CatalogItemView));
  const descriptionLines = (specs.description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  function add() {
    onAdd(item.id, quantity);
    setAdded((count) => count + quantity);
  }

  return (
    <div className="cp-overlay cp-overlay--qv" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-qv" role="dialog" aria-modal="true" aria-labelledby="qv-titulo" ref={panel} tabIndex={-1} data-testid="quick-view">
        <header className="cp-qv-head">
          <p className="cp-qv-kicker">Vista rápida</p>
          <button type="button" ref={closeButton} className="cp-btn cp-btn--icon" onClick={onClose} aria-label="Cerrar la vista rápida"><XIcon name="close" size={20} /></button>
        </header>
        <div className="cp-qv-body" ref={body}>
          <div className="cp-qv-main">
            <div className="cp-qv-photo">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.name} />
              ) : (
                <span className="cp-tile-ph" aria-hidden="true">{item.name.slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <div className="cp-qv-info">
              <p className="cp-x-chips">
                <span className="cp-x-chip cp-x-chip--cod">{item.sku ? skuLabel(item.sku) : "Sin código"}</span>
                <span className="cp-x-chip">{isPackage ? "Juego" : item.category.split("›")[0].trim()}</span>
              </p>
              <h2 id="qv-titulo" className="cp-qv-name">{item.name}</h2>
              {specs.dimensions || specs.capacity ? (
                <ul className="cp-tile-specs">
                  {specs.dimensions ? <li className="cp-tile-spec"><XIcon name="ruler" size={16} /><span><span className="cp-x-k">Medidas</span> {specs.dimensions}</span></li> : null}
                  {specs.capacity ? <li className="cp-tile-spec"><XIcon name="users" size={16} /><span><span className="cp-x-k">Capacidad</span> {capacityText(specs.capacity)}</span></li> : null}
                </ul>
              ) : null}
              <div className="cp-qv-price">
                {showPrices && price.unit > 0 ? (
                  <span className="cp-x-pricetext"><span className="cp-tile-amount cp-qv-amount">{money(price.unit)}</span><span className="cp-ed-unit">{price.unitText}</span></span>
                ) : (
                  <span className="cp-ed-unit">Consultar precio</span>
                )}
                {price.saving ? <p className="cp-tile-sub"><strong className="cp-tile-save">Ahorrás {money(price.saving.savings)}</strong> · Por separado <s>{money(price.saving.unitSum)}</s></p> : null}
                {showPrices && price.tierHints.length > 0 ? (
                  <ul className="cp-qv-tiers" aria-label="Escalones por días">
                    {price.tierHints.map((hint) => <li key={hint}>{hint}</li>)}
                  </ul>
                ) : null}
              </div>
              {detail && detail.includes.length > 0 ? (
                <section aria-labelledby="qv-incluye" className="cp-qv-sec">
                  <h3 id="qv-incluye" className="cp-qv-h"><XIcon name="puzzle" size={16} />Incluye</h3>
                  <ul className="cp-qv-includes" data-testid="quick-includes">
                    {detail.includes.map((part) => (
                      <li key={`${part.name}-${part.sku ?? ""}`} className="cp-include">
                        <span className="cp-cart-thumb" aria-hidden="true">
                          {part.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={part.imageUrl} alt="" loading="lazy" />
                          ) : null}
                        </span>
                        <span><strong>{part.quantity} × {part.name}</strong>{part.sku ? <small className="cp-hint"> {skuLabel(part.sku)}</small> : null}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {descriptionLines.length > 0 ? (
                <section aria-labelledby="qv-desc" className="cp-qv-sec">
                  <h3 id="qv-desc" className="cp-qv-h">Descripción</h3>
                  <div className="cp-pre">{descriptionLines.join("\n")}</div>
                </section>
              ) : null}
              {loaded.state === "loading" ? <p className="cp-hint" role="status">Cargando piezas y opciones similares…</p> : null}
              {loaded.state === "error" ? <p className="cp-hint" role="status">No pudimos cargar las piezas y las opciones similares. Probá abrir la página del producto.</p> : null}
              {fichaHref ? <a className="cp-link cp-qv-open" href={fichaHref}>Abrir página del producto</a> : null}
            </div>
          </div>
          {similar.length > 0 ? (
            <aside className="cp-qv-side" aria-labelledby="qv-similares" data-testid="quick-similar">
              <h3 id="qv-similares" className="cp-qv-h">Opciones similares</h3>
              <ul className="cp-qv-list">
                {similar.map((entry) => {
                  const entryPrice = priceOf(entry);
                  return (
                    <li key={entry.id}>
                      <button type="button" className="cp-qv-mini" onClick={() => onNavigate(entry.id)} aria-label={`Ver ${entry.name}`}>
                        <span className="cp-qv-mini-photo" aria-hidden="true">
                          {entry.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.imageUrl} alt="" loading="lazy" />
                          ) : (
                            <span className="cp-tile-ph">{entry.name.slice(0, 2).toUpperCase()}</span>
                          )}
                        </span>
                        <span className="cp-qv-mini-text">
                          <span className="cp-qv-mini-name">{entry.name}</span>
                          <span className="cp-qv-mini-price">{showPrices && entryPrice.unit > 0 ? `${money(entryPrice.unit)} ${entryPrice.unitText}` : "Consultar precio"}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}
        </div>
        <footer className="cp-qv-foot">
          <div className="cp-qty" role="group" aria-label={`Cantidad de ${item.name}`}>
            <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Quitar una unidad">−</button>
            <output aria-live="polite">{quantity}</output>
            <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="Agregar una unidad">+</button>
          </div>
          <button type="button" className="cp-btn cp-btn--primary cp-qv-add" onClick={add}>Agregar al pedido</button>
          <p className="cp-qv-note" role="status">
            {added > 0 ? `Agregaste ${added} ${added === 1 ? "unidad" : "unidades"}. En tu pedido: ${inCart}.` : inCart > 0 ? `Ya tenés ${inCart} en tu pedido.` : "Un pedido no es una reserva: te respondemos con la cotización."}
          </p>
        </footer>
      </div>
    </div>
  );
}
