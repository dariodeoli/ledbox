import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { catalogProductForJson, normalizeCatalog, planCatalog } from "../lib/import-catalog";

test("published example obeys the same parser and preview/apply wire contract", () => {
  const raw = JSON.parse(readFileSync("docs/ejemplos/catalogo-ejemplo.json", "utf8"));
  const first = normalizeCatalog(raw); assert.ok(first.ok);
  assert.equal(first.value.problems.filter(row => row.nivel === "error").length, 0);
  const second = normalizeCatalog({ ...raw, productos: first.value.doc.productos.map(catalogProductForJson) }); assert.ok(second.ok);
  assert.deepEqual(second.value.doc.productos, first.value.doc.productos);
  const plan = planCatalog({ products: second.value.doc.productos, parseProblems: second.value.problems, existing: new Map(), photoNames: null, warehouseCodes: new Set(["D1"]), supplierIds: new Set() });
  assert.equal(plan.problems.filter(row => row.nivel === "error").length, 0);
  assert.equal(plan.items.find(row => row.product.codigo === "EJ-CERO")?.unidades, 0);
  assert.equal(plan.items.find(row => row.product.codigo === "EJ-CONTAR")?.stockCountStatus, "PENDING_COUNT");
  assert.equal(plan.items.find(row => row.product.codigo === "EJ-SILLA")?.stockOrigin.origin, "OWNED");
  assert.equal(plan.items.find(row => row.product.codigo === "EJ-COMBO")?.product.precio, null);
});
