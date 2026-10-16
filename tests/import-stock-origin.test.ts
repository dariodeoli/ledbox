import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { normalizeCatalog, planCatalog, catalogProductForJson, type ExistingItem } from "../lib/import-catalog";
import { readImportStockOrigin } from "../lib/inventory-stock-origin";
const suppliers = new Set(["supplier-own-org"]);
const existing: ExistingItem = { id: "existing", name: "Original", isCombo: false, inTrash: false, units: 3, activeUnits: 3, defaultStockOrigin: "CONSIGNED", defaultSourceSupplierId: "supplier-own-org", stockCountStatus: "CONFIRMED" };
function plan(extra: Record<string, unknown>, current?: ExistingItem, supplierIds = suppliers) {
 const parsed = normalizeCatalog({ productos: [{ codigo: "OR1", nombre: "Origin product", ...extra }] }); assert(parsed.ok);
 return planCatalog({ products: parsed.value.doc.productos, parseProblems: parsed.value.problems, existing: new Map(current ? [["OR1", current]] : []), photoNames: null, supplierIds });
}
test("normalizer preserves absent versus explicit null without guessing a supplier by name", () => {
 assert.equal(plan({}).items[0].product.originInput, undefined);
 assert.deepEqual(plan({ origen_stock: null, tercero: null }).items[0].product.originInput, { origen_stock: null, tercero: null });
 for (const tercero of [{ nombre: "Same name" }, "Supplier", { id: "supplier-own-org", ruc: "123" }]) assert.equal(plan({ origen_stock: "consignado", tercero }).items[0].accion, "omitir");
});
test("own/consigned new products resolve explicit origin, with scoped active third-party IDs", () => {
 assert.deepEqual(plan({ origen_stock: "propio", cantidad: 1 }).items[0].stockOrigin, { origin: "OWNED", supplierId: null });
 assert.deepEqual(plan({ origen_stock: "consignado", tercero: { id: "supplier-own-org", nombre: "Untrusted descriptive name" }, cantidad: 2 }).items[0].stockOrigin, { origin: "CONSIGNED", supplierId: "supplier-own-org" });
 for (const id of ["foreign", "deleted", "inactive"]) { const result = plan({ origen_stock: "consignado", tercero: { id } }); assert.equal(result.items[0].accion, "omitir"); assert(result.problems.some(p => p.tipo === "stock-origen-invalido")); }
});
test("external new products never fabricate units or pending physical counts", () => {
 for (const cantidad of [null, 0, undefined]) { const item = plan({ origen_stock: "externo", tercero: { id: "supplier-own-org" }, cantidad }).items[0]; assert.equal(item.accion, "crear"); assert.equal(item.unidades, 0); assert.equal(item.stockCountStatus, "CONFIRMED"); assert.equal(item.countAfter, 0); }
 assert.equal(plan({ origen_stock: "externo", tercero: { id: "supplier-own-org" }, cantidad: 1 }).items[0].accion, "omitir");
 assert.equal(plan({ origen_stock: "externo", tercero: { id: "supplier-own-org" }, en_mantenimiento: 1 }).items[0].accion, "omitir");
});
test("existing absent origin preserves legacy/defaults; explicit changes require reviewing the item", () => {
 assert.deepEqual(plan({ cantidad: null }, existing, new Set()).items[0].stockOrigin, { origin: "CONSIGNED", supplierId: "supplier-own-org" }, "inactive historical owner does not block metadata-only preservation");
 assert.equal(plan({ origen_stock: "consignado", tercero: { id: "supplier-own-org" }, cantidad: null }, existing).items[0].accion, "actualizar");
 for (const extra of [{ origen_stock: null, tercero: null }, { origen_stock: "propio", tercero: null }, { origen_stock: "consignado", tercero: { id: "new" } }]) assert.equal(plan(extra, existing).items[0].accion, "omitir");
 const legacy = { ...existing, defaultStockOrigin: null, defaultSourceSupplierId: null }; assert.equal(plan({}, legacy).items[0].accion, "actualizar");
});
test("external default with existing physical units preserves metadata/count0, rejects increments", () => {
 const item: ExistingItem = { ...existing, defaultStockOrigin: "EXTERNAL_RENTAL", stockCountStatus: "PENDING_COUNT" };
 assert.equal(plan({ cantidad: null }, item).items[0].accion, "actualizar"); assert.equal(plan({ cantidad: 0 }, item).items[0].accion, "actualizar");
 assert.equal(plan({ cantidad: 4 }, item).items[0].accion, "omitir"); assert.equal(plan({ cantidad: 0 }, item).items[0].countAfter, null); assert.equal(plan({ cantidad: 0 }, item).items[0].stockCountStatus, "PENDING_COUNT");
});
test("combo origin is derived; explicit null is accepted but any ownership descriptor is rejected", () => {
 for (const extra of [{ origen_stock: "propio" }, { origen_stock: "consignado", tercero: { id: "supplier-own-org" } }, { tercero: { id: "supplier-own-org" } }]) assert.equal(plan({ tipo: "juego", ...extra }).items[0].accion, "omitir");
 const combo = plan({ tipo: "juego", origen_stock: null, tercero: null }).items[0]; assert.equal(combo.accion, "crear"); assert.equal(combo.unidades, 0); assert.deepEqual(combo.stockOrigin, { origin: null, supplierId: null });
});
test("fresh writer rejects a concurrent origin change and revalidates explicit supplier ID", async () => {
 const source = ts.createSourceFile("import.ts", readFileSync("lib/server/import-catalog.ts", "utf8"), ts.ScriptTarget.Latest, true);
 const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "checkedCatalogOrigin")!;
 let checked = 0;
 const check = runInNewContext(ts.transpileModule(fn.getText(source).replace(/^export /, "") + ";checkedCatalogOrigin;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
  readImportStockOrigin, validatedStockOrigin: async (_tx: unknown, organizationId: string, body: any) => { checked++; assert.equal(organizationId, "org"); assert.equal(body.defaultSourceSupplierId, "supplier-own-org"); return { value: { origin: body.defaultStockOrigin, supplierId: body.defaultSourceSupplierId } }; },
 });
 const planned = plan({ origen_stock: "consignado", tercero: { id: "supplier-own-org" } }, existing).items[0];
 await assert.rejects(check({}, "org", planned, { origin: "OWNED", supplierId: null }, true), /cambió/); assert.equal(checked, 0);
 await check({}, "org", planned, { origin: "CONSIGNED", supplierId: "supplier-own-org" }, true); assert.equal(checked, 1);
 const absent = plan({}, existing).items[0]; await check({}, "org", absent, { origin: "OWNED", supplierId: null }, true); assert.equal(checked, 1, "absence preserves freshly loaded defaults");
});

