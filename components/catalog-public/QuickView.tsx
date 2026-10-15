"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { capacityText, cardSpecs } from "@/lib/catalog-card";
import type { ProductDetail } from "@/lib/server/catalog-product";
import type { CatalogItemView } from "./CatalogBrowser";
import { skuLabel } from "./ProductTile";
import { ProductPlaceholder, XIcon } from "./StoreIcons";
import { Stepper } from "./Stepper";
import { QuickViewSkeleton } from "./StoreSkeletons";
import { formatGs, MAX_QUANTITY } from "@/lib/storefront-ui";
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
  /** De a cuánto sube la cantidad (10 en las piezas «c/u»). */
  step?: number;
  onAdd: (id: string, quantity: number) => void;
  onNavigate: (id: string) => void;
  onClose: () => void;
};

const money = formatGs;

type Loaded = { state: "loading" } | { state: "error" } | { state: "ok"; detail: ProductDetail };

export function QuickView({ item, items, showPrices, priceOf, productApi, fichaHref, inCart, step = 1, onAdd, onNavigate, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useModalBehavior(panel, onClose, { initialFocus: closeButton });

  const cache = useRef(new Map<string, ProductDetail>());
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [quantity, setQuantity] = useState(step);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    setQuantity(step);
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
  }, [item.id, productApi, step]);

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
          <button type="button" ref={closeButton} className="cp-btn cp-btn--icon cp-btn--ghost" onClick={onClose} aria-label="Cerrar la vista rápida"><XIcon name="close" size={20} /></button>
        </header>
        <div className="cp-qv-body" ref={body}>
          <div className="cp-qv-main">
            <div className="cp-qv-photo">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.name} />
              ) : (
                <ProductPlaceholder size={56} />
              )}
            </div>
            <div className="cp-qv-info">
              <p className="cp-panel-meta">{item.sku ? skuLabel(item.sku) : "Sin código"} · {isPackage ? "Juego" : item.category.split("›")[0].trim()}</p>
              <h2 id="qv-titulo" className="cp-qv-name">{item.name}</h2>
              {specs.dimensions || specs.capacity ? (
                <ul className="cp-plain">
                  {specs.dimensions ? <li className="cp-hint"><XIcon name="ruler" size={14} /> Medidas: {specs.dimensions}</li> : null}
                  {specs.capacity ? <li className="cp-hint"><XIcon name="users" size={14} /> Capacidad: {capacityText(specs.capacity)}</li> : null}
                </ul>
              ) : null}
              <div className="cp-qv-price">
                {showPrices && price.unit > 0 ? (
                  <span className="cp-panel-price"><span className="cp-price-lg">{money(price.unit)}</span><span className="cp-price-unit">{price.unitText}</span></span>
                ) : (
                  <span className="cp-price-unit">{showPrices ? "Consultar precio" : "A cotizar"}</span>
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
                  <h3 id="qv-incluye" className="cp-qv-h">Incluye</h3>
                  <ul className="cp-checks" data-testid="quick-includes">
                    {detail.includes.map((part) => (
                      <li key={`${part.name}-${part.sku ?? ""}`}>
                        <XIcon name="check" size={16} />
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
              {loaded.state === "loading" ? <><QuickViewSkeleton /><span className="cp-sr" role="status">Cargando piezas y opciones similares…</span></> : null}
              {loaded.state === "error" ? <p className="cp-hint" role="status">No pudimos cargar las piezas y las opciones similares. Probá abrir la página del producto.</p> : null}
              {fichaHref ? <a className="cp-link cp-qv-open" href={fichaHref}>Ver la ficha completa</a> : null}
            </div>
          </div>
          {similar.length > 0 ? (
            <aside className="cp-qv-side cp-qv-sec" aria-labelledby="qv-similares" data-testid="quick-similar">
              <h3 id="qv-similares" className="cp-qv-h">Opciones similares</h3>
              <ul className="cp-rail">
                {similar.map((entry) => {
                  const entryPrice = priceOf(entry);
                  return (
                    <li key={entry.id}>
                      <div className="cp-mini">
                        <button type="button" className="cp-mini-open" onClick={() => onNavigate(entry.id)} aria-label={`Ver ${entry.name}`} />
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
                          <span className="cp-hint">{showPrices && entryPrice.unit > 0 ? `${money(entryPrice.unit)} ${entryPrice.unitText}` : "Consultar precio"}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}
        </div>
        <footer className="cp-qv-foot">
          <Stepper label={item.name} value={quantity} step={step} min={step} max={MAX_QUANTITY} onChange={setQuantity} />
          <button type="button" className="cp-btn cp-btn--primary cp-btn--lg cp-qv-add" onClick={add}>Agregar al pedido</button>
          <p className="cp-qv-note" role="status">
            {added > 0 ? `Agregaste ${added} ${added === 1 ? "unidad" : "unidades"}. En tu pedido: ${inCart}.` : inCart > 0 ? `Ya tenés ${inCart} en tu pedido.` : "Un pedido no es una reserva: te respondemos con la cotización."}
          </p>
        </footer>
      </div>
    </div>
  );
}
