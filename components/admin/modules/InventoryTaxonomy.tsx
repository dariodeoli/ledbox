"use client";

import { useMemo } from "react";
import { useAdminResource } from "@/lib/admin-api";
import type { AdminInventoryCategoryRow, AdminWarehouseRow } from "@/lib/admin-types";
import { buildCategoryTree, categoryKey, parseCategoryInput, type CategoryNode } from "@/lib/inventory-categories";
import { INVENTORY_FIELD_HELP } from "@/lib/inventory-bulk";
import { formatInventoryLocation } from "@/lib/field-rules";
import { formatDateShort } from "@/lib/admin-format";
import { AdminBadge } from "../AdminUI";
import { Combobox, DayField, SelectField, TextField } from "../AdminFields";

/**
 * Categorías, depósitos y proveedores de la empresa para los formularios del inventario
 * (rediseño E1). Un solo origen para el alta, la edición, la edición masiva y la ficha.
 */
export type InventoryTaxonomy = {
  tree: CategoryNode[];
  warehouses: AdminWarehouseRow[];
  suppliers: Array<{ id: string; name: string }>;
  loading: boolean;
  reload: () => void;
};

export function useInventoryTaxonomy(): InventoryTaxonomy {
  const categories = useAdminResource("/api/admin/inventory/categories", (payload) => ((payload as { categories?: AdminInventoryCategoryRow[] }).categories ?? []));
  const warehouses = useAdminResource("/api/admin/inventory/warehouses", (payload) => ((payload as { warehouses?: AdminWarehouseRow[] }).warehouses ?? []));
  const suppliers = useAdminResource("/api/admin/resources?only=suppliers&fields=selector", (payload) => ((payload as { suppliers?: Array<{ id: string; name: string }> }).suppliers ?? []));
  const tree = useMemo(() => buildCategoryTree(categories.data ?? []), [categories.data]);
  return {
    tree,
    warehouses: warehouses.data ?? [],
    suppliers: suppliers.data ?? [],
    loading: categories.loading || warehouses.loading,
    reload: () => {
      categories.reload();
      warehouses.reload();
    },
  };
}

/** Categoría y subcategoría de un texto espejo («Vajilla › Copas»). */
export function categoryFormFromText(text: string): { category: string; subcategory: string } {
  const path = parseCategoryInput(text);
  return { category: path.parent, subcategory: path.child ?? "" };
}

/**
 * Categoría + Subcategoría: dos listas con alta rápida (escribir una que no existe la crea al
 * guardar, sin duplicar). La subcategoría se ofrece solo dentro de la categoría elegida.
 */
export function CategoryPicker({
  tree,
  category,
  subcategory,
  onChange,
  disabled,
}: {
  tree: readonly CategoryNode[];
  category: string;
  subcategory: string;
  onChange: (next: { category: string; subcategory: string }) => void;
  disabled?: boolean;
}) {
  const roots = tree.filter((node) => !node.archivedAt);
  const current = roots.find((node) => categoryKey(node.name) === categoryKey(category));
  const children = (current?.children ?? []).filter((node) => !node.archivedAt);
  const choose = (value: string) => {
    // Cambiar de categoría limpia la subcategoría si ya no pertenece a ella.
    const next = roots.find((node) => categoryKey(node.name) === categoryKey(value));
    const keep = next?.children.some((node) => categoryKey(node.name) === categoryKey(subcategory));
    onChange({ category: value, subcategory: keep ? subcategory : "" });
  };
  return (
    <>
      <Combobox
        label="Categoría"
        help={INVENTORY_FIELD_HELP.category}
        value={category}
        onChange={choose}
        options={roots.map((node) => ({ value: node.name, label: node.name }))}
        placeholder="Ej.: Vajilla"
        emptyLabel="Sin categorías cargadas."
        hint="Buscá o creá una nueva."
        disabled={disabled}
        onCreate={(query) => query && choose(query.trim())}
        createLabel={(query) => (query ? `Crear categoría «${query}»` : "Crear categoría")}
      />
      <Combobox
        label="Subcategoría"
        help={INVENTORY_FIELD_HELP.subcategory}
        value={subcategory}
        onChange={(value) => onChange({ category, subcategory: value })}
        options={children.map((node) => ({ value: node.name, label: node.name }))}
        placeholder={category ? "Ej.: Copas" : "Elegí primero la categoría"}
        emptyLabel={category ? "Esta categoría no tiene subcategorías todavía." : "Elegí primero la categoría."}
        hint="Opcional."
        disabled={disabled || !category.trim()}
        onCreate={(query) => query && onChange({ category, subcategory: query.trim() })}
        createLabel={(query) => (query ? `Crear subcategoría «${query}»` : "Crear subcategoría")}
      />
    </>
  );
}

