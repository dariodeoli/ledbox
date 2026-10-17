import assert from "node:assert/strict";
import test from "node:test";
import { bulkUnitPlacementError, readBulkChanges, readBulkSelection } from "../lib/inventory-bulk";

test("selección explícita acotada rechaza vacíos, duplicados y IDs no válidos", () => {
  assert.deepEqual(readBulkSelection(["a", "b"]), ["a", "b"]);
  for (const ids of [[], ["a", "a"], [""], [3], "a", Array.from({ length: 101 }, (_, i) => String(i))]) assert.equal(readBulkSelection(ids), null);
});
test("no cambiar y vaciar son distintos y no permiten borrar estado/categoría ni campos fuera de contrato", () => {
  assert.deepEqual(readBulkChanges("items", { notes: null, listFromDays: null, listPrice: null }), { notes: "", listFromDays: 0, listPrice: 0 });
  assert.deepEqual(readBulkChanges("units", { notes: null, purchaseCost: null }), { notes: "", purchaseCost: 0 });
  for (const changes of [{}, { notes: "" }, { notes: false }, { status: null }, { quantity: 4 }, { code: "XX" }, { category: "A".repeat(81) }]) assert.equal(readBulkChanges("items", changes), null);
  assert.equal(readBulkChanges("units", { repairBudget: 1000 }), null);
});
test("bulk valida Int real sin coerción y conserva segmentos final/mayorista independientes", () => {
  for (const number of [-1, 1.5, "1000", 2147483648, NaN, Infinity]) assert.equal(readBulkChanges("items", { listPrice: number }), null);
  assert.equal(readBulkChanges("items", { listFromDays: 3651 }), null);
  assert.deepEqual(readBulkChanges("items", { listPrice: 1000, wholesaleFromDays: 3, wholesaleFromPrice: 700, catalogAudience: "RETAIL" }), { listPrice: 1000, wholesaleFromDays: 3, wholesaleFromPrice: 700, catalogAudience: "RETAIL" });
  assert.equal(readBulkChanges("items", { catalogAudience: "ALL" }), null, "el alcance solo admite Oculto, Cliente final, Mayorista o Ambos");
  assert.equal(readBulkChanges("items", { visibleOnWeb: true }), null, "el booleano viejo ya no es un campo masivo");
  assert.equal(readBulkChanges("units", { notes: "A".repeat(401) }), null);
});

test("edición física en lote protege reservas y solo mueve unidades disponibles", () => {
  const available = { status: "AVAILABLE", warehouseId: "d1", location: "A1" };
  assert.equal(bulkUnitPlacementError([available], { notes: "nota" }, true), null, "editar notas no depende de las reservas");
  assert.equal(bulkUnitPlacementError([available], { warehouseId: "d1" }, true), null, "no-op de depósito no bloquea una reserva");
  assert.equal(bulkUnitPlacementError([available], { location: "A1" }, true), null, "no-op de ubicación no bloquea una reserva");
  assert.match(bulkUnitPlacementError([available], { warehouseId: "d2" }, true)!, /reservas o asignaciones/);
  assert.match(bulkUnitPlacementError([available], { location: "B2" }, true)!, /reservas o asignaciones/);
  assert.match(bulkUnitPlacementError([{ ...available, status: "MAINTENANCE" }], { warehouseId: "d2" }, false)!, /unidades disponibles/);
  assert.equal(bulkUnitPlacementError([available], { location: "" }, false), null, "vaciar la ubicación no cambia estado ni crea stock");
  assert.equal(bulkUnitPlacementError([available], { warehouseId: "d2", location: "B2" }, false), null);
});
