import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateSalesCatalogCosting,
  parseSalesCatalogCostingInput,
  salesCatalogPriceSuggestions,
  suggestSalesCatalogPricePyg,
  type SalesCatalogCostingInput,
} from "../lib/sales-catalog-costing";

const input: SalesCatalogCostingInput = {
  purchaseCost: { amount: "100", currency: "USD", pygPerCurrency: "7500" },
  transportToChinaPort: { amount: "20", currency: "USD", pygPerCurrency: "7500" },
  otherCosts: [{ amount: "10000", currency: "PYG", pygPerCurrency: null }],
  volume: { altoCm: "100", anchoCm: "50", largoCm: "40", cbm: null },
  freight: { usdPerCbm: "250", pygPerUsd: "7500" },
  importation: { percent: "25", basisPyg: "1425000" },
};

test("valida los campos estructurados sin valores por defecto ni persistencia", () => {
  assert.equal(parseSalesCatalogCostingInput(input).success, true);
  assert.equal(parseSalesCatalogCostingInput({ ...input, purchaseCost: { ...input.purchaseCost, amount: null } }).success, true);
  assert.equal(parseSalesCatalogCostingInput({ ...input, purchaseCost: { amount: "-1", currency: "USD", pygPerCurrency: "7500" } }).success, false);
  assert.equal(parseSalesCatalogCostingInput({ ...input, freight: { ...input.freight, usdPerCbm: "250,5" } }).success, false);
  assert.equal(parseSalesCatalogCostingInput({ ...input, freight: { ...input.freight, pygPerUsd: "0" } }).success, false);
  assert.equal(parseSalesCatalogCostingInput({ ...input, purchaseCost: { ...input.purchaseCost, pygPerCurrency: "0" } }).success, false);
  assert.equal(parseSalesCatalogCostingInput({ ...input, purchaseCost: { amount: "1", currency: "PYG", pygPerCurrency: "2" } }).success, false);
});

test("calcula CBM, flete e importación desde parámetros explícitos y suma costo puesto", () => {
  const result = calculateSalesCatalogCosting(input);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  assert.deepEqual({ ...result, priceSuggestions: undefined }, {
    status: "complete",
    cbm: "0.2",
    freightUsd: "50",
    freightPyg: "375000",
    importationPyg: "356250",
    landedCostPyg: "1641250",
    priceSuggestions: undefined,
  });
  const { custom, ...standardSuggestions } = result.priceSuggestions;
  assert.deepEqual(standardSuggestions, { margin20: "2051563", margin30: "2344643", margin40: "2735417", margin50: "3282500" });
  assert.equal(custom("35"), "2525000");
});

test("los componentes desconocidos impiden presentar un costo puesto completo", () => {
  const result = calculateSalesCatalogCosting({
    ...input,
    purchaseCost: { ...input.purchaseCost, amount: null },
    importation: { percent: "25", basisPyg: null },
  });
  assert.equal(result.status, "incomplete");
  if (result.status === "incomplete") {
    assert.deepEqual(result.missing, ["purchaseCost", "importation.basisPyg"]);
    assert.equal(result.knownComponentsPyg.freightPyg, "375000");
    assert.equal(result.knownComponentsPyg.importationPyg, undefined);
  }
});

test("no infiere importación si falta tasa o base explícita", () => {
  for (const importation of [{ percent: null, basisPyg: "1425000" }, { percent: "25", basisPyg: null }]) {
    const result = calculateSalesCatalogCosting({ ...input, importation });
    assert.equal(result.status, "incomplete");
    if (result.status === "incomplete") assert.ok(result.missing.some((field) => field.startsWith("importation.")));
  }
});

test("la función también rechaza entradas inválidas aunque omitan el parser", () => {
  const result = calculateSalesCatalogCosting({ ...input, freight: { ...input.freight, pygPerUsd: "0" } } as SalesCatalogCostingInput);
  assert.deepEqual(result, { status: "invalid", field: "freight.pygPerUsd" });
});

test("márgenes usan utilidad bruta sobre precio y la sugerencia no muta el costo", () => {
  const { custom, ...suggestions } = salesCatalogPriceSuggestions("100000");
  assert.deepEqual(suggestions, { margin20: "125000", margin30: "142858", margin40: "166667", margin50: "200000" });
  assert.equal(custom("35"), "153847");
  assert.equal(suggestSalesCatalogPricePyg("100000", "35"), "153847");
  assert.equal(suggestSalesCatalogPricePyg("100000", "100"), null);
  assert.equal(suggestSalesCatalogPricePyg("100000", "-5"), null);
  assert.equal(suggestSalesCatalogPricePyg("100000", "35"), "153847");
});
