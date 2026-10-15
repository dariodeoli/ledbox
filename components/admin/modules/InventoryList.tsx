"use client";

import { tiersForAudience } from "@/lib/price-tiers";
import { formatNumber, inventoryKindLabel } from "@/lib/admin-format";
import { formatInventoryLocation } from "@/lib/field-rules";
import { inventoryAvailabilityLabel } from "@/lib/inventory-availability-label";
import { comboCapacityLabel } from "@/lib/inventory-combos";
import { stockSummary } from "@/lib/inventory-view";
import { locationSummary } from "@/lib/inventory-grid-view";
import { inventoryVisualState } from "@/lib/inventory-visual-state";
import type { AdminInventoryGridRow, AdminWarehouseRow } from "@/lib/admin-types";
import { trashMenuItems } from "../TrashDialogs";
import { AdminActionsMenu, AdminBadge, AdminButton, AdminCell, AdminRow, AdminTable, type AdminMenuItem } from "../AdminUI";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import { AudienceChip, InventoryThumb, PriceValue, RowCheck, SegmentedMeter, StateChips, StockMeter, dayRangeLabel, pricesTitle } from "./InventoryParts";

export type InventoryListProps = {
  rows: AdminInventoryGridRow[];
  warehouses: readonly AdminWarehouseRow[];
  /** Tarjetas con foto (celular y opción de escritorio) o tabla de columnas alineadas. */
  cards: boolean;
  writable: boolean;
  rangeActive: boolean;
  from: string;
  to: string;
  bulkIds: string[];
  archiveBusyId: string;
  onToggleBulk: (id: string) => void;
  onOpen: (id: string) => void;
  onEdit: (item: AdminInventoryGridRow) => void;
  onEditCombo: (item: AdminInventoryGridRow) => void;
  onArchive: (item: AdminInventoryGridRow) => void;
  onTrash: (item: AdminInventoryGridRow) => void;
};

