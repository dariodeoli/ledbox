import assert from "node:assert/strict";
import { test } from "node:test";
import { applyInventoryFilters, EMPTY_GRID_FILTERS, activeFilterCount } from "../lib/inventory-grid-view";
import { readBulkChanges, ITEM_BULK_UI_FIELDS } from "../lib/inventory-bulk";
import type { AdminInventoryGridRow } from "../lib/admin-types";
const context = { openIncidentIds: new Set<string>(), unitMatchIds: new Set<string>(), categoryTree: [], now: new Date() };
const empty = { id: "empty", name: "Ficha sin stock", kind: "REUSABLE", status: "AVAILABLE", archivedAt: null, defaultWarehouseId: "d2", quantity: 0, stockCountStatus: "PENDING_COUNT", stock: { unitCount: 0, locations: [], supplierIds: [] } } as unknown as AdminInventoryGridRow;
const physical = { ...empty, id: "physical", quantity: 3, stockCountStatus: "CONFIRMED", stock: { unitCount: 3, locations: [{ warehouseId: "d1", location: "A1", units: 3 }], supplierIds: [] } } as AdminInventoryGridRow;
const filter = (change: Partial<typeof EMPTY_GRID_FILTERS>) => applyInventoryFilters([empty, physical], { ...EMPTY_GRID_FILTERS, ...change }, context).map(row => row.id);
test("catálogo D2 incluye ficha sin stock; filtro físico sigue D1 y ambos se combinan con AND", () => {
  assert.deepEqual(filter({ defaultWarehouseId: "d2" }), ["empty", "physical"]);
  assert.deepEqual(filter({ warehouseId: "d2" }), []);
  assert.deepEqual(filter({ warehouseId: "d1" }), ["physical"]);
  assert.deepEqual(filter({ defaultWarehouseId: "d2", warehouseId: "d1" }), ["physical"]);
  assert.deepEqual(filter({ defaultWarehouseId: "d1", warehouseId: "d1" }), []);
  assert.equal(activeFilterCount({ ...EMPTY_GRID_FILTERS, defaultWarehouseId: "d2", warehouseId: "d1" }, false), 2);
  assert.equal(empty.quantity, 0); assert.deepEqual(empty.stock.locations, []);
});
test("mismo parser masivo admite defaults explícitos sin convertirlos en movimientos ni cantidades", () => {
  assert.deepEqual(readBulkChanges("items", { defaultWarehouseId: "d3", defaultLocation: "A1" }), { defaultWarehouseId: "d3", defaultLocation: "A1" });
  assert.deepEqual(readBulkChanges("items", { defaultLocation: null }), { defaultLocation: "" });
  for (const changes of [{ defaultWarehouseId: "" }, { defaultWarehouseId: null }, { quantity: 3 }, { warehouseId: "d3" }, { defaultLocation: "x".repeat(41) }]) assert.equal(readBulkChanges("items", changes), null);
  assert.ok(ITEM_BULK_UI_FIELDS.some(field => field.key === "defaultWarehouseId"));
  assert.ok(ITEM_BULK_UI_FIELDS.some(field => field.key === "defaultLocation"));
});
