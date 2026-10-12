import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFinanceSplitAmounts } from "../lib/finance-split-validation";

test("#129 split preview matches API rounding rather than raw fractional equality", () => {
  assert.deepEqual(validateFinanceSplitAmounts(["1.5", "1.5"], 3), { total: 4, valid: false });
  assert.deepEqual(validateFinanceSplitAmounts(["1.2", "2.8"], 4), { total: 4, valid: true });
  assert.deepEqual(validateFinanceSplitAmounts(["0.4", "2.6"], 3), { total: 3, valid: false });
  assert.deepEqual(validateFinanceSplitAmounts(["100", "200"], 300), { total: 300, valid: true });
});

test("#129 split rejects non-finite, unsafe and non-positive normalized parts", () => {
  for (const amount of ["", "0", "-1", "NaN", "Infinity", "-Infinity", "9007199254740992"]) {
    assert.equal(validateFinanceSplitAmounts([amount, "1"], 1).valid, false, amount);
  }
  assert.equal(validateFinanceSplitAmounts(["9007199254740991", "1"], 9007199254740992).valid, false);
  for (const remaining of [0, -1, NaN, Infinity, 1.5]) {
    assert.equal(validateFinanceSplitAmounts(["1", "1"], remaining).valid, false);
  }
});

test("#129 split honors two through twelve parts and exact pending balance", () => {
  assert.equal(validateFinanceSplitAmounts(["10"], 10).valid, false);
  assert.equal(validateFinanceSplitAmounts(Array(12).fill("1"), 12).valid, true);
  assert.equal(validateFinanceSplitAmounts(Array(13).fill("1"), 13).valid, false);
  assert.equal(validateFinanceSplitAmounts(["100", "201"], 300).valid, false);
  assert.equal(validateFinanceSplitAmounts(["100", "199"], 300).valid, false);
});
