import assert from "node:assert/strict";
import { test } from "node:test";
import { inventoryComboSummary, inventoryKnownQuantity, inventoryVariantSummary } from "../lib/inventory-collection-display";

test("la vista conserva opciones de familia sin requerir ejes de catálogo", () => {
  assert.equal(inventoryVariantSummary({ color: "Verde", "tamaño-pulgadas": "32" }), "color: Verde · tamaño pulgadas: 32");
  assert.equal(inventoryVariantSummary(null), null);
  assert.equal(inventoryVariantSummary({ color: "  " }), null);
});

test("cantidad desconocida y cero confirmado siguen siendo distintos al mostrar combos", () => {
  assert.equal(inventoryKnownQuantity(null), "—");
  assert.equal(inventoryKnownQuantity(undefined), "—");
  assert.equal(inventoryKnownQuantity(0), "0");
  assert.equal(inventoryComboSummary([
    { name: "Silla", quantity: 0 },
    { name: "Mesa", quantity: null },
  ]), "Silla × 0 · Mesa × —");
});
