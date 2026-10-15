import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminInventoryGridRow } from "../lib/admin-types";
import { formatInventoryLocation } from "../lib/field-rules";
import {
  EMPTY_GRID_FILTERS,
  UNCATEGORIZED_ID,
  activeFilterCount,
  applyInventoryFilters,
  categoryFilterOptions,
  categoryScope,
  groupByCategory,
  locationSummary,
  type InventoryFilterContext,
  type InventoryGridFilters,
} from "../lib/inventory-grid-view";
import { buildCategoryTree } from "../lib/inventory-categories";

const NOW = new Date(2026, 9, 15, 10, 0, 0);

const tree = buildCategoryTree([
  { id: "c-vajilla", name: "Vajilla", parentId: null, key: "vajilla", sortOrder: 2, color: null, icon: null, archivedAt: null, itemCount: 0 },
  { id: "c-copas", name: "Copas", parentId: "c-vajilla", key: "vajilla/copas", sortOrder: 1, color: null, icon: null, archivedAt: null, itemCount: 0 },
  { id: "c-sillas", name: "Sillas", parentId: null, key: "sillas", sortOrder: 1, color: null, icon: null, archivedAt: null, itemCount: 0 },
]);

function row(id: string, overrides: Partial<AdminInventoryGridRow> = {}, availability: Partial<AdminInventoryGridRow["availability"]> = {}): AdminInventoryGridRow {
  return {
    id,
    name: id,
    category: "Vajilla",
    categoryId: "c-vajilla",
    sku: null,
    kind: "REUSABLE",
    status: "AVAILABLE",
    archivedAt: null,
    quantity: 10,
    catalogAudience: "HIDDEN",
    visibleOnWeb: false,
    supplierId: null,
    stock: { unitCount: 10, locations: [{ warehouseId: "d1", location: "E3-B2", units: 10 }], supplierIds: [] },
    availability: { committedNow: 0, availableNow: 10, overcommittedNow: false, maintenanceNow: 0, unitsByStatus: { AVAILABLE: 10 }, holdByKind: {}, nextCommittedAt: null, overduePending: 0, ...availability },
    ...overrides,
  } as AdminInventoryGridRow;
}

const context = (extra: Partial<InventoryFilterContext> = {}): InventoryFilterContext => ({ openIncidentIds: new Set(), now: NOW, unitMatchIds: new Set(), categoryTree: tree, ...extra });
const filters = (extra: Partial<InventoryGridFilters>): InventoryGridFilters => ({ ...EMPTY_GRID_FILTERS, ...extra });
const ids = (rows: AdminInventoryGridRow[]) => rows.map((entry) => entry.id);

const catalog = [
  row("copa", { name: "Copa de vino", sku: "COP-V", category: "Vajilla › Copas", categoryId: "c-copas", stock: { unitCount: 40, locations: [{ warehouseId: "d1", location: "E1", units: 30 }, { warehouseId: "d2", location: null, units: 10 }], supplierIds: ["p1"] } }, { availableNow: 12, committedNow: 20 }),
  row("plato", { name: "Plato llano", sku: "PLA-1", supplierId: "p2" }, { availableNow: 0, committedNow: 10 }),
  row("silla", { name: "Silla Tiffany", category: "Sillas", categoryId: "c-sillas", kind: "CONSUMABLE", stock: { unitCount: 0, locations: [], supplierIds: [] } }, { availableNow: 0, overduePending: 4 }),
  row("mesa", { name: "Mesa vieja", category: "Mobiliario", categoryId: null }, { availableNow: 0, unitsByStatus: { DAMAGED: 2 } }),
  row("vieja", { name: "Bandeja", archivedAt: "2026-09-01T00:00:00Z" }),
];

test("cada filtro recorta por su dato real", () => {
  const run = (extra: Partial<InventoryGridFilters>, ctx = context()) => ids(applyInventoryFilters(catalog, filters(extra), ctx));
  assert.deepEqual(run({}), ["copa", "plato", "silla", "mesa"], "las archivadas no están en la lista activa");
  assert.deepEqual(run({ kind: "CONSUMABLE" }), ["silla"]);
  assert.deepEqual(run({ categoryId: "c-vajilla" }), ["copa", "plato"], "la categoría padre incluye sus subcategorías");
  assert.deepEqual(run({ categoryId: "c-copas" }), ["copa"]);
  assert.deepEqual(run({ warehouseId: "d2" }), ["copa"]);
  assert.deepEqual(run({ supplierId: "p1" }), ["copa"], "proveedor de una unidad");
  assert.deepEqual(run({ supplierId: "p2" }), ["plato"], "proveedor del producto");
  assert.deepEqual(run({ state: "overdue" }), ["silla"]);
  assert.deepEqual(run({ state: "rented" }), ["plato"]);
  assert.deepEqual(run({ state: "damaged" }), ["mesa"]);
  assert.deepEqual(run({ state: "available" }), ["copa"]);
  assert.deepEqual(run({ query: "tiffany" }), ["silla"]);
  assert.deepEqual(run({ query: "cop-v" }), ["copa"], "SKU");
  assert.deepEqual(run({ query: "copa" }, context()), ["copa"]);
});

