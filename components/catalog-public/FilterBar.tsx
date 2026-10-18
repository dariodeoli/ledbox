"use client";

import { SelectField, TextField } from "@/components/admin/AdminFields";
import Link from "next/link";
import { XIcon } from "./StoreIcons";
import { SORT_OPTIONS, isSortKey, type SortKey } from "@/lib/storefront-ui";

/**
 * Barra de filtros sticky del catálogo: chips de categoría con scroll horizontal y fade en los bordes, orden (destacados,
 * precio, nombre, capacidad) y buscador. Presentacional: el estado vive en `CatalogBrowser`.
 */
export function FilterBar({ categories, category, onCategory, sort, onSort, query, onQuery, showPrices, activeFilters = 0, onOpenFilters, categoryNavigation }: {
  categories: string[];
  category: string | null;
  onCategory: (value: string | null) => void;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  query: string;
  onQuery: (value: string) => void;
  showPrices: boolean;
  /** Cantidad de filtros del cajón en uso y cómo abrirlo (solo celular y tableta). */
  activeFilters?: number;
  onOpenFilters?: () => void;
  categoryNavigation?: { allHref: string; links: Array<{ name: string; href: string }>; clientSide?: boolean };
}) {
  return (
    <div className="cp-filter cp-fields" role="search" aria-label="Filtrar y ordenar el catálogo" data-testid="filter-bar">
      {categories.length > 1 || categoryNavigation ? (
        <div className="cp-filter-chips" role="group" aria-label="Filtrar por categoría" tabIndex={-1}>
          {categoryNavigation ? (
            <>
              {categoryNavigation.clientSide ? (
                <>
                  <button type="button" className="cp-cat" aria-pressed={category === null} onClick={() => onCategory(null)}>Todas</button>
                  {categoryNavigation.links.map((entry) => <button key={entry.name} type="button" className="cp-cat" aria-pressed={category === entry.name} onClick={() => onCategory(category === entry.name ? null : entry.name)}>{entry.name}</button>)}
                </>
              ) : (
                <>
                  <Link className="cp-cat" href={categoryNavigation.allHref} scroll={false} aria-current={category === null ? "page" : undefined}>Todas</Link>
                  {categoryNavigation.links.map((entry) => <Link key={entry.name} className="cp-cat" href={entry.href} scroll={false} aria-current={category === entry.name ? "page" : undefined}>{entry.name}</Link>)}
                </>
              )}
            </>
          ) : (
            <>
              <button type="button" className="cp-cat" aria-pressed={category === null} onClick={() => onCategory(null)}>Todas</button>
              {categories.map((name) => <button key={name} type="button" className="cp-cat" aria-pressed={category === name} onClick={() => onCategory(category === name ? null : name)}>{name}</button>)}
            </>
          )}
        </div>
      ) : null}
      <div className="cp-filter-tools">
        <TextField id="buscar-catalogo" label="Buscar productos" ariaLabel="Buscar productos por nombre o código" type="search" size="full" placeholder="Buscar producto" value={query} onChange={onQuery} autoComplete="off" />
        <SelectField
          label="Ordenar"
          ariaLabel="Ordenar productos"
          size="full"
          value={sort}
          onChange={(value) => { if (isSortKey(value)) onSort(value); }}
          options={SORT_OPTIONS.filter((option) => showPrices || !option.value.startsWith("precio")).map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>
      {onOpenFilters ? (
        <button type="button" className="cp-btn cp-filter-open" onClick={onOpenFilters} aria-haspopup="dialog" data-testid="filters-open">
          <XIcon name="filter" size={18} /> Filtrar{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </button>
      ) : null}
    </div>
  );
}
