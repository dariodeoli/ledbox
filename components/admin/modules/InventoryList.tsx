"use client";

import { formatNumber, inventoryKindLabel, inventoryStatusLabel, statusTone } from "@/lib/admin-format";
import { inventoryAvailabilityLabel } from "@/lib/inventory-availability-label";
import { comboCapacityLabel } from "@/lib/inventory-combos";
import { stockSummary } from "@/lib/inventory-view";
import type { AdminInventoryItemRow } from "@/lib/admin-types";
import { AdminActionsMenu, AdminBadge, AdminButton, AdminCell, AdminRow, AdminSelect, AdminTable, type AdminMenuItem } from "../AdminUI";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import { AudienceChip, InventoryThumb, PriceValue, RowCheck, STATUS_PICK_OPTIONS, StockMeter, dayRangeLabel, pricesTitle } from "./InventoryParts";

export type InventoryListProps = {
  rows: AdminInventoryItemRow[];
  /** Tarjetas con foto (celular y opción de escritorio) o tabla de columnas alineadas. */
  cards: boolean;
  writable: boolean;
  rangeActive: boolean;
  from: string;
  to: string;
  bulkIds: string[];
  statusBusyId: string;
  archiveBusyId: string;
  onToggleBulk: (id: string) => void;
  onOpen: (id: string) => void;
  onEdit: (item: AdminInventoryItemRow) => void;
  onEditCombo: (item: AdminInventoryItemRow) => void;
  onArchive: (item: AdminInventoryItemRow) => void;
  onChangeStatus: (item: AdminInventoryItemRow, next: string) => void;
};

/** Texto completo del stock de una fila para el `title`: libres, comprometidas y eventos que chocan. */
function stockTitle(item: AdminInventoryItemRow, rangeActive: boolean, from: string, to: string): string {
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

function isOvercommitted(item: AdminInventoryItemRow, rangeActive: boolean): boolean {
  return rangeActive ? (item.availability.range?.overcommitted ?? false) : item.availability.overcommittedNow;
}

/**
 * Lista del inventario: una fila (o tarjeta) por producto con foto, SKU, stock
 * libre/total con barra, estado, precios, alcance en la tienda y una sola acción
 * visible («Ficha»); el resto de las acciones vive en el menú «•••».
 */
export function InventoryList(props: InventoryListProps) {
  const { rows, cards, writable, rangeActive, from, to, bulkIds, statusBusyId, archiveBusyId } = props;

  function menuFor(item: AdminInventoryItemRow): AdminMenuItem[] {
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
    ];
  }

  function statusControl(item: AdminInventoryItemRow) {
    return writable ? (
      <AdminSelect
        className="admin-filter admin-filter--cell"
        value={item.status}
        disabled={statusBusyId === item.id}
        onChange={(value) => props.onChangeStatus(item, value)}
        label={`Cambiar estado: ${item.name}`}
        title={`Cambiar estado: ${item.name}`}
        options={STATUS_PICK_OPTIONS}
        tone={statusTone(item.status)}
      />
    ) : (
      <AdminBadge tone={statusTone(item.status)}>{inventoryStatusLabel(item.status)}</AdminBadge>
    );
  }

  function rowActions(item: AdminInventoryItemRow) {
    const items = menuFor(item);
    return (
      <span className="admin-actions">
        <AdminButton
          type="button"
          title={`Abrir la ficha de ${item.name}`}
          aria-label={`Abrir la ficha de ${item.name}`}
          onClick={() => props.onOpen(item.id)}
        >
          Ficha
        </AdminButton>
        {items.length ? <AdminActionsMenu label={`Más acciones de ${item.name}`} items={items} /> : null}
      </span>
    );
  }

  function identity(item: AdminInventoryItemRow, size: number) {
    return (
      <button type="button" className="admin-inv-product" title={`Abrir la ficha de ${item.name}`} onClick={() => props.onOpen(item.id)}>
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
          const summary = stockSummary(item, rangeActive);
          const overcommitted = isOvercommitted(item, rangeActive);
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
                value: <StockMeter summary={summary} combo={Boolean(item.combo)} />,
                title: stockTitle(item, rangeActive, from, to),
              },
              { label: "Estado", value: statusControl(item), title: inventoryStatusLabel(item.status) },
              { label: "Tienda", value: <AudienceChip item={item} /> },
              {
                label: "Precio de lista",
                value: <PriceValue normal={item.listPrice} days={item.listFromDays} from={item.listFromPrice} />,
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
                {rowActions(item)}
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
        { label: rangeActive ? "Libres en rango" : "Libres hoy" },
        { label: "Estado" },
        { label: "Lista", end: true },
        { label: "Mayorista", end: true },
        { label: "Tienda" },
        { label: "Acciones", end: true },
      ]}
    >
      {rows.map((item) => {
        const summary = stockSummary(item, rangeActive);
        const overcommitted = isOvercommitted(item, rangeActive);
        return (
          <AdminRow key={item.id}>
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
            <AdminCell title={stockTitle(item, rangeActive, from, to)}>
              <StockMeter summary={summary} combo={Boolean(item.combo)} />
              {overcommitted ? (
                <AdminBadge tone="danger" title={rangeActive ? "Hay más unidades comprometidas en el rango que las que tiene el producto." : "Hay más unidades asignadas a eventos vigentes que las que tiene el producto."}>
                  Conflicto
                </AdminBadge>
              ) : null}
            </AdminCell>
            <AdminCell title={writable ? `Cambiar estado: ${item.name}` : `Estado: ${inventoryStatusLabel(item.status)}`}>{statusControl(item)}</AdminCell>
            <AdminCell end title={pricesTitle(item)}>
              <PriceValue normal={item.listPrice} days={item.listFromDays} from={item.listFromPrice} />
            </AdminCell>
            <AdminCell end title={pricesTitle(item)}>
              <PriceValue normal={item.wholesalePrice} days={item.wholesaleFromDays} from={item.wholesaleFromPrice} />
            </AdminCell>
            <AdminCell>
              <AudienceChip item={item} />
            </AdminCell>
            <AdminCell end className="admin-cell--actions">
              {rowActions(item)}
            </AdminCell>
          </AdminRow>
        );
      })}
    </AdminTable>
  );
}