/** Texto completo del stock de una fila para el `title`: libres, comprometidas y eventos que chocan. */
function stockTitle(item: AdminInventoryGridRow, rangeActive: boolean, from: string, to: string): string {
  const { committedNow, availableNow, range } = item.availability;
  const available = rangeActive ? range?.available : availableNow;
  const committed = rangeActive ? range?.committed : committedNow;
  if (item.combo) {
    return `${comboCapacityLabel(available ?? 0)}${item.combo.limiting ? ` · lo limita «${item.combo.limiting.name}»` : ""}`;
  }
  const conflicts = range?.conflicts ?? [];
  return `${inventoryAvailabilityLabel(available)} de ${formatNumber(item.quantity)} · ${inventoryAvailabilityLabel(committed, "committed")} ${
    rangeActive ? `entre ${dayRangeLabel(from, to)}` : "ahora"
  }${conflicts.length > 0 ? ` · ${conflicts.map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`).join(", ")}` : ""}`;
}

function isOvercommitted(item: AdminInventoryGridRow, rangeActive: boolean): boolean {
  return rangeActive ? (item.availability.range?.overcommitted ?? false) : item.availability.overcommittedNow;
}

/** Libres sobre el total: «12/40» con la barra segmentada (hoy) o el medidor del rango (con «Disponible desde/hasta»). */
function StockCell({ item, rangeActive }: { item: AdminInventoryGridRow; rangeActive: boolean }) {
  const visual = inventoryVisualState(item, { combo: Boolean(item.combo) });
  if (rangeActive || item.combo) return <StockMeter summary={stockSummary(item, rangeActive)} combo={Boolean(item.combo)} />;
  return (
    <span className="admin-meter admin-inv-stock">
      <span className="admin-meter-figures admin-nowrap">
        <strong>{formatNumber(visual.free)}</strong>
        <small> / {formatNumber(visual.total)}</small>
      </span>
      <SegmentedMeter visual={visual} />
    </span>
  );
}

/**
 * Lista del inventario: una fila (o tarjeta) por producto con foto, SKU, stock
 * libre/total con barra, estado, precios, alcance en la tienda y una sola acción
 * visible («Ficha»); el resto de las acciones vive en el menú «•••».
 */
export function InventoryList(props: InventoryListProps) {
  const { rows, cards, writable, rangeActive, from, to, bulkIds, archiveBusyId, warehouses } = props;

  function menuFor(item: AdminInventoryGridRow): AdminMenuItem[] {
    if (!writable) return [];
    return [
      ...(item.combo
        ? [{ label: "Editar combo y componentes", icon: "edit" as const, onClick: () => props.onEditCombo(item), title: `Editar combo y componentes: ${item.name}` }]
        : []),
      { label: item.combo ? "Editar datos del combo" : "Editar producto", icon: "edit" as const, onClick: () => props.onEdit(item), title: `Editar producto: ${item.name}` },
      {
        label: "Archivar producto",
        icon: "inventory" as const,
        onClick: () => props.onArchive(item),
        title: `Archivar producto ${item.name}`,
        disabled: Boolean(archiveBusyId),
      },
      // Eliminar solo funciona sobre lo archivado: en la lista activa queda con «Archivalo primero».
      ...trashMenuItems({
        type: "InventoryItem",
        name: item.name,
        archived: Boolean(item.archivedAt),
        canWrite: writable,
        only: ["trash"],
        busy: Boolean(archiveBusyId),
        onArchive: () => props.onArchive(item),
        onUnarchive: () => props.onArchive(item),
        onTrash: () => props.onTrash(item),
      }),
    ];
  }

  /** Un clic abre la ficha; Ctrl/Cmd/Shift-clic suma o quita el producto de la selección (sin abrirla). */
  function activate(item: AdminInventoryGridRow, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (writable && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      if (bulkIds.length < 100 || bulkIds.includes(item.id)) props.onToggleBulk(item.id);
      return;
    }
    props.onOpen(item.id);
  }

  function rowActions(item: AdminInventoryGridRow, withOpen: boolean) {
    const items = menuFor(item);
    return (
      <span className="admin-actions">
        {withOpen ? (
          <AdminButton
            type="button"
            title={`Abrir la ficha de ${item.name}`}
            aria-label={`Abrir la ficha de ${item.name}`}
            onClick={() => props.onOpen(item.id)}
          >
            Ficha
          </AdminButton>
        ) : null}
        {items.length ? <AdminActionsMenu label={`Más acciones de ${item.name}`} items={items} /> : null}
      </span>
    );
  }

  function identity(item: AdminInventoryGridRow, size: number) {
    return (
      <button type="button" className="admin-inv-product" title={`Abrir la ficha de ${item.name}`} onClick={(event) => activate(item, event)}>
        <InventoryThumb item={item} size={size} />
        <span className="admin-inv-product-text">
          <strong>{item.name}</strong>
          <small className="admin-code">
            {item.sku ? `SKU ${item.sku}` : item.combo ? `Combo · ${formatNumber(item.combo.components.length)} componentes` : inventoryKindLabel(item.kind)}
          </small>
        </span>
      </button>
    );
  }

  if (cards) {
    return (
      <div className="admin-inv-cards">
      <AdminCardGrid
        label="Inventario"
        cards={rows.map((item): AdminCardData => {
          const overcommitted = isOvercommitted(item, rangeActive);
          const visual = inventoryVisualState(item, { combo: Boolean(item.combo) });
          const place = locationSummary(item.stock, warehouses, formatInventoryLocation);
          return {
            id: item.id,
            title: identity(item, 48),
            titleTooltip: item.sku ? `${item.name} · ${item.sku}` : item.name,
            subtitle: item.combo ? item.category : `${item.category} · ${inventoryKindLabel(item.kind)}`,
            badges: [
              ...(item.combo ? [{ label: "Combo", tone: "accent" as const, title: "Sin unidades propias: se arma con sus componentes." }] : []),
              ...(overcommitted ? [{ label: "Conflicto", tone: "danger" as const, title: "Hay más unidades comprometidas que las que tiene el producto." }] : []),
            ],
            fields: [
              {
                label: rangeActive ? "Libres en el rango" : "Libres hoy",
                value: <StockCell item={item} rangeActive={rangeActive} />,
                title: stockTitle(item, rangeActive, from, to),
              },
              { label: "Estado", value: <StateChips visual={visual} incomplete={Boolean(item.combo?.incomplete)} /> },
              { label: "Ubicación", value: place.text, title: place.title },
              { label: "Tienda", value: <AudienceChip item={item} /> },
              {
                label: "Precio de lista",
                value: <PriceValue normal={item.listPrice} tiers={tiersForAudience(item.priceTiers, "RETAIL")} />,
                title: pricesTitle(item),
              },
            ],
            footer: (
              <>
                {writable ? (
                  <RowCheck
                    checked={bulkIds.includes(item.id)}
                    disabled={bulkIds.length >= 100 && !bulkIds.includes(item.id)}
                    label={`Seleccionar producto ${item.name}`}
                    onToggle={() => props.onToggleBulk(item.id)}
                  />
                ) : null}
                {rowActions(item, true)}
              </>
            ),
          };
        })}
      />
      </div>
    );
  }

  return (
    <AdminTable
      view="inventario"
      label="Inventario"
      columns={[
        { label: "Sel." },
        { label: "Producto" },
        { label: "Categoría" },
        { label: "Ubicación" },
        { label: rangeActive ? "Libres en rango" : "Libres hoy" },
        { label: "Estado" },
        { label: "Lista", end: true },
        { label: "Mayorista", end: true },
        { label: "Tienda" },
        { label: "Más", end: true },
      ]}
    >
      {rows.map((item) => {
        const overcommitted = isOvercommitted(item, rangeActive);
        const visual = inventoryVisualState(item, { combo: Boolean(item.combo) });
        const place = locationSummary(item.stock, warehouses, formatInventoryLocation);
        return (
          <AdminRow key={item.id} selected={bulkIds.includes(item.id)} onActivate={(event) => activate(item, event)}>
            <AdminCell className="admin-cell--check">
              {writable ? (
                <RowCheck
                  checked={bulkIds.includes(item.id)}
                  disabled={bulkIds.length >= 100 && !bulkIds.includes(item.id)}
                  label={`Seleccionar producto ${item.name}`}
                  onToggle={() => props.onToggleBulk(item.id)}
                />
              ) : null}
            </AdminCell>
            <AdminCell title={item.sku ? `${item.name} · ${item.sku}` : item.name}>{identity(item, 36)}</AdminCell>
            <AdminCell title={item.category}>{item.category}</AdminCell>
            <AdminCell title={place.title}>
              <span className="admin-code">{place.text}</span>
            </AdminCell>
            <AdminCell title={stockTitle(item, rangeActive, from, to)}>
              <StockCell item={item} rangeActive={rangeActive} />
              {overcommitted ? (
                <AdminBadge tone="danger" title={rangeActive ? "Hay más unidades comprometidas en el rango que las que tiene el producto." : "Hay más unidades asignadas a eventos vigentes que las que tiene el producto."}>
                  Conflicto
                </AdminBadge>
              ) : null}
            </AdminCell>
            <AdminCell title={visual.state.hint}>
              <StateChips visual={visual} incomplete={Boolean(item.combo?.incomplete)} />
            </AdminCell>
            <AdminCell end title={pricesTitle(item)}>
              <PriceValue normal={item.listPrice} tiers={tiersForAudience(item.priceTiers, "RETAIL")} />
            </AdminCell>
            <AdminCell end title={pricesTitle(item)}>
              <PriceValue normal={item.wholesalePrice} tiers={tiersForAudience(item.priceTiers, "WHOLESALE")} />
            </AdminCell>
            <AdminCell>
              <AudienceChip item={item} />
            </AdminCell>
            <AdminCell end className="admin-cell--actions">
              {rowActions(item, false)}
            </AdminCell>
          </AdminRow>
        );
      })}
    </AdminTable>
  );
}
