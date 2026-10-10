import assert from "node:assert/strict";
import { test } from "node:test";
import { stableOrderBudgetItems } from "../lib/budget-item-order";

test("A15 canonical order preserves legacy NULL and ties without mutating input", () => {
  const legacy = [{ id: "z", sortOrder: null }, { id: "a", sortOrder: null }];
  assert.deepEqual(stableOrderBudgetItems(legacy), legacy);
  const mixed = [legacy[0], { id: "second", sortOrder: 1 }, legacy[1], { id: "first", sortOrder: 0 }, { id: "tie", sortOrder: 1 }];
  assert.deepEqual(stableOrderBudgetItems(mixed).map((item) => item.id), ["first", "second", "tie", "z", "a"]);
  assert.equal(mixed[0].id, "z");
  assert.notEqual(stableOrderBudgetItems(legacy), legacy);
});
