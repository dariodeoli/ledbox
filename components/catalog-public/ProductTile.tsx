import { AVAILABILITY_HINT_LABEL, type AvailabilityHint } from "@/lib/catalog-public";
import { capacityText, type CardSpecs } from "@/lib/catalog-card";
import type { CatalogItemView } from "./CatalogBrowser";
import { XIcon } from "./StoreIcons";

/**
 * Tarjeta compacta de producto de la tienda. De arriba hacia abajo: foto cuadrada, chips (código y categoría o «Juego»),
 * nombre (hasta 2 líneas), chips con icono de medidas y capacidad (solo si existen), precio compacto, estado y botones.
 * SIN «Incluye» ni descripción (viven en la vista rápida) y sin reservar espacio para lo que no existe: la altura la marca
 * la tarjeta más alta de la fila y el precio con los botones quedan anclados abajo (`margin-top: auto`).
 * Componente puro (sin estado): lo dibuja `CatalogBrowser`.
 */

const AVAILABILITY_TONE: Record<AvailabilityHint, string> = { AVAILABLE: "cp-chip--ok", LOW: "cp-chip--warn", CONSULT: "cp-chip--muted" };
const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;

/** `COD #527` a partir del SKU (sin repetir «COD» si el SKU ya lo trae). */
export const skuLabel = (sku: string) => `COD #${sku.replace(/^cod\s*#?\s*/i, "")}`;

export type TileProps = {
  item: CatalogItemView;
  specs: CardSpecs;
  isPackage: boolean;
  showPrices: boolean;
  unit: number;
  unitText: string;
  /** Solo en combos con ahorro real: ahorro y suma de las piezas por separado. */
  saving: { savings: number; unitSum: number } | null;
  tierHint: string | null;
  quantity: number;
  /** Enlace a la ficha (`<base>/p/<id>`): sirve sin JavaScript; con JavaScript abre la vista rápida. */
  fichaHref: string | null;
  onOpen: (id: string) => void;
  onQuantity: (id: string, next: number) => void;
};

export function ProductTile({ item, specs, isPackage, showPrices, unit, unitText, saving, tierHint, quantity, fichaHref, onOpen, onQuantity }: TileProps) {
  const open = (event: React.MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(item.id);
  };
  // `label` vacío: el texto visible ya dice qué es; `null`: duplicado decorativo (la foto), fuera del orden de tabulación.
  const opener = (className: string, label: string | null, children: React.ReactNode) => {
    const extra = label === null ? { "aria-hidden": true as const, tabIndex: -1 } : label ? { "aria-label": label } : {};
    return fichaHref ? (
      <a className={className} href={fichaHref} onClick={open} {...extra}>{children}</a>
    ) : (
      <button type="button" className={className} onClick={() => onOpen(item.id)} {...extra}>{children}</button>
    );
  };
  return (
    <li className="cp-item cp-x-item cp-tile" data-testid="catalog-item">
      {opener("cp-photo cp-tile-photo", null, item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="cp-tile-ph" aria-hidden="true">{item.name.slice(0, 2).toUpperCase()}</span>
      ))}
      <div className="cp-item-body">
        <div className="cp-x-chips">
          <span className="cp-x-chip cp-x-chip--cod">{item.sku ? skuLabel(item.sku) : "Sin código"}</span>
          <span className="cp-x-chip">{isPackage ? "Juego" : item.category.split("›")[0].trim()}</span>
        </div>
        <h4 className="cp-item-name">{opener("cp-x-namelink", "", item.name)}</h4>
        {specs.dimensions || specs.capacity ? (
          <ul className="cp-tile-specs" aria-label="Medidas y capacidad">
            {specs.dimensions ? <li className="cp-tile-spec" data-testid="catalog-dimensions"><XIcon name="ruler" size={16} /><span><span className="cp-x-k">Medidas</span> {specs.dimensions}</span></li> : null}
            {specs.capacity ? <li className="cp-tile-spec" data-testid="catalog-capacity"><XIcon name="users" size={16} /><span><span className="cp-x-k">Capacidad</span> {capacityText(specs.capacity)}</span></li> : null}
          </ul>
        ) : null}
        <div className="cp-tile-foot">
          <div className="cp-tile-price">
            <div className="cp-tile-pricerow">
              {showPrices && unit > 0 ? (
                <span className="cp-x-pricetext"><span className="cp-tile-amount">{money(unit)}</span><span className="cp-ed-unit">{unitText}</span></span>
              ) : (
                <span className="cp-ed-unit">Consultar precio</span>
              )}
              {item.availability ? <span className={`cp-chip cp-tile-status ${AVAILABILITY_TONE[item.availability]}`}>{AVAILABILITY_HINT_LABEL[item.availability]}</span> : null}
            </div>
            {saving ? (
              <p className="cp-tile-sub" data-testid="catalog-package"><strong className="cp-tile-save" data-testid="catalog-saving">Ahorrás {money(saving.savings)}</strong> · Por separado <s>{money(saving.unitSum)}</s></p>
            ) : tierHint ? (
              <p className="cp-tile-sub">{tierHint}</p>
            ) : null}
          </div>
          <div className="cp-tile-actions">
            {quantity > 0 ? (
              <div className="cp-qty" role="group" aria-label={`Cantidad de ${item.name}`}>
                <button type="button" className="cp-btn cp-btn--icon" onClick={() => onQuantity(item.id, quantity - 1)} aria-label={`Quitar una unidad de ${item.name}`}>−</button>
                <output aria-live="polite">{quantity}</output>
                <button type="button" className="cp-btn cp-btn--icon" onClick={() => onQuantity(item.id, quantity + 1)} aria-label={`Agregar una unidad de ${item.name}`}>+</button>
              </div>
            ) : (
              <button type="button" className="cp-btn cp-btn--primary cp-tile-add" onClick={() => onQuantity(item.id, 1)} aria-label={`Agregar ${item.name} al pedido`}>
                <span className="cp-tile-add-long">Agregar al pedido</span>
                <span className="cp-tile-add-short"><XIcon name="cart" size={16} />Agregar</span>
              </button>
            )}
            {opener("cp-btn cp-tile-more", `Ver más de ${item.name}`, "Ver más")}
          </div>
        </div>
      </div>
    </li>
  );
}
