import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;

test("one shared origin form renders distinct owner and procurement fields; physical units never offer external rental", async () => {
  const { InventoryOriginFields } = await import("../components/admin/modules/InventoryOriginFields");
  const props = { origin: "CONSIGNED", supplierId: "owner", suppliers: [{ id: "owner", name: "Dueño real" }], onChange() {} };
  const unit = renderToStaticMarkup(createElement(InventoryOriginFields, { ...props, physicalUnit: true }));
  assert.match(unit, /Propiedad de esta unidad/); assert.match(unit, /Dueño de las unidades/);
  assert.match(unit, /Dueño real/); assert.doesNotMatch(unit, /EXTERNAL_RENTAL/);
  const product = renderToStaticMarkup(createElement(InventoryOriginFields, { ...props, origin: "EXTERNAL_RENTAL" }));
  assert.match(product, /Origen predeterminado/); assert.match(product, /Proveedor del alquiler externo/);
  assert.match(product, /No crea stock físico/);
  assert.match(product, /Distinto del proveedor de compra/);
});

test("saved missing supplier remains visible; no silent reassignment from a truncated selector", async () => {
  const { InventoryOriginFields } = await import("../components/admin/modules/InventoryOriginFields");
  const html = renderToStaticMarkup(createElement(InventoryOriginFields, { physicalUnit: true, origin: "CONSIGNED", supplierId: "off-page-owner", suppliers: [], onChange() {} }));
  assert.match(html, /off-page-owner/); assert.match(html, /Tercero guardado/);
});

test("default and unit editor transport preserves expected ownership and external zero", () => {
  const form = readFileSync("components/admin/modules/InventoryItemDialogs.tsx", "utf8");
  const ficha = readFileSync("components/admin/modules/InventoryFicha.tsx", "utf8");
  assert.match(form, /quantity: form.defaultStockOrigin === "EXTERNAL_RENTAL" \? 0/);
  assert.match(form, /expectedDefaultStockOrigin: item.defaultStockOrigin \?\? null/);
  assert.match(ficha, /expectedOwnerSupplierId: unitDialog.ownerSupplierId \?\? null/);
  assert.match(form, /<InventoryOriginFields/); assert.match(ficha, /<InventoryOriginFields physicalUnit/);
});
