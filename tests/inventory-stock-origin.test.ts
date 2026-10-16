import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as originRules from "../lib/inventory-stock-origin";
const { readStockOrigin, readImportStockOrigin, serializeImportStockOrigin } = originRules;
const fields = { origin: "stockOrigin", supplier: "ownerSupplierId" };

test("ownership is explicit and nullable, never inferred from purchase supplier", () => {
  const saved = { origin: "CONSIGNED" as const, supplierId: "owner" };
  assert.deepEqual(readStockOrigin({ supplierId: "purchase-vendor" }, fields, saved), { ok: true, changed: false, value: saved });
  assert.deepEqual(readStockOrigin({ stockOrigin: null }, fields, saved), { ok: true, changed: true, value: { origin: null, supplierId: null } });
  for (const value of [false, 42, [], {}, "consignado", "UNKNOWN"]) assert.equal(readStockOrigin({ stockOrigin: value }, fields).ok, false);
  assert.equal(readStockOrigin({ stockOrigin: "OWNED", ownerSupplierId: "vendor" }, fields).ok, false);
  assert.equal(readStockOrigin({ stockOrigin: "CONSIGNED" }, fields).ok, false);
  assert.equal(readStockOrigin({ stockOrigin: "EXTERNAL_RENTAL", ownerSupplierId: "vendor" }, fields, undefined, true).ok, false);
});

test("import descriptors round trip without fuzzy matching or invented fiscal identifiers", () => {
  for (const origin of [null, "OWNED", "CONSIGNED", "EXTERNAL_RENTAL"] as const) {
    const pair = { origin, supplierId: origin === "CONSIGNED" || origin === "EXTERNAL_RENTAL" ? "stable-id" : null };
    const result = readImportStockOrigin(serializeImportStockOrigin(pair, "Same display name"));
    assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.value, pair);
  }
  const current = { origin: "CONSIGNED" as const, supplierId: "old" };
  assert.deepEqual(readImportStockOrigin({}, current), { ok: true, changed: false, value: current });
  for (const tercero of ["Name", { nombre: "Ambiguous" }, { ruc: "1234567-8" }, { id: "x", ruc: "123" }]) assert.equal(readImportStockOrigin({ origen_stock: "consignado", tercero }).ok, false);
  assert.equal(readImportStockOrigin({ origen_stock: "externo", tercero: { id: "vendor" } }, undefined, true).ok, false);
});

