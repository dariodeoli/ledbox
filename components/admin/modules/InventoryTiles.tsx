"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/admin-format";
import type { AdminInventoryGridRow } from "@/lib/admin-types";
import { groupByCategory, groupInventoryCards, type CategorySection } from "@/lib/inventory-grid-view";
import type { CategoryNode } from "@/lib/inventory-categories";
import { inventoryVisualState } from "@/lib/inventory-visual-state";
import { stockSummary } from "@/lib/inventory-view";
import { AdminIcon } from "../AdminIcons";
import { AdminSelect } from "../AdminUI";
import { InventoryThumb, RowCheck, SegmentedMeter, StateChips, StockMeter } from "./InventoryParts";

/**
 * Cuadrícula compacta del inventario (`.admin-inv-grid`, rediseño E2): foto de 64 px, nombre en
 * dos líneas, código, chip de estado y «libres/total». Muchos productos por fila (8 a 1440 px, 2 a
 * 390 px) y la misma pieza dentro de «Por categoría».
 */

type TileProps = {
  rows: AdminInventoryGridRow[];
  writable: boolean;
  rangeActive: boolean;
  bulkIds: string[];
  selectionBusy?: boolean;
  onToggleBulk: (id: string) => void;
  onOpen: (id: string) => void;
};

function InventoryTile({ item, variants = [item], writable, rangeActive, selected: initiallySelected, selectedIds, selectionFull, selectionBusy, onToggleBulk, onOpen }: Omit<TileProps, "rows" | "bulkIds"> & { item: AdminInventoryGridRow; variants?: AdminInventoryGridRow[]; selected: boolean; selectedIds?: string[]; selectionFull: boolean }) {
  const [selectedId, setSelectedId] = useState(item.id);
  const orderedVariants = [...variants].sort((a, b) => (a.variantSortOrder ?? 0) - (b.variantSortOrder ?? 0) || a.name.localeCompare(b.name, "es"));
  const selectedItem = orderedVariants.find((variant) => variant.id === selectedId) ?? orderedVariants[0] ?? item;
  const selected = selectedIds ? selectedIds.includes(selectedItem.id) : initiallySelected;
  const visual = inventoryVisualState(selectedItem, { combo: Boolean(selectedItem.combo) });
  const code = selectedItem.sku ? selectedItem.sku : selectedItem.combo ? "Combo" : "Sin código";
  return (
    <li className="admin-inv-tile" data-selected={selected ? "true" : undefined} data-state={visual.state.key}>
      {orderedVariants.length > 1 ? <div className="admin-inv-family-picker">
        <span>{selectedItem.familyName ?? "Variantes"}</span>
        <AdminSelect
          className="admin-filter admin-inv-variant-select"
          label={`Variante de ${selectedItem.familyName ?? "la familia"}`}
          value={selectedItem.id}
          onChange={setSelectedId}
          options={orderedVariants.map((variant) => ({ value: variant.id, label: `${Object.values(variant.variantOptions ?? {}).filter(Boolean).join(" · ") || variant.name}${variant.sku ? ` · ${variant.sku}` : ""}` }))}
        />
      </div> : null}
      {writable ? (
        <span className="admin-inv-tile-check">
          <RowCheck checked={selected} disabled={selectionBusy || (selectionFull && !selected)} label={`Seleccionar producto ${selectedItem.name}`} onToggle={() => onToggleBulk(selectedItem.id)} />
        </span>
      ) : null}
      <button type="button" className="admin-inv-tile-open" title={`Abrir la ficha de ${selectedItem.name}`} aria-label={`Abrir la ficha de ${selectedItem.name}`} onClick={(event) => {
          // Ctrl/Cmd/Shift-clic: suma o quita de la selección sin abrir la ficha.
          if (writable && (event.ctrlKey || event.metaKey || event.shiftKey)) {
            if (!selectionFull || selected) onToggleBulk(selectedItem.id);
            return;
          }
          onOpen(selectedItem.id);
        }}>
        <span className="admin-inv-tile-head">
        <InventoryThumb item={selectedItem} size={52} />
        <span className="admin-inv-tile-text">
        <strong className="admin-inv-tile-name">{selectedItem.name}</strong>
        <small className="admin-code admin-inv-tile-code">{code}</small>
        </span>
        </span>
        <StateChips visual={visual} incomplete={Boolean(selectedItem.combo?.incomplete)} compact />
        {selectedItem.stockCountStatus === "PENDING_COUNT" ? <small>Total pendiente de conteo</small> : rangeActive || selectedItem.combo ? (
          <StockMeter summary={stockSummary(selectedItem, rangeActive)} combo={Boolean(selectedItem.combo)} />
        ) : (
          <span className="admin-meter admin-inv-stock">
            <span className="admin-meter-figures admin-nowrap" title={`${formatNumber(visual.free)} libres de ${formatNumber(visual.total)}`}>
              <strong>{formatNumber(visual.free)}</strong>
              <small>/{formatNumber(visual.total)}</small>
              <small className="admin-inv-tile-unit"> libres</small>
            </span>
            <SegmentedMeter visual={visual} />
          </span>
        )}
      </button>
    </li>
  );
}

/** Cuadrícula de tarjetas compactas. */
export function InventoryCompactGrid({ rows, writable, rangeActive, bulkIds, selectionBusy, onToggleBulk, onOpen, label = "Inventario" }: TileProps & { label?: string }) {
  const groups = groupInventoryCards(rows);
  return (
    <ul className="admin-inv-grid" aria-label={label}>
      {groups.map(({ key, rows: variants }) => {
        const tileProps = {
          writable,
          rangeActive,
          selectionBusy,
          onToggleBulk,
          onOpen,
        };
        return <InventoryTile key={key} item={variants[0]} variants={variants} selected={bulkIds.includes(variants[0].id)} selectedIds={bulkIds} selectionFull={false} {...tileProps} />;
      })}
    </ul>
  );
}

function Section({ section, open, onToggle, tileProps }: { section: CategorySection; open: boolean; onToggle: () => void; tileProps: Omit<TileProps, "rows"> }) {
  const bodyId = `inv-section-${section.id}`;
  return (
    <section className="admin-inv-section" data-open={open ? "true" : "false"}>
      <h3 className="admin-inv-section-head">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} title={open ? `Plegar ${section.name}` : `Desplegar ${section.name}`}>
          <span className="admin-inv-section-chevron" aria-hidden="true">
            <AdminIcon name="chevron-down" size={14} />
          </span>
          <span className="admin-inv-section-name">{section.name}</span>
          <span className="admin-inv-section-count">
            {formatNumber(section.rows.length)} {section.rows.length === 1 ? "producto" : "productos"} · {formatNumber(section.free)} libres
          </span>
        </button>
      </h3>
      {open ? (
        <div id={bodyId}>
          <InventoryCompactGrid rows={section.rows} label={`Productos de ${section.name}`} {...tileProps} />
        </div>
      ) : null}
    </section>
  );
}

/** Vista «Por categoría»: secciones por `sortOrder`, encabezado pegajoso con conteo y libres, plegables. */
export function InventoryByCategory({ rows, tree, ...tileProps }: TileProps & { tree: readonly CategoryNode[] }) {
  const sections = groupByCategory(rows, tree);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="admin-inv-sections">
      {sections.map((section) => (
        <Section key={section.id} section={section} open={!closed.has(section.id)} onToggle={() => toggle(section.id)} tileProps={tileProps} />
      ))}
    </div>
  );
}
