import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetCommercialInputSchema, budgetCommercialTermsSchema, budgetItemCommercialInputSchema, budgetItemCommercialTermsSchema, budgetTariffSnapshotRetentionError, budgetTariffSnapshotSchema, publicBudgetItemCommercialTerms } from "../lib/budget-commercial-contract";

const snapshot = { version: 1 as const, front: "FINAL" as const, normalPrice: 100001, fromDays: 3, fromPrice: 80001, minimumPrice: 60001 };
const legacy = { priceMode: null, tariffSnapshot: null, discountMode: null, discountValue: null, discountAmount: null };
test("legacy null preserves fixed terms; omission is a patch, not a reset", () => {
  assert.deepEqual(budgetItemCommercialTermsSchema.parse(legacy), legacy);
  assert.deepEqual(budgetCommercialTermsSchema.parse({ discountMode: null, discountValue: null, advancePercentBps: null }), { discountMode: null, discountValue: null, advancePercentBps: null });
  assert.deepEqual(budgetCommercialInputSchema.parse({}), {});
  assert.deepEqual(budgetItemCommercialInputSchema.parse({}), {});
});
test("raw schemas reject wrong types, overflow, nonexact percent and unpaired terms", () => {
  for (const value of [-1, 10001, 12.34, "1234", NaN, Infinity]) assert.equal(budgetCommercialInputSchema.safeParse({ advancePercentBps: value }).success, false);
  for (const input of [{ discountMode: "PERCENT", discountValue: 10001 }, { discountMode: "AMOUNT", discountValue: 2147483648 }, { discountMode: null, discountValue: 0 }, { discountMode: "AMOUNT" }, { discountValue: 1 }, { discountMode: "percent", discountValue: 100 }]) assert.equal(budgetCommercialInputSchema.safeParse(input).success, false);
  assert.equal(budgetCommercialInputSchema.safeParse({ discountMode: "PERCENT", discountValue: 1234, advancePercentBps: 0 }).success, true);
  assert.equal(budgetItemCommercialInputSchema.safeParse({ discountAmount: 1 }).success, false);
  assert.equal(budgetTariffSnapshotSchema.safeParse({ ...snapshot, costPrice: 1 }).success, false);
  assert.equal(budgetTariffSnapshotSchema.safeParse({ ...snapshot, wholesalePrice: 1 }).success, false);
  assert.equal(budgetTariffSnapshotSchema.safeParse({ ...snapshot, version: 2 }).success, false);
});
test("effective-front-only preview; manual mode preserves and exposes binding floor", () => {
  const tariff = { ...legacy, priceMode: "TARIFF" as const, tariffSnapshot: snapshot };
  assert.deepEqual(publicBudgetItemCommercialTerms(tariff).tariffSnapshot, snapshot);
  const manual = { ...tariff, priceMode: "MANUAL" as const };
  const publicManual = publicBudgetItemCommercialTerms(manual);
  assert.equal(publicManual.tariffSnapshot, null);
  assert.equal(publicManual.minimumPrice, 60001);
  assert.equal(budgetTariffSnapshotRetentionError(tariff, manual), null);
  assert.ok(budgetTariffSnapshotRetentionError(manual, { ...manual, tariffSnapshot: null }));
  assert.ok(budgetTariffSnapshotRetentionError(manual, { ...manual, tariffSnapshot: { ...snapshot, minimumPrice: 0 } }));
  assert.equal(publicBudgetItemCommercialTerms(legacy).minimumPrice, null);
  assert.equal(budgetItemCommercialTermsSchema.safeParse({ ...legacy, priceMode: "TARIFF" }).success, false);
});