function server() {
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/server/inventory-stock-origin.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => originRules });
  return exports;
}
function fixture(defaultOrigin: string | null, supplier = "owner", supplierActive = true) {
  const created: any[] = []; let queries = 0;
  const tx = {
    inventoryItem: { findFirst: async ({ where }: any) => { queries++; return where.organizationId === "org" ? { defaultStockOrigin: defaultOrigin, defaultSourceSupplierId: defaultOrigin === "CONSIGNED" || defaultOrigin === "EXTERNAL_RENTAL" ? supplier : null } : null; } },
    supplier: { findFirst: async ({ where }: any) => { queries++; return where.organizationId === "org" && where.id === "owner" && supplierActive ? { id: where.id } : null; } },
    inventoryUnit: { create: async ({ data }: any) => { created.push(data); return data; } },
  };
  const helpers = server();
  const source = ts.createSourceFile("units.ts", readFileSync("lib/server/inventory-units.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "createInventoryUnits")!.getText(source).replace(/^export /, "");
  const create = runInNewContext(ts.transpileModule(fn + ";createInventoryUnits;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ...helpers, lockInventoryItems: async () => { queries++; }, resolveUnitPlacement: async () => ({ warehouseId: "depot", location: null }), nextInventoryUnitCode: async () => "UNIT", randomUUID: () => "id", syncInventoryQuantity: async () => {},
  });
  return { tx, helpers, created, create: (quantity: unknown, extra = {}) => create(tx, { organizationId: "org", inventoryId: "product", name: "Mesa", quantity, ...extra }), queries: () => queries };
}

test("canonical unit creator: explicit zero creates nothing, invalid quantity never invents one", async () => {
  const f = fixture("OWNED"); assert.equal(await f.create(0), 0); assert.equal(f.created.length, 0); assert.equal(f.queries(), 0);
  for (const value of [null, undefined, -1, 1.5, NaN]) await assert.rejects(f.create(value), (error: any) => error.status === 400);
  assert.equal(f.created.length, 0);
});

test("new physical units copy the default once and separate owner from purchase supplier", async () => {
  const f = fixture("CONSIGNED"); await f.create(2, { supplierId: "purchase-vendor" });
  assert.equal(f.created.length, 2);
  assert.equal(f.created[0].stockOrigin, "CONSIGNED"); assert.equal(f.created[0].ownerSupplierId, "owner");
  assert.equal(f.created[0].supplierId, "purchase-vendor"); assert.equal(f.created[0].warehouseId, "depot");
  const legacy = fixture(null); await legacy.create(1); assert.equal(legacy.created[0].stockOrigin, null);
});

test("external default creates no physical stock implicitly or by passing null; explicit real owned stock remains possible", async () => {
  const f = fixture("EXTERNAL_RENTAL");
  for (const extra of [{}, { stockOrigin: null }, { stockOrigin: "" }]) await assert.rejects(f.create(1, extra), (error: any) => error.status === 400);
  assert.equal(f.created.length, 0);
  await f.create(1, { stockOrigin: "OWNED", ownerSupplierId: null });
  assert.equal(f.created[0].stockOrigin, "OWNED"); assert.equal(f.created[0].ownerSupplierId, null);
});

test("foreign/inactive owners cannot be used for new units", async () => {
  for (const f of [fixture("CONSIGNED", "foreign"), fixture("CONSIGNED", "owner", false)]) {
    await assert.rejects(f.create(1), (error: any) => error.status === 404); assert.equal(f.created.length, 0);
  }
});

test("ownership API updates require fresh expected pair while unrelated edits preserve historical owner", async () => {
  const f = fixture("CONSIGNED"); const current = { origin: "CONSIGNED", supplierId: "owner" }; const next = { origin: "OWNED", supplierId: null };
  assert.throws(() => f.helpers.assertOriginExpected({}, current, next, "unit"), (error: any) => error.status === 409);
  assert.throws(() => f.helpers.assertOriginExpected({ expectedStockOrigin: null, expectedOwnerSupplierId: null }, current, next, "unit"), (error: any) => error.status === 409);
  assert.doesNotThrow(() => f.helpers.assertOriginExpected({ expectedStockOrigin: "CONSIGNED", expectedOwnerSupplierId: "owner" }, current, next, "unit"));
  const unchanged = await f.helpers.validatedStockOrigin(f.tx, "org", {}, "unit", current);
  assert.equal(unchanged.changed, false); assert.equal(unchanged.value.supplierId, "owner");
});

// Execute the actual locked update blocks with a row changed between pre-read and lock.
// A notes-only request must never claim somebody else's concurrent owner edit in its audit.
test("item and unit audit use the locked row, not the stale pre-lock ownership snapshot", async () => {
  const route = readFileSync("app/api/admin/inventory/route.ts", "utf8");
  for (const target of ["item", "unit"] as const) {
    const item = target === "item";
    const fresh: any = item
      ? { id: "i", name: "Mesa", notes: "old", defaultStockOrigin: "OWNED", defaultSourceSupplierId: null }
      : { id: "u", inventoryId: "i", code: "U1", notes: "old", stockOrigin: "OWNED", ownerSupplierId: null };
    const existing = { ...fresh, ...(item ? { defaultStockOrigin: "CONSIGNED", defaultSourceSupplierId: "previous" } : { stockOrigin: "CONSIGNED", ownerSupplierId: "previous" }), inventory: { name: "Mesa" } };
    const start = item ? route.indexOf("    let auditBefore:") : route.indexOf("    let unit;", route.indexOf('if (kind === "unit-update")'));
    const end = route.indexOf("    if (changes) {", start);
    const block = route.slice(start, end);
    let audited: any; let lock = false;
    const delegate = { findFirstOrThrow: async () => { assert.equal(lock, true); return { ...fresh }; }, update: async ({ data }: any) => ({ ...fresh, ...data }) };
    const tx = { inventoryItem: delegate, inventoryUnit: delegate, eventInventory: { count: async () => 0 } };
    const run = runInNewContext(ts.transpileModule(`(async () => { ${block}; return true; })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      existing, organizationId: "org", body: {}, data: { notes: "new" }, update: { data: { notes: "new" } }, traceRest: {}, defaultLocation: undefined,
      db: { $transaction: (fn: any) => fn(tx) }, lockInventoryItems: async () => { lock = true; },
      validatedStockOrigin: async () => ({ changed: false, value: {} }), assertOriginExpected() {}, resolveInventoryCategory() {}, categoryWriteData() {},
      assertUnitsAvailableWithoutIncidents: async () => {}, syncInventoryQuantity: async () => {},
      INVENTORY_ITEM_FIELDS: [], auditChanges: (before: any) => { audited = before; return null; },
      InventoryUnitIncidentConflict: class extends Error {}, isUniqueConstraintError: () => false,
    });
    await run(); assert.deepEqual(audited, fresh); assert.notDeepEqual(audited, existing);
  }
});
