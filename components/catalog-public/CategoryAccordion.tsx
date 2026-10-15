"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { PriceMode } from "@/lib/appearance";
import { categoryDatum } from "@/lib/storefront-ui";
import { CATEGORY_PREVIEW_EVENT, CATEGORY_PREVIEW_LIMIT, type CategoryPreviewRequest } from "@/lib/store-category-preview";
import { ProductPlaceholder, XIcon } from "./StoreIcons";

export type CategoryAccordionEntry = { name: string; href: string; imageUrl: string | null; count: number; minUnit: number | null };

/** Sólo metadatos: el catálogo existente monta sus ProductTile y conserva el único carrito. */
export function CategoryAccordion({ categories, catalogKey, showPrices, priceMode, renderProducts }: {
  categories: CategoryAccordionEntry[];
  catalogKey: string;
  showPrices: boolean;
  priceMode: PriceMode;
  /** El panel de Apariencia usa sus ejemplos, sin montar otro motor de carrito. */
  renderProducts?: (name: string) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const id = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (renderProducts) return;
    const announce = (category: string | null, targetId: string | null) => window.dispatchEvent(new CustomEvent<CategoryPreviewRequest>(CATEGORY_PREVIEW_EVENT, { detail: { catalogKey, category, targetId } }));
    announce(open, hostRef.current?.id ?? null);
    return () => { announce(null, null); };
  }, [open, catalogKey, renderProducts]);
  return <div className="cp-cataccordion" data-testid="category-accordion">
    {categories.map((category, index) => {
      const expanded = open === category.name;
      const buttonId = `${id}-category-${index}`, panelId = `${id}-panel-${index}`;
      const previewId = `${id}-products-${index}`;
      return <div key={category.name} className="cp-cataccordion-item">
        <div className="cp-cataccordion-row">
          <h3 className="cp-cataccordion-heading"><button type="button" className="cp-cataccordion-toggle" id={buttonId} aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen((current) => current === category.name ? null : category.name)}>
            <span className="cp-cataccordion-media">
              {category.imageUrl && !failedImages.has(category.imageUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={category.imageUrl} alt="" loading="lazy" onError={() => setFailedImages((current) => new Set(current).add(category.imageUrl!))} />
              ) : <ProductPlaceholder size={26} />}
            </span>
            <span className="cp-cataccordion-copy"><strong>{category.name}</strong><small>{categoryDatum(category, showPrices, priceMode)}</small></span>
            <span className="cp-cataccordion-arrow"><XIcon name="next" size={18} /></span>
          </button></h3>
          <a className="cp-cataccordion-link" href={category.href} aria-label={`Ver categoría ${category.name}`}>Ver categoría</a>
        </div>
        <div id={panelId} className="cp-cataccordion-panel" role="region" aria-labelledby={buttonId} hidden={!expanded}>{expanded ? <>
          <p className="cp-cataccordion-count">Mostrando {Math.min(CATEGORY_PREVIEW_LIMIT, category.count)} de {category.count} {category.count === 1 ? "producto" : "productos"}</p>
          <div ref={hostRef} id={previewId} data-store-category-preview={category.name} data-store-category-scope={catalogKey}>{renderProducts?.(category.name)}</div>
          <a className="cp-link cp-cataccordion-all" href={category.href}>Ver {category.count === 1 ? "el producto" : `los ${category.count} productos`} de {category.name}<XIcon name="next" size={14} /></a>
        </> : null}</div>
      </div>;
    })}
  </div>;
}