/** Opciones de depósito (solo activos; el principal primero). */
export function warehouseOptions(warehouses: readonly AdminWarehouseRow[], { includeEmpty }: { includeEmpty?: string } = {}) {
  const active = warehouses.filter((warehouse) => !warehouse.archivedAt).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code));
  return [...(includeEmpty ? [{ value: "", label: includeEmpty }] : []), ...active.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.code} · ${warehouse.name}` }))];
}

export function supplierOptions(suppliers: ReadonlyArray<{ id: string; name: string }>, emptyLabel: string) {
  return [{ value: "", label: emptyLabel }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))];
}

export type ProductTraceForm = {
  defaultWarehouseId: string;
  defaultLocation: string;
  supplierId: string;
  purchasedAt: string;
  warrantyUntil: string;
};

export const EMPTY_PRODUCT_TRACE: ProductTraceForm = { defaultWarehouseId: "", defaultLocation: "", supplierId: "", purchasedAt: "", warrantyUntil: "" };

/** Día `AAAA-MM-DD` de una fecha ISO (hora de Asunción). */
export function dayKeyOf(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Depósito por defecto, ubicación, proveedor, compra y garantía del producto (alta y edición). */
export function ProductTraceFields({
  taxonomy,
  value,
  onChange,
  disabled,
  part = "all",
}: {
  taxonomy: InventoryTaxonomy;
  value: ProductTraceForm;
  onChange: (next: ProductTraceForm) => void;
  disabled?: boolean;
  /** `location`: depósito y ubicación; `supplier`: proveedor, compra y garantía; `all` (default): todo junto. */
  part?: "all" | "location" | "supplier";
}) {
  const patch = (partial: Partial<ProductTraceForm>) => onChange({ ...value, ...partial });
  return (
    <>
      {part !== "supplier" ? (
        <>
      <SelectField
        label="Depósito por defecto"
        help={INVENTORY_FIELD_HELP.defaultWarehouseId}
        value={value.defaultWarehouseId}
        onChange={(next) => patch({ defaultWarehouseId: next })}
        options={warehouseOptions(taxonomy.warehouses, { includeEmpty: "Depósito principal" })}
        disabled={disabled}
      />
      <TextField
        label="Ubicación por defecto"
        help={INVENTORY_FIELD_HELP.defaultLocation}
        value={value.defaultLocation}
        onChange={(next) => patch({ defaultLocation: next })}
        maxLength={40}
        placeholder="Ej.: E3-B2"
        hint="Estante y nivel. Se propone al dar de alta unidades."
        disabled={disabled}
      />
        </>
      ) : null}
      {part !== "location" ? (
        <>
      <SelectField
        label="Proveedor"
        help={INVENTORY_FIELD_HELP.supplierId}
        value={value.supplierId}
        onChange={(next) => patch({ supplierId: next })}
        options={supplierOptions(taxonomy.suppliers, "Sin proveedor")}
        disabled={disabled}
      />
      <DayField label="Fecha de compra" help={INVENTORY_FIELD_HELP.purchasedAt} value={value.purchasedAt} onChange={(next) => patch({ purchasedAt: next })} disabled={disabled} />
      <DayField label="Garantía hasta" help={INVENTORY_FIELD_HELP.warrantyUntil} value={value.warrantyUntil} onChange={(next) => patch({ warrantyUntil: next })} disabled={disabled} />
        </>
      ) : null}
    </>
  );
}

/** Condición «8/10 · 80 %» con tono: ≥ 8 ok, 5 a 7 aviso, ≤ 4 peligro. */
export function ConditionBadge({ score }: { score: number | null | undefined }) {
  if (typeof score !== "number") return <span className="admin-cell-sub">Sin evaluar</span>;
  const tone = score >= 8 ? "ok" : score >= 5 ? "warn" : "danger";
  return <AdminBadge tone={tone} title={`Condición ${score} de 10 (${score * 10} %)`}>{`${score}/10 · ${score * 10} %`}</AdminBadge>;
}

/** Garantía: «vence el 12/11/2026», resaltada si falta menos de 30 días o ya venció. */
export function WarrantyBadge({ until, now = new Date() }: { until: string | null | undefined; now?: Date }) {
  if (!until) return <span className="admin-cell-sub">Sin garantía cargada</span>;
  const days = Math.floor((new Date(until).getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return <AdminBadge tone="danger">{`Venció el ${formatDateShort(until)}`}</AdminBadge>;
  if (days < 30) return <AdminBadge tone="warn">{`Vence el ${formatDateShort(until)} (en ${days} día${days === 1 ? "" : "s"})`}</AdminBadge>;
  return <span>{`Hasta el ${formatDateShort(until)}`}</span>;
}

/** Abreviatura de ubicación de una unidad: «D1-E3-B2». */
export function unitLocationLabel(unit: { warehouseId?: string | null; location?: string | null }, warehouses: readonly AdminWarehouseRow[]): string {
  const warehouse = warehouses.find((entry) => entry.id === unit.warehouseId);
  return formatInventoryLocation(warehouse?.code, unit.location) ?? "—";
}
