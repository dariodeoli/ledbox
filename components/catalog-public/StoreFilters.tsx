"use client";

import { useRef } from "react";
import { CheckboxField, MoneyField } from "@/components/admin/AdminFields";
import { activeFilterCount, parsePriceBound, type CapacityOption, type StoreFilters } from "@/lib/store-filters";
import { XIcon } from "./StoreIcons";
import { ThemePortal, useModalBehavior } from "./ThemePortal";

/**
 * Filtros del catálogo: capacidad, rango de precio por día, estilo o color, colección y «Disponible en mis fechas».
 * En escritorio es una barra lateral fija junto a la grilla; en el celular, un cajón que se abre con «Filtrar». Los
 * grupos que no tienen datos (ningún producto con capacidad, estilos o colecciones) no se dibujan. Presentacional: el estado vive en `CatalogBrowser`.
 */

type Props = {
  filters: StoreFilters;
  onChange: (next: StoreFilters) => void;
  capacities: CapacityOption[];
  tags: string[];
  collections: Array<{ slug: string; name: string }>;
  showPrices: boolean;
  /** Hay fechas elegidas: sin ellas no hay disponibilidad que filtrar. */
  hasRange: boolean;
  resultCount: number;
};

function Chips<T extends string>({ label, options, isOn, toggle }: { label: string; options: Array<{ key: T; label: string }>; isOn: (key: T) => boolean; toggle: (key: T) => void }) {
  return (
    <fieldset className="cp-fgroup">
      <legend className="cp-fgroup-title">{label}</legend>
      <div className="cp-fchips">
        {options.map((option) => (
          <button key={option.key} type="button" className="cp-cat" aria-pressed={isOn(option.key)} onClick={() => toggle(option.key)}>{option.label}</button>
        ))}
      </div>
    </fieldset>
  );
}

export function FiltersPanel({ filters, onChange, capacities, tags, collections, showPrices, hasRange }: Props) {
  const set = (patch: Partial<StoreFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="cp-filters-body cp-fields" data-testid="store-filters">
      {collections.length > 0 ? (
        <Chips label="Colección" options={collections.map((entry) => ({ key: entry.slug, label: entry.name }))} isOn={(key) => filters.collection === key} toggle={(key) => set({ collection: filters.collection === key ? null : key })} />
      ) : null}
      {capacities.length > 0 ? (
        <Chips label="Capacidad" options={capacities.map((entry) => ({ key: entry.key, label: entry.label }))} isOn={(key) => filters.capacity === key} toggle={(key) => set({ capacity: filters.capacity === key ? null : key })} />
      ) : null}
      {showPrices ? (
        <fieldset className="cp-fgroup">
          <legend className="cp-fgroup-title">Precio por día (Gs.)</legend>
          <div className="cp-fprice">
            <MoneyField ariaLabel="Precio desde" size="full" placeholder="Desde" value={filters.priceMin === null ? "" : String(filters.priceMin)} onChange={(value) => set({ priceMin: parsePriceBound(value) })} />
            <MoneyField ariaLabel="Precio hasta" size="full" placeholder="Hasta" value={filters.priceMax === null ? "" : String(filters.priceMax)} onChange={(value) => set({ priceMax: parsePriceBound(value) })} />
          </div>
        </fieldset>
      ) : null}
      {tags.length > 0 ? (
        <Chips label="Estilo o color" options={tags.map((tag) => ({ key: tag, label: tag }))} isOn={(key) => filters.tags.includes(key)} toggle={(key) => set({ tags: filters.tags.includes(key) ? filters.tags.filter((tag) => tag !== key) : [...filters.tags, key] })} />
      ) : null}
      <fieldset className="cp-fgroup">
        <legend className="cp-fgroup-title">Disponibilidad</legend>
        <CheckboxField text="Disponible en mis fechas" checked={filters.onlyAvailable} disabled={!hasRange} onChange={(checked) => set({ onlyAvailable: checked })} />
        {!hasRange ? <p className="cp-hint">Elegí las fechas de tu evento arriba para usar este filtro.</p> : null}
      </fieldset>
    </div>
  );
}

/** Botón «Filtrar» (solo celular) y cajón con los filtros. */
type DrawerProps = { props: Props; onClose: () => void; onClear: () => void };
export function FiltersDrawer(props: DrawerProps) {
  // The lifecycle must mount with its DOM, after ThemePortal resolves its host.
  return <ThemePortal><FiltersDrawerContent {...props} /></ThemePortal>;
}
function FiltersDrawerContent({ props, onClose, onClear }: DrawerProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useModalBehavior(dialog, onClose, { initialFocus: close });
  const active = activeFilterCount(props.filters);
  return (
      <div className="cp-overlay cp-overlay--drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="cp-drawer cp-drawer--narrow" role="dialog" aria-modal="true" aria-labelledby="filtros-titulo" ref={dialog} tabIndex={-1} data-testid="filters-drawer">
          <header className="cp-drawer-head">
            <h2 id="filtros-titulo" className="cp-drawer-title">Filtrar</h2>
            <button type="button" ref={close} className="cp-btn cp-btn--icon cp-btn--ghost" onClick={onClose} aria-label="Cerrar los filtros"><XIcon name="close" size={20} /></button>
          </header>
          <div className="cp-drawer-body"><FiltersPanel {...props} /></div>
          <footer className="cp-drawer-foot">
            <div className="cp-row">
              <button type="button" className="cp-btn" onClick={onClear} disabled={active === 0}>Limpiar</button>
              <button type="button" className="cp-btn cp-btn--primary" onClick={onClose}>Ver {props.resultCount === 1 ? "1 producto" : `${props.resultCount} productos`}</button>
            </div>
          </footer>
        </div>
      </div>
  );
}
