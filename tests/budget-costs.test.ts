import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discountForPrice,
  distributePrice,
  internalCostOf,
  marginOf,
  priceForMargin,
} from "../lib/budget-costs";

/**
 * Costos internos, margen y precio final (issue #65). Fija la aritmética que el
 * panel usa para no vender por debajo del costo ni mostrar números inventados:
 * costo interno = materiales + mano de obra + ítems, margen sobre el precio,
 * precio sugerido `costo / (1 − margen)` y reparto del precio entre los ítems.
 */

test("el costo interno suma materiales, mano de obra e ítems", () => {
  const cost = internalCostOf({
    materialCost: 5_105_000,
    laborCost: 3_000_000,
    items: [
      { quantity: 4, days: 2, costPrice: 100_000 },
      { quantity: 1, days: 1, costPrice: 250_000 },
    ],
  });
  assert.deepEqual(cost, { materials: 5_105_000, labor: 3_000_000, items: 1_050_000, total: 9_155_000 });
});

test("el caso del dueño: 8.105.000 de costo sin ítems con costo", () => {
  const cost = internalCostOf({ materialCost: 5_105_000, laborCost: 3_000_000, items: [] });
  assert.equal(cost.total, 8_105_000);
});

test("montos raros no ensucian el costo (negativos, NaN, decimales)", () => {
  const cost = internalCostOf({
    materialCost: -50_000,
    laborCost: Number.NaN,
    items: [{ quantity: 2.4, days: -1, costPrice: 10_000.6 }],
  });
  assert.equal(cost.materials, 0);
  assert.equal(cost.labor, 0);
  assert.equal(cost.items, 0);
  assert.equal(cost.total, 0);
});

test("el margen es sobre el precio final y queda en null sin precio o sin costo", () => {
  assert.deepEqual(marginOf(10_000_000, 8_105_000), { amount: 1_895_000, percent: 18.95 });
  assert.equal(marginOf(0, 8_105_000), null);
  assert.equal(marginOf(10_000_000, 0), null);
});

test("el precio sugerido sale del costo y el margen pedido", () => {
  assert.equal(priceForMargin(8_105_000, 30), 11_578_571);
  // El margen del precio sugerido vuelve al pedido (redondeo de guaraníes de por medio).
  const price = priceForMargin(8_105_000, 30) as number;
  const margin = marginOf(price, 8_105_000);
  assert.ok(margin && Math.abs(margin.percent - 30) < 0.01);
  assert.equal(priceForMargin(0, 30), null);
  assert.equal(priceForMargin(1_000_000, 100), null);
  assert.equal(priceForMargin(1_000_000, -5), null);
});

test("un precio final que entra en los ítems se aplica como descuento", () => {
  assert.deepEqual(discountForPrice(12_000_000, 10_000_000), { ok: true, total: 10_000_000, discount: 2_000_000 });
  assert.deepEqual(discountForPrice(12_000_000, 12_000_000), { ok: true, total: 12_000_000, discount: 0 });
});

test("un precio por encima de los ítems dice cuánto falta para subir precios", () => {
  assert.deepEqual(discountForPrice(12_000_000, 13_500_000), { ok: false, needed: 1_500_000 });
});

test("repartir un precio entre los ítems deja la suma pegada al objetivo", () => {
  const items = [
    { id: "a", quantity: 4, days: 1, unitPrice: 500_000 },
    { id: "b", quantity: 1, days: 1, unitPrice: 1_000_000 },
  ];
  const distributed = distributePrice(items, 4_000_000);
  assert.equal(distributed.items.length, 2);
  assert.ok(Math.abs(distributed.subtotal - 4_000_000) <= items.length, `subtotal ${distributed.subtotal}`);
  // Todos los precios siguen enteros y positivos, y los ids no cambian.
  for (const row of distributed.items) {
    assert.ok(Number.isInteger(row.unitPrice) && row.unitPrice > 0);
  }
  assert.deepEqual(distributed.items.map((row) => row.id), ["a", "b"]);
  // No toca la entrada.
  assert.equal(items[0].unitPrice, 500_000);
  assert.equal(items[1].unitPrice, 1_000_000);
});

test("repartir con datos vacíos o en cero no rompe", () => {
  assert.deepEqual(distributePrice([], 5_000_000), { items: [], subtotal: 0 });
  const zero = distributePrice([{ id: "a", quantity: 2, days: 1, unitPrice: 0 }], 5_000_000);
  assert.equal(zero.subtotal, 0);
  assert.equal(zero.items[0].unitPrice, 0);
});

test("el precio sugerido se puede repartir en ítems y el margen se mantiene", () => {
  const cost = internalCostOf({ materialCost: 5_105_000, laborCost: 3_000_000, items: [] });
  const price = priceForMargin(cost.total, 35) as number;
  const distributed = distributePrice(
    [
      { id: "a", quantity: 4, days: 1, unitPrice: 1_000_000 },
      { id: "b", quantity: 2, days: 3, unitPrice: 500_000 },
    ],
    price,
  );
  const margin = marginOf(distributed.subtotal, cost.total);
  assert.ok(margin && margin.percent > 34.9 && margin.percent < 35.1, `margen ${margin?.percent}`);
});
