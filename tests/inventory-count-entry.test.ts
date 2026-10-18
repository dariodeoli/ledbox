import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInventoryCountLines } from "../lib/inventory-count-entry";

test("conteo físico: acepta cero confirmado y conserva producto/depósito", () => {
  assert.deepEqual(buildInventoryCountLines([
    { inventoryId: "item-1", warehouseId: "warehouse-1", countedQuantity: "0" },
  ]), {
    ok: true,
    lines: [{ inventoryId: "item-1", warehouseId: "warehouse-1", countedQuantity: 0 }],
  });
});

test("conteo físico: cantidad vacía no se convierte silenciosamente en cero", () => {
  assert.deepEqual(buildInventoryCountLines([
    { inventoryId: "item-1", warehouseId: "warehouse-1", countedQuantity: "" },
  ]), { ok: false, error: "Completá producto, depósito y cantidad contada en cada fila." });
});

test("conteo físico: rechaza duplicados del mismo producto y depósito", () => {
  const result = buildInventoryCountLines([
    { inventoryId: "item-1", warehouseId: "warehouse-1", countedQuantity: "2" },
    { inventoryId: "item-1", warehouseId: "warehouse-1", countedQuantity: "3" },
  ]);
  assert.deepEqual(result, { ok: false, error: "No repitas un producto en el mismo depósito." });
});

test("conteo físico: permite el mismo producto en depósitos distintos", () => {
  const result = buildInventoryCountLines([
    { inventoryId: "item-1", warehouseId: "warehouse-1", countedQuantity: "2" },
    { inventoryId: "item-1", warehouseId: "warehouse-2", countedQuantity: "3" },
  ]);
  assert.equal(result.ok, true);
});

test("conteo físico: no permite guardar una sesión vacía", () => {
  assert.deepEqual(buildInventoryCountLines([]), {
    ok: false,
    error: "La sesión debe incluir entre 1 y 500 productos.",
  });
});
