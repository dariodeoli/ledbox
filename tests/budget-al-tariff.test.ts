import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteProductPrice } from "../lib/quote-sharing";

test("AL tariff: explicit FINAL/WHOLESALE thresholds are independent through successive duration edits", () => {
  const product = { listPrice: 100001, listFromDays: 3, listFromPrice: 80001, wholesalePrice: 70001, wholesaleFromDays: 5, wholesaleFromPrice: 60001, minimumPrice: 50000 };
  for (const [days, final, wholesale] of [[2, 100001, 70001], [3, 80001, 70001], [5, 80001, 60001], [1, 100001, 70001], [365, 80001, 60001]]) {
    assert.equal(quoteProductPrice(product, days), final);
    assert.equal(quoteProductPrice(product, days, "WHOLESALE"), wholesale);
  }
});

test("AL tariff: zero disables thresholds, existing floor applies to configured prices without inventing a missing price", () => {
  const product = { listPrice: 100, listFromDays: 0, listFromPrice: 60, wholesalePrice: 80, wholesaleFromDays: 3, wholesaleFromPrice: 40, minimumPrice: 50 };
  assert.equal(quoteProductPrice(product, 365), 100);
  assert.equal(quoteProductPrice(product, 2, "WHOLESALE"), 80);
  assert.equal(quoteProductPrice(product, 3, "WHOLESALE"), 50);
  assert.equal(quoteProductPrice({ ...product, listFromDays: 3, listFromPrice: 0 }, 3), 100);
  assert.equal(quoteProductPrice({ ...product, wholesaleFromDays: 0 }, 365, "WHOLESALE"), 80);
  assert.equal(quoteProductPrice({ minimumPrice: 50 }, 10), 0);
  assert.equal(quoteProductPrice({ ...product, wholesalePrice: 0, wholesaleFromPrice: 0 }, 10, "WHOLESALE"), 0);
  assert.equal(quoteProductPrice({ listPrice: 2147483647 }, 1), 2147483647);
});
