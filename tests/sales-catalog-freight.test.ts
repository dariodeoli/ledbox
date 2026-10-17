import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateSalesCatalogFreightUsd } from "../lib/sales-catalog-volume";

test("CBM freight is calculated exactly from the explicit company rate", () => {
  assert.deepEqual(calculateSalesCatalogFreightUsd("0.148", "250"), {
    status: "known",
    freightUsd: "37",
  });
  assert.deepEqual(calculateSalesCatalogFreightUsd("0.0303", "200.50"), {
    status: "known",
    freightUsd: "6.07515",
  });
});

test("unknown CBM or unconfigured rate remains unknown rather than zero", () => {
  assert.deepEqual(calculateSalesCatalogFreightUsd(null, "250"), { status: "missing", freightUsd: null });
  assert.deepEqual(calculateSalesCatalogFreightUsd("0.148", null), { status: "missing", freightUsd: null });
});

test("invalid volume and negative or malformed rates require correction", () => {
  assert.deepEqual(calculateSalesCatalogFreightUsd("0", "250"), { status: "invalid", freightUsd: null, field: "cbm" });
  assert.deepEqual(calculateSalesCatalogFreightUsd("0.148", "-250"), { status: "invalid", freightUsd: null, field: "usdPerCbm" });
  assert.deepEqual(calculateSalesCatalogFreightUsd("0.148", "250,5"), { status: "invalid", freightUsd: null, field: "usdPerCbm" });
  assert.deepEqual(calculateSalesCatalogFreightUsd("0.148", "0"), { status: "known", freightUsd: "0" });
});
