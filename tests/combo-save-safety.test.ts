import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { packageSummary } from "../lib/price-tiers";
import { readComboComponents } from "../lib/inventory-combos";

/** Execute the actual service against a transactional double: resolved callbacks
 * commit, rejected callbacks roll back, including lock/category helper writes. */
function fixture(mode = "ok") {
  let state = { units: ["u1", "u2", "u3"], quantity: 3, edges: [] as unknown[], settled: 0, categories: 0 };
  let deletes = 0, transactions = 0; let locked: string[] = [];
  const tx = {
    inventoryItem: {
      findFirst: async () => ({ id: "parent", comboIncomplete: false, _count: { units: state.units.length } }),
      findMany: async () => mode === "missing" ? [] : [{ id: "piece", name: "Mesa", comboIncomplete: mode === "incomplete" }],
      update: async () => { if (mode === "duplicate") throw Object.assign(new Error("duplicate"), { code: "P2002" }); state.quantity = 0; },
    },
    inventoryComponent: {
      findMany: async () => [], findFirst: async () => mode === "nested" ? { parentId: "piece" } : null,
      count: async () => mode === "used" ? 1 : 0,
      deleteMany: async () => { state.edges = []; }, createMany: async ({ data }: any) => { state.edges = data; },
    },
    eventInventory: { count: async () => mode === "reserved" ? 1 : 0 },
    inventoryUnit: { findFirst: async () => mode === "metadata" ? { code: "u1" } : null, count: async () => mode === "history" ? 1 : 0, deleteMany: async () => { deletes++; state.units = []; } },
  };
  const db = { $transaction: async (fn: any) => {
    transactions++; const before = structuredClone(state);
    try { return await fn(tx); } catch (error) { state = before; throw error; }
  } };
  const source = ts.createSourceFile("combo.ts", readFileSync("lib/server/inventory-combos.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declarations = source.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && ["saveCombo", "rejectComboSave", "ComboSaveRejected"].includes(node.name?.text ?? "")).map(node => node.getText(source).replace(/^export /, "")).join("\n");
  const save = runInNewContext(ts.transpileModule(declarations + ";saveCombo;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    db, readComboComponents, randomUUID: () => "new-id",
    lockInventoryItems: async (_tx: any, _org: string, ids: string[]) => { locked = ids; state.settled++; return new Set(ids); },
    committedAssignmentWhere: () => ({}),
    resolveInventoryCategory: async () => { state.categories++; return mode === "category" ? null : { text: "Muebles", categoryId: "category" }; },
    categoryWriteData: (category: any) => ({ category: category.text, categoryId: category.categoryId }),
    replacePriceTiers: async () => { if (mode === "write-error") throw new Error("tier write failed"); },
    isUniqueConstraintError: (error: any) => error.code === "P2002", skuConflictMessage: async () => "SKU ya usado",
  });
  const options = { organizationId: "org", id: "parent", convertFromUnit: true, data: { name: "Combo", category: "Muebles", sku: "SKU", priceTiers: [] }, components: [{ componentId: "piece", quantity: 1 }] };
  return { save, options, snapshot: () => structuredClone(state), deletes: () => deletes, transactions: () => transactions, locked: () => locked };
}

for (const [mode, reason] of [["missing", "component-missing"], ["category", "invalid"], ["nested", "nested"], ["incomplete", "nested"], ["used", "nested"], ["reserved", "has-reservations"], ["history", "invalid"], ["metadata", "invalid"]]) {
  test(`combo rejected by ${mode} rolls back all state, without deleting physical units`, async () => {
    const f = fixture(mode); const before = f.snapshot();
    const result = await f.save(f.options);
    assert.equal(result.ok, false); assert.equal(result.reason, reason);
    assert.deepEqual(f.snapshot(), before); assert.equal(f.deletes(), 0);
  });
}

test("self-reference and empty/invalid components retain units and helper state", async () => {
  for (const components of [[{ componentId: "parent", quantity: 1 }], [], [{ componentId: "piece", quantity: 0 }]]) {
    const f = fixture(); const before = f.snapshot();
    assert.equal((await f.save({ ...f.options, components })).ok, false);
    assert.deepEqual(f.snapshot(), before); assert.equal(f.deletes(), 0);
  }
});

test("duplicate SKU after unit deletion rolls back and keeps the existing failure contract", async () => {
  const f = fixture("duplicate"); const before = f.snapshot();
  const result = await f.save(f.options);
  assert.equal(result.ok, false); assert.equal(result.reason, "duplicate-sku");
  assert.equal(f.deletes(), 1, "exercise the dangerous post-delete failure");
  assert.deepEqual(f.snapshot(), before);
});

test("unexpected later write failure rejects and rolls back units, parent and category", async () => {
  const f = fixture("write-error"); const before = f.snapshot();
  await assert.rejects(f.save(f.options), /tier write failed/);
  assert.equal(f.deletes(), 1); assert.deepEqual(f.snapshot(), before);
});

test("valid conversion locks parent and pieces together, removes only clean own units and keeps zero own stock", async () => {
  const f = fixture(); const result = await f.save(f.options);
  assert.equal(result.ok, true); assert.deepEqual(Array.from(f.locked()).sort(), ["parent", "piece"]);
  assert.equal(f.deletes(), 1); assert.equal(f.snapshot().quantity, 0); assert.equal(f.snapshot().units.length, 0);
  assert.equal(f.snapshot().edges.length, 1);
});

test("a combo without its own price never inherits the sum of priced pieces", () => {
  const result = packageSummary({ basePrice: 0 }, [{ name: "Mesa", quantity: 2, base: 100000, minimum: 0, billingUnit: "DAILY", tiers: [] }], 3);
  assert.equal(result.packageTotal, 0);
  assert.equal(result.unitSum, 600000);
  assert.equal(result.savings, 0);
});
