"use client";
import { useMemo, useState } from "react";
import { matchesQuery } from "@/lib/admin-policy";
import { formatNumber, inventoryStatusLabel } from "@/lib/admin-format";
import { comboCapacityLabel } from "@/lib/inventory-combos";
import type { AdminInventoryItemRow, AdminInventoryLink } from "@/lib/admin-types";
import { useAdminResource } from "@/lib/admin-api";
import { AdminButton, AdminNote } from "../AdminUI";
import { SearchField } from "../AdminFields";
import { AdminImageBox } from "../AdminImageBox";

/** Vínculo listo para guardar: solo los campos que el API acepta y dibuja. */
function inventoryLinkOf(item: AdminInventoryItemRow): AdminInventoryLink {
  return { id: item.id, name: item.name, sku: item.sku, category: item.category, quantity: item.quantity, status: item.status, imageUrl: item.imageUrl, listPrice: item.listPrice, priceTiers: (item.priceTiers ?? []).filter((tier) => tier.audience === "RETAIL"), _count: { components: item.combo ? item.combo.components.length : 0 }, billingUnit: item.billingUnit };
}

/**
 * Buscador de inventario para vincular un ítem del presupuesto (issue #18).
 * Pide la disponibilidad del rango del evento cuando existe (mismo endpoint y
 * misma lógica que el inventario) y muestra cuántos libres hay por artículo. Un
 * ítem sin vínculo no reserva nada: queda documentado en el propio buscador.
 */
export function InventoryLinkPicker({
  label,
  hint,
  range,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  hint?: string;
  range: { startsAt: string; endsAt: string } | null;
  selected: AdminInventoryLink | null;
  disabled?: boolean;
  onSelect: (item: AdminInventoryLink | null) => void;
}) {
  const [query, setQuery] = useState("");
  const path = useMemo(() => {
    if (!range) return "/api/admin/inventory";
    const params = new URLSearchParams({ startsAt: range.startsAt, endsAt: range.endsAt });
    return `/api/admin/inventory?${params.toString()}`;
  }, [range]);
  const inventory = useAdminResource(path, (payload) => (payload.inventory ?? []) as AdminInventoryItemRow[]);

  const candidates = useMemo(() => {
    return (inventory.data ?? [])
      .filter((item) => matchesQuery(query, [item.name, item.category, item.sku]))
      .map((item) => ({
        item,
        available: range ? (item.availability.range?.available ?? 0) : item.availability.availableNow,
        blocked: item.status === "MAINTENANCE" || item.status === "RETIRED",
      }))
      .sort((a, b) => b.available - a.available || a.item.name.localeCompare(b.item.name))
      .slice(0, 6);
  }, [inventory.data, query, range]);

  const selectedRow = useMemo(
    () => (selected ? (inventory.data ?? []).find((item) => item.id === selected.id) ?? null : null),
    [inventory.data, selected],
  );
  const selectedFree = selectedRow
    ? range
      ? (selectedRow.availability.range?.available ?? 0)
      : selectedRow.availability.availableNow
    : null;

  return (
    <div className="admin-link-field">
      <span className="admin-field-label">{label}</span>
      {selected ? (
        <div className="admin-link-current">
          <AdminImageBox imageUrl={selected.imageUrl} size={40} />
          <span className="admin-link-name" title={`${selected.name}${selected.sku ? ` · ${selected.sku}` : ""} · ${selected.category}`}>
            <strong>{selected.name}</strong>
            <small className="admin-cell-sub">
              {" "}
              · {selected.category}{selectedRow?.combo ? " · combo" : ` · ${formatNumber(selected.quantity)} unidades`}
              {selectedFree !== null
                ? selectedRow?.combo
                  ? ` · ${comboCapacityLabel(selectedFree).toLowerCase()} ${range ? "en el rango" : "ahora"}`
                  : ` · ${formatNumber(selectedFree)} libres ${range ? "en el rango" : "ahora"}`
                : ""}
            </small>
          </span>
          <AdminButton
            icon="close"
            title={`Quitar el vínculo con ${selected.name}`}
            aria-label={`Quitar el vínculo con ${selected.name}`}
            disabled={disabled}
            onClick={() => onSelect(null)}
          />
        </div>
      ) : null}
      <SearchField
        value={query}
        onChange={setQuery}
        label={selected ? `Buscar otro artículo para ${label}` : `Buscar artículo para ${label}`}
        placeholder="Buscar por artículo, categoría o SKU…"
      />
      <div className="admin-link-list">
        {inventory.loading ? <span className="admin-muted">Cargando inventario…</span> : null}
        {inventory.error ? <AdminNote tone="error">{inventory.error}</AdminNote> : null}
        {!inventory.loading && !inventory.error && candidates.length === 0 ? (
          <span className="admin-muted">Sin artículos que coincidan con la búsqueda.</span>
        ) : null}
        {candidates.map(({ item, available, blocked }) => (
          <div className="admin-link-row admin-quote-product-row" key={item.id}>
            <AdminImageBox imageUrl={item.imageUrl} size={40} />
            <span className="admin-link-name" title={`${item.name}${item.sku ? ` · ${item.sku}` : ""} · ${item.category}`}>
              <strong>{item.name}</strong>
              <small className="admin-cell-sub"> · {item.combo ? "Combo · " : ""}{item.category}{item.sku ? ` · ${item.sku}` : ""}</small>
            </span>
            <span className="admin-link-free" data-tone={blocked || available === 0 ? "warn" : undefined}>
              {blocked
                ? inventoryStatusLabel(item.status)
                : item.combo
                  ? `${comboCapacityLabel(available)} ${range ? "en el rango" : "ahora"}`
                  : `${formatNumber(available)} libres ${range ? "en el rango" : "ahora"}`}
            </span>
            <AdminButton
              icon="check"
              title={`Vincular ${item.name}`}
              aria-label={`Vincular ${item.name}`}
              disabled={disabled || selected?.id === item.id}
              onClick={() => onSelect(inventoryLinkOf(item))}
            >
              {selected?.id === item.id ? "Vinculado" : "Vincular"}
            </AdminButton>
          </div>
        ))}
      </div>
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
    </div>
  );
}