test("la búsqueda por código de unidad usa los ids que devuelve el API", () => {
  assert.deepEqual(ids(applyInventoryFilters(catalog, filters({ query: "KIO-07" }), context())), []);
  assert.deepEqual(ids(applyInventoryFilters(catalog, filters({ query: "KIO-07" }), context({ unitMatchIds: new Set(["plato"]) }))), ["plato"]);
});

test("los filtros se combinan con «Y»", () => {
  const run = (extra: Partial<InventoryGridFilters>) => ids(applyInventoryFilters(catalog, filters(extra), context()));
  assert.deepEqual(run({ categoryId: "c-vajilla", state: "rented" }), ["plato"]);
  assert.deepEqual(run({ categoryId: "c-vajilla", state: "rented", warehouseId: "d2" }), []);
  assert.deepEqual(run({ categoryId: "c-vajilla", warehouseId: "d1", supplierId: "p1", state: "available", query: "vino", kind: "REUSABLE" }), ["copa"]);
  assert.deepEqual(run({ kind: "CONSUMABLE", state: "overdue", focus: "incidents" }), [], "la silla vencida no tiene incidentes abiertos");
  assert.deepEqual(run({ state: "damaged", focus: "incidents" }), ["mesa"], "daño en unidades cuenta como incidente");
});

test("el estado «Archivado» muestra las archivadas y el resto de los filtros sigue valiendo", () => {
  assert.deepEqual(ids(applyInventoryFilters(catalog, filters({ state: "archived" }), context(), { archived: true })), ["vieja"]);
  assert.deepEqual(ids(applyInventoryFilters(catalog, filters({ categoryId: "c-sillas" }), context(), { archived: true })), []);
});

test("los indicadores filtran sobre la fila liviana (libres, semana, incidentes)", () => {
  const week = row("sem", {}, { nextCommittedAt: new Date(2026, 9, 18).toISOString() });
  const far = row("lejos", {}, { nextCommittedAt: new Date(2026, 10, 18).toISOString() });
  const rows = [week, far, ...catalog];
  assert.deepEqual(ids(applyInventoryFilters(rows, filters({ focus: "week" }), context())), ["sem", "copa", "plato"]);
  assert.deepEqual(ids(applyInventoryFilters(rows, filters({ focus: "free" }), context())), ["sem", "lejos", "copa"]);
  assert.deepEqual(ids(applyInventoryFilters(rows, filters({ focus: "incidents" }), context({ openIncidentIds: new Set(["plato"]) }))), ["plato", "mesa"]);
});

test("el árbol de categorías da las opciones y el alcance del filtro", () => {
  assert.deepEqual(categoryFilterOptions(tree).map((option) => option.value), ["", "c-sillas", "c-vajilla", "c-copas"]);
  assert.match(categoryFilterOptions(tree)[3].label, /› Copas$/);
  assert.deepEqual([...categoryScope(tree, "c-vajilla")].sort(), ["c-copas", "c-vajilla"]);
  assert.deepEqual([...categoryScope(tree, "c-copas")], ["c-copas"]);
  assert.equal(categoryScope(tree, "").size, 0);
});

test("por categoría: secciones por sortOrder, sin categoría al final y libres sumados", () => {
  const sections = groupByCategory(applyInventoryFilters(catalog, filters({}), context()), tree);
  assert.deepEqual(sections.map((section) => section.name), ["Sillas", "Vajilla", "Sin categoría"]);
  assert.equal(sections[2].id, UNCATEGORIZED_ID);
  const vajilla = sections[1];
  assert.deepEqual(vajilla.rows.map((entry) => entry.id), ["plato", "copa"], "ordena por subcategoría y nombre");
  assert.equal(vajilla.free, 12);
  assert.equal(groupByCategory([], tree).length, 0, "una sección vacía no se dibuja");
});

test("ubicación: abreviatura si hay un solo lugar, «N depósitos» si hay varios, «—» sin datos", () => {
  const warehouses = [{ id: "d1", code: "D1" }, { id: "d2", code: "D2" }];
  const one = locationSummary({ unitCount: 5, locations: [{ warehouseId: "d1", location: "E3-B2", units: 5 }], supplierIds: [] }, warehouses, formatInventoryLocation);
  assert.equal(one.text, "D1-E3-B2");
  const many = locationSummary(catalog[0].stock, warehouses, formatInventoryLocation);
  assert.equal(many.text, "2 depósitos");
  assert.equal(locationSummary({ unitCount: 0, locations: [], supplierIds: [] }, warehouses, formatInventoryLocation).text, "—");
  const shelves = locationSummary({ unitCount: 9, locations: [{ warehouseId: "d1", location: "E1", units: 4 }, { warehouseId: "d1", location: "E2", units: 5 }], supplierIds: [] }, warehouses, formatInventoryLocation);
  assert.equal(shelves.text, "D1 · 2 ubicaciones");
});

test("la cuenta de filtros activos incluye el rango", () => {
  assert.equal(activeFilterCount(EMPTY_GRID_FILTERS, false), 0);
  assert.equal(activeFilterCount(filters({ query: "a", state: "rented" }), true), 3);
});
