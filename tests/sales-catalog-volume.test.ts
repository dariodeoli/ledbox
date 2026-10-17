import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSalesCatalogCbm } from "../lib/sales-catalog-volume";

test("sale catalog CBM is calculated exactly from complete centimeter dimensions", () => {
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: 50, anchoCm: 30, largoCm: 20 }), {
    status: "known",
    cbm: "0.03",
    source: "dimensions",
  });
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: "50.5", anchoCm: 30, largoCm: 20 }), {
    status: "known",
    cbm: "0.0303",
    source: "dimensions",
  });
});

test("unknown volume remains missing instead of becoming zero", () => {
  assert.deepEqual(resolveSalesCatalogCbm({}), { status: "missing", cbm: null });
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: null, anchoCm: "", largoCm: undefined }), { status: "missing", cbm: null });
});

test("partial dimensions and malformed or non-positive values require correction", () => {
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: 50, anchoCm: null, largoCm: 20 }), {
    status: "incomplete",
    cbm: null,
    missing: ["anchoCm"],
  });
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: 0, anchoCm: 30, largoCm: 20 }), {
    status: "invalid",
    cbm: null,
    field: "altoCm",
  });
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: "50,5", anchoCm: 30, largoCm: 20 }), {
    status: "invalid",
    cbm: null,
    field: "altoCm",
  });
});

test("explicit CBM can be used alone, while conflicts with dimensions remain unresolved", () => {
  assert.deepEqual(resolveSalesCatalogCbm({ cbm: "0.148" }), {
    status: "known",
    cbm: "0.148",
    source: "provided",
  });
  assert.deepEqual(resolveSalesCatalogCbm({ altoCm: 50, anchoCm: 30, largoCm: 20, cbm: "0.04" }), {
    status: "conflict",
    cbm: null,
    providedCbm: "0.04",
    dimensionsCbm: "0.03",
  });
});
