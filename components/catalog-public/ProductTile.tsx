import { AVAILABILITY_HINT_LABEL, type AvailabilityHint } from "@/lib/catalog-public";
import { capacityText, type CardSpecs } from "@/lib/catalog-card";
import { MAX_QUANTITY, formatGs } from "@/lib/storefront-ui";
import type { CatalogItemView } from "./CatalogBrowser";
import { ProductPlaceholder, XIcon } from "./StoreIcons";
import { Stepper } from "./Stepper";

/**
 * Tarjeta de producto de la tienda. Orden fijo y sin huecos: foto (con el badge de capacidad encima) → código y categoría
 * (texto chico) → nombre (2 líneas) → dato clave de una línea (piezas del juego o medidas) → precio sin caja → acción.
 * La tarjeta ENTERA abre la vista rápida (un enlace estirado, que también sirve sin JavaScript); el único botón es
 * «+ Agregar» (o, en piezas que se cobran «c/u», un selector de a 10). Sin «Ver más», sin descripción ni «Incluye» (viven en
 * la vista rápida) y sin reservar espacio para lo que no existe: el pie queda anclado abajo. Componente puro.
 */

/** `COD #527` a partir del SKU (sin repetir «COD» si el SKU ya lo trae). */
export const skuLabel = (sku: string) => `COD #${sku.replace(/^cod\s*#?\s*/i, "")}`;

export type TileProps = {
  item: CatalogItemView;
  specs: CardSpecs;
  isPackage: boolean;
  showPrices: boolean;
  /** «Por unidad» (c/u) en el modo de precio de la empresa. */
  perUnit: boolean;
  /** De a cuánto sube la cantidad (10 en «c/u»). */
  step: number;
  unit: number;
  unitText: string;
  /** Solo en combos con ahorro real: ahorro y suma de las piezas por separado. */
  saving: { savings: number; unitSum: number } | null;
  tierHint: string | null;
  /** Texto de las piezas del juego (composición), una línea. */
  pieces: string | null;
  quantity: number;
  /** Enlace a la ficha (`<base>/p/<id>`): sirve sin JavaScript; con JavaScript abre la vista rápida. */
  fichaHref: string | null;
  onOpen: (id: string) => void;
  onQuantity: (id: string, next: number) => void;
  onAdd: (id: string, quantity: number) => void;
};

export function ProductTile({ item, specs, isPackage, showPrices, perUnit, step, unit, unitText, saving, tierHint, pieces, quantity, fichaHref, onOpen, onQuantity, onAdd }: TileProps) {
  const open = (event: React.MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(item.id);
  };
  const label = `Ver ${item.name}`;
  const datum = pieces ?? specs.dimensions;
  const priced = showPrices && unit > 0;
  const low = item.availability === "LOW";
  const showStepper = quantity > 0;
  return (
    <li className="cp-tile" data-testid="catalog-item">
      {fichaHref ? (
        <a className="cp-tile-open" href={fichaHref} onClick={open} aria-label={label} />
      ) : (
        <button type="button" className="cp-tile-open" onClick={() => onOpen(item.id)} aria-label={label} />
      )}
      <div className="cp-tile-media">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <ProductPlaceholder />
        )}
        {specs.capacity ? <span className="cp-tile-badge" data-testid="catalog-capacity"><XIcon name="users" size={14} />{capacityText(specs.capacity)}</span> : null}
        {low ? <span className="cp-tile-flag">Pocas unidades</span> : null}
      </div>
      <div className="cp-tile-body">
        <p className="cp-tile-meta">{item.sku ? skuLabel(item.sku) : "Sin código"} · {isPackage ? "Juego" : item.category.split("›")[0].trim()}</p>
        <h4 className="cp-tile-name">{item.name}</h4>
        {datum ? <p className="cp-tile-datum" data-testid={pieces ? "catalog-pieces" : "catalog-dimensions"}>{datum}</p> : null}
        {item.availability && !low ? <p className="cp-tile-avail" data-tone={item.availability}>{item.stockCountStatus === "PENDING_COUNT" ? "Consultar disponibilidad · pendiente de conteo" : AVAILABILITY_HINT_LABEL[item.availability as AvailabilityHint]}</p> : null}
        {saving ? (
          <p className="cp-tile-sub" data-testid="catalog-package"><strong className="cp-tile-save" data-testid="catalog-saving">Ahorrás {formatGs(saving.savings)}</strong> · Por separado <s>{formatGs(saving.unitSum)}</s></p>
        ) : tierHint ? (
          <p className="cp-tile-sub">{tierHint}</p>
        ) : null}
        <div className="cp-tile-foot">
          <div className="cp-tile-price">
            {priced ? (
              <>
                <span className="cp-price" data-testid="catalog-price">{formatGs(unit)}</span>
                <span className="cp-price-unit">{unitText}</span>
              </>
            ) : (
              <span className="cp-price-unit">Consultar precio y disponibilidad</span>
            )}
          </div>
          <div className="cp-tile-actions">
            {showStepper ? (
              <Stepper label={item.name} value={quantity} step={step} max={MAX_QUANTITY} onChange={(next) => onQuantity(item.id, next)} />
            ) : (
              <button type="button" className="cp-btn cp-tile-add" onClick={() => onAdd(item.id, step)} aria-label={`Agregar ${item.name} al pedido`}>
                <XIcon name="plus" size={16} />{perUnit && !isPackage && step > 1 ? `Agregar ${step}` : "Agregar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