test("preview JSON round trip retains explicit origin and supplier but does not synthesize absent keys", () => {
 const first = plan({ origen_stock: "consignado", tercero: { id: "supplier-own-org", nombre: "Description" }, cantidad: 10, en_mantenimiento: 7, precios_dias: [{ desde_dias: 5, modo: "total", precio: 300000 }, { desde_dias: 10, modo: "dia", precio: 1000 }] }).items[0];
 const wire = JSON.parse(JSON.stringify({ productos: [catalogProductForJson(first.product)] }));
 assert.equal(wire.productos[0].originInput, undefined); assert.equal(wire.productos[0].origen_stock, "consignado");
 const parsed = normalizeCatalog(wire); assert(parsed.ok);
 const after = planCatalog({ products: parsed.value.doc.productos, parseProblems: parsed.value.problems, existing: new Map(), photoNames: null, supplierIds: suppliers });
 assert.deepEqual(after.items[0].stockOrigin, first.stockOrigin);
 assert.equal(after.items[0].product.enMantenimiento, 7); assert.deepEqual(after.items[0].product.preciosDias, first.product.preciosDias);
 for (const internal of ["enMantenimiento", "preciosDias", "fila", "originInput"]) assert(!Object.hasOwn(wire.productos[0], internal));
 assert(!Object.hasOwn(catalogProductForJson(plan({}).items[0].product), "origen_stock"));
});
