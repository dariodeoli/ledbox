"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { XIcon } from "./StoreIcons";
import { mergeStoreListState, type StoreListState } from "@/lib/storefront-list-state";

/**
 * Navegación horizontal de categorías. Búsqueda y orden se muestran dentro del panel de filtros, junto a los demás.
 */
export function FilterBar({ categories, category, onCategory, activeFilters = 0, onOpenFilters, categoryNavigation, listState }: {
  categories: string[];
  category: string | null;
  onCategory: (value: string | null) => void;
  listState: StoreListState;
  /** Cantidad de filtros del cajón en uso y cómo abrirlo (solo celular y tableta). */
  activeFilters?: number;
  onOpenFilters?: () => void;
  categoryNavigation?: { allHref: string; links: Array<{ name: string; href: string }>; clientSide?: boolean };
}) {
  const [categoriesHidden, setCategoriesHidden] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  // Only the document's vertical scroll controls this strip. Scrolling the category
  // rail horizontally never reaches this listener. Focused links always stay visible.
  useEffect(() => {
    let previousY = window.scrollY;
    const onScroll = () => {
      const nextY = window.scrollY;
      if (nextY <= 24 || railRef.current?.contains(document.activeElement)) setCategoriesHidden(false);
      else if (Math.abs(nextY - previousY) >= 4) setCategoriesHidden(nextY > previousY);
      previousY = nextY;
    };
    const revealOnFocus = () => setCategoriesHidden(false);
    const hideOnBlur = () => requestAnimationFrame(() => {
      if (window.scrollY > 24 && !railRef.current?.contains(document.activeElement)) setCategoriesHidden(true);
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    railRef.current?.addEventListener("focusin", revealOnFocus);
    railRef.current?.addEventListener("focusout", hideOnBlur);
    return () => {
      window.removeEventListener("scroll", onScroll);
      railRef.current?.removeEventListener("focusin", revealOnFocus);
      railRef.current?.removeEventListener("focusout", hideOnBlur);
    };
  }, []);

  return (
    <div className="cp-filter cp-fields" aria-label="Categorías del catálogo" data-testid="filter-bar">
      {categories.length > 1 || categoryNavigation ? (
        <div className="cp-filter-chips" data-hidden={categoriesHidden} ref={railRef} role="group" aria-label="Filtrar por categoría" tabIndex={-1}>
          {categoryNavigation ? (
            <>
              {categoryNavigation.clientSide ? (
                <>
                  <button type="button" className="cp-cat" aria-pressed={category === null} onClick={() => onCategory(null)}>Todas</button>
                  {categoryNavigation.links.map((entry) => <button key={entry.name} type="button" className="cp-cat" aria-pressed={category === entry.name} onClick={() => onCategory(category === entry.name ? null : entry.name)}>{entry.name}</button>)}
                </>
              ) : (
                <>
                  <Link className="cp-cat" href={mergeStoreListState(categoryNavigation.allHref, listState)} scroll={false} aria-current={category === null ? "page" : undefined}>Todas</Link>
                  {categoryNavigation.links.map((entry) => <Link key={entry.name} className="cp-cat" href={mergeStoreListState(entry.href, listState)} scroll={false} aria-current={category === entry.name ? "page" : undefined}>{entry.name}</Link>)}
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
      {onOpenFilters ? (
        <button type="button" className="cp-btn cp-filter-open" onClick={onOpenFilters} aria-haspopup="dialog" data-testid="filters-open">
          <XIcon name="filter" size={18} /> Filtrar{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </button>
      ) : null}
    </div>
  );
}
