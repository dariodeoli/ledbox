import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetPercentAmount, calculateBudgetCommercial, type CommercialLine } from "../lib/budget-commercial-calculation";

const terms = { discountMode: "PERCENT" as const, discountValue: 500, advancePercentBps: 3000 };
const line = (patch: Partial<CommercialLine> = {}): CommercialLine => ({ id: "a", sortOrder: 0, quantity: 2, days: 3, unitPrice: 100001, priceMode: "TARIFF", tariffSnapshot: { version: 1, front: "FINAL", normalPrice: 100001, fromDays: 3, fromPrice: 80001, minimumPrice: 50000 }, discountMode: "PERCENT", discountValue: 1000, discountAmount: 0, ...patch });

test("AL discounts once each and advance against final negotiated total, with successive duration edits", () => {
  for (const [days, subtotal, discount, total, advance] of [[3, 432005, 21600, 410405, 123122], [2, 360004, 18000, 342004, 102601], [3, 432005, 21600, 410405, 123122]]) {
    const result = calculateBudgetCommercial([line({ days })], terms, 999, 888);
    assert.deepEqual([result.subtotal, result.discount, result.total, result.advanceAmount], [subtotal, discount, total, advance]);
  }
  assert.equal(budgetPercentAmount(1, 5000), 1);
  assert.equal(budgetPercentAmount(2147483647, 10000), 2147483647);
});

test("AL largest remainders uses sortOrder then persistent id, independent of query order", () => {
  const rows = [line({ id: "c", sortOrder: null }), line({ id: "b", sortOrder: 0 }), line({ id: "a", sortOrder: 0 })].map((row) => ({ ...row, quantity: 1, days: 1, unitPrice: 10, priceMode: null, tariffSnapshot: null, discountMode: null, discountValue: null, discountAmount: null } as CommercialLine));
  const calc = (items: CommercialLine[]) => calculateBudgetCommercial(items, { discountMode: "AMOUNT", discountValue: 2, advancePercentBps: null }, 0, 0);
  assert.deepEqual(Object.fromEntries(calc(rows).items.map((item) => [item.id, item.globalDiscountAmount])), { c: 0, b: 1, a: 1 });
  assert.deepEqual(Object.fromEntries(calc([...rows].reverse()).items.map((item) => [item.id, item.globalDiscountAmount])), { a: 1, b: 1, c: 0 });
});

test("AL floor applies after line/global and MANUAL retains it; no clamp/redistribution/legacy invented floor", () => {
  assert.throws(() => calculateBudgetCommercial([line({ discountValue: 5000 })], terms, 0, 0), /piso/);
  assert.throws(() => calculateBudgetCommercial([line({ priceMode: "MANUAL", unitPrice: 40000, discountMode: null, discountValue: null, discountAmount: null })], terms, 0, 0), /piso/);
  assert.throws(() => calculateBudgetCommercial([line()], { ...terms, discountValue: 5000 }, 0, 0), /piso/);
  assert.throws(() => calculateBudgetCommercial([line({ discountMode: "AMOUNT", discountValue: 500000 })], terms, 0, 0), /base/);
  const legacy = line({ quantity: 1, days: 1, unitPrice: 10, priceMode: null, tariffSnapshot: null, discountMode: null, discountValue: null, discountAmount: null });
  assert.equal(calculateBudgetCommercial([legacy], { discountMode: null, discountValue: null, advancePercentBps: null }, 0, 7).advanceAmount, 7);
  assert.throws(() => calculateBudgetCommercial([legacy], { discountMode: null, discountValue: null, advancePercentBps: null }, 11, 0), /base/);
  assert.throws(() => calculateBudgetCommercial([line({ quantity: 9999, days: 9999 })], terms, 0, 0), /Int/);
});
