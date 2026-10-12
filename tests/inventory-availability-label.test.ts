import assert from "node:assert/strict";
import { test } from "node:test";
import { inventoryAvailabilityLabel } from "../lib/inventory-availability-label";

for (const [count, free, committed] of [
  [0, "0 libres", "0 comprometidas"],
  [1, "1 libre", "1 comprometida"],
  [2, "2 libres", "2 comprometidas"],
  [1000, "1.000 libres", "1.000 comprometidas"],
] as const) {
  test(`availability ${count} agrees with the actual count`, () => {
    assert.equal(inventoryAvailabilityLabel(count), free);
    assert.equal(inventoryAvailabilityLabel(count, "committed"), committed);
  });
}

test("explicit units agree with free and committed counts", () => {
  assert.equal(inventoryAvailabilityLabel(0, "free", true), "0 unidades libres");
  assert.equal(inventoryAvailabilityLabel(1, "free", true), "1 unidad libre");
  assert.equal(inventoryAvailabilityLabel(2, "free", true), "2 unidades libres");
  assert.equal(inventoryAvailabilityLabel(0, "committed", true), "0 unidades comprometidas");
  assert.equal(inventoryAvailabilityLabel(1, "committed", true), "1 unidad comprometida");
  assert.equal(inventoryAvailabilityLabel(2, "committed", true), "2 unidades comprometidas");
});

for (const count of [null, undefined, NaN, Infinity, -Infinity]) {
  test(`unknown count ${String(count)} stays absent rather than zero`, () => {
    assert.equal(inventoryAvailabilityLabel(count), "Sin datos de disponibilidad");
    assert.equal(inventoryAvailabilityLabel(count, "committed", true), "Sin datos de unidades comprometidas");
  });
}
