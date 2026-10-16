import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { normalizeCatalog, planCatalog, parseCatalogQuantity } from "../lib/import-catalog";
import { buildAvailability } from "../lib/server/inventory-availability";
import { withComboAvailability } from "../lib/server/inventory-combos";
import { inventoryVisualState } from "../lib/inventory-visual-state";
import { itemInFocus, stockSummary } from "../lib/inventory-view";

const plan = (extra: Record<string, unknown>, existing: Map<string, any> = new Map()) => {
  const parsed = normalizeCatalog({ productos: [{ codigo: "SC1", nombre: "Silla", ...extra }] }); assert(parsed.ok);
  return planCatalog({ products: parsed.value.doc.productos, parseProblems: parsed.value.problems, existing, photoNames: null });
};
test("quantity parser accepts explicit zero but rejects invalid numbers; components still positive", () => {
  for (const value of [0, "0", "00"]) assert.equal(parseCatalogQuantity(value), 0);
  for (const value of [null, undefined, "", "null"]) assert.equal(parseCatalogQuantity(value), null);
  for (const value of [-1, 1.5, Infinity, "1e2", 100001]) assert.equal(parseCatalogQuantity(value), false);
  assert(plan({ tipo: "juego", componentes: [{ codigo: "SC2", cantidad: 0 }] }).problems.some(p => p.tipo === "componente-invalido"));
});
test("new unknown and zero are different persisted intentions, with no fabricated unit", () => {
  for (const extra of [{ cantidad: null }, {}]) { const row = plan(extra).items[0]; assert.equal(row.unidades, 0); assert.equal(row.stockCountStatus, "PENDING_COUNT"); assert.equal(row.countAfter, null); }
  const zero = plan({ cantidad: 0 }).items[0]; assert.equal(zero.unidades, 0); assert.equal(zero.stockCountStatus, "CONFIRMED"); assert.equal(zero.countAfter, 0);
});
test("existing null preserves count knowledge, numeric count never advertises retiring units", () => {
  const item = { id: "id", name: "Silla", units: 12, activeUnits: 10, isCombo: false, inTrash: false, stockCountStatus: "CONFIRMED" };
  const known = plan({ cantidad: null }, new Map([["SC1", item]])).items[0]; assert.equal(known.countAfter, 10); assert.equal(known.stockCountStatus, "CONFIRMED");
  const pending = plan({ cantidad: null }, new Map([["SC1", { ...item, stockCountStatus: "PENDING_COUNT" }]])).items[0]; assert.equal(pending.countAfter, null); assert.equal(pending.stockCountStatus, "PENDING_COUNT");
  assert.equal(plan({ cantidad: 0 }, new Map([["SC1", item]])).items[0].countAfter, 10);
  const lowerPending = plan({ cantidad: 2 }, new Map([["SC1", { ...item, stockCountStatus: "PENDING_COUNT" }]])).items[0];
  assert.equal(lowerPending.accion, "omitir"); assert.equal(lowerPending.stockCountStatus, "PENDING_COUNT"); assert.equal(lowerPending.countAfter, null);
});
test("canonical availability blocks pending even with units registered; confirmed zero stays known", () => {
  const item = { id: "id", name: "Silla", quantity: 4, status: "AVAILABLE" as const, maintenance: 0 };
  const start = new Date("2026-12-10T12:00:00Z"), end = new Date("2026-12-11T12:00:00Z");
  const unknown = buildAvailability({ ...item, stockCountStatus: "PENDING_COUNT" }, [], start, end);
  assert.equal(unknown.total, 4); assert.equal(unknown.available, 0); assert.equal(unknown.blocked, true); assert.equal(unknown.stockCountStatus, "PENDING_COUNT");
  const zero = buildAvailability({ ...item, quantity: 0, stockCountStatus: "CONFIRMED" }, [], start, end);
  assert.equal(zero.blocked, false); assert.equal(zero.stockCountStatus, "CONFIRMED");
});
test("inventory uses a pending label and incomplete filter rather than a false free/total fraction", () => {
  const item: any = { quantity: 3, stockCountStatus: "PENDING_COUNT", status: "AVAILABLE", availability: { availableNow: 0, committedNow: 0 }, combo: undefined };
  const visual = inventoryVisualState(item); assert.equal(visual.state.label, "Pendiente conteo"); assert.equal(visual.fraction, null); assert.equal(visual.segments.length, 0);
  assert.equal(stockSummary(item, false).free, null); assert(itemInFocus(item, "incomplete", { now: new Date(), openIncidentIds: new Set() }));
});

function confirmationFixture(mode = "pending") {
  let item: any = { id: "item", name: "Silla", quantity: mode === "registered" ? 3 : 0, stockCountStatus: "PENDING_COUNT", comboIncomplete: mode === "combo", _count: { components: 0 } };
  const changes: any[] = [], audits: any[] = []; let creates = 0, locked = 0; const placements: any[] = [];
  const tx = { inventoryItem: { findFirst: async ({ where }: any) => where.organizationId === "org" && mode !== "foreign" ? item : null, update: async ({ data }: any) => { changes.push(data); item = { ...item, ...data }; } } };
  const sf = ts.createSourceFile("count.ts", readFileSync("lib/server/inventory-stock-count.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const fn = sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "confirmInventoryCount")!;
  const confirm = runInNewContext(ts.transpileModule(fn.getText(sf).replace(/^export /, "") + ";confirmInventoryCount;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    lockInventoryItems: async () => { locked++; return new Set(["item"]); },
    createInventoryUnits: async (_tx: unknown, options: any) => { placements.push(options); creates += options.quantity; item.quantity += options.quantity; },
    recordAudit: async (entry: any) => audits.push(entry),
  });
  return { confirm: (total: number, placement?: { warehouseId?: string; location?: string }) => confirm(tx, { organizationId: "org", user: { id: "user" } }, "item", total, placement), state: () => ({ item, changes, audits, creates, locked, placements }) };
}
test("explicit zero confirmation does not call unit creation and records knowledge transition once", async () => {
  const f = confirmationFixture(); await f.confirm(0); assert.equal(f.state().creates, 0); assert.equal(f.state().item.stockCountStatus, "CONFIRMED"); assert.equal(f.state().audits.length, 1);
  await f.confirm(0); assert.equal(f.state().audits.length, 1); assert.equal(f.state().locked, 2);
});
test("confirmation creates only the deficit; lower or invalid totals do not mutate registered units", async () => {
  const f = confirmationFixture("registered"); await assert.rejects(f.confirm(2), /menor/); assert.equal(f.state().changes.length, 0); assert.equal(f.state().creates, 0);
  await f.confirm(5); assert.equal(f.state().creates, 2); assert.equal(f.state().item.quantity, 5); assert.equal(f.state().audits.length, 1);
  for (const bad of [-1, 1.2, 100001]) await assert.rejects(f.confirm(bad)); assert.equal(f.state().creates, 2);
});
test("count confirmation refuses foreign or combo items without writes", async () => {
  for (const mode of ["foreign", "combo"]) { const f = confirmationFixture(mode); await assert.rejects(f.confirm(1)); assert.equal(f.state().creates, 0); assert.equal(f.state().audits.length, 0); }
});

test("combo remains definable but its pending component blocks capacity without claiming physical zero", () => {
 const rows = [{ id: "combo", availability: { availableNow: 10, committedNow: 0, overcommittedNow: false, maintenanceNow: 0, range: { available: 10, committed: 0, overcommitted: false, conflicts: [] } } }];
 const definitions = new Map([["combo", { id: "combo", components: [{ componentId: "piece", name: "Silla", quantity: 1, category: "Sillas", status: "AVAILABLE" as const, stockCountStatus: "PENDING_COUNT" as const }] }]]);
 const result = withComboAvailability(rows, definitions)[0];
 assert.equal((result as any).stockCountStatus, "PENDING_COUNT"); assert.equal(result.availability.availableNow, 0); assert.equal(result.availability.range?.available, 0); assert.equal(result.combo?.capacity, 0); assert.equal(result.combo?.incomplete, undefined);
});

test("actual import writer never calls createInventoryUnits for zero or unknown; existing null retains units and prices", async () => {
 const sf = ts.createSourceFile("import.ts", readFileSync("lib/server/import-catalog.ts", "utf8"), ts.ScriptTarget.Latest, true);
 const fn = sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "writeUnitItem")!;
 let current: any = null; const created: any[] = [], updated: any[] = []; let unitCalls = 0, confirmed = 0, tierCalls = 0; let confirmedPlacement: any;
 const write = runInNewContext(ts.transpileModule(fn.getText(sf).replace(/^export /, "") + ";writeUnitItem;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
   resolveInventoryCategory: async () => ({ text: "General", categoryId: "category" }), categoryWriteData: () => ({ category: "General" }),
   specData: () => ({}), billingUnitOf: () => "DAILY", visibilityData: () => ({}), sameBytes: () => false,
   lockInventoryItems: async () => new Set(["item"]), randomUUID: () => "new-item",
   createInventoryUnits: async (_tx: any, { quantity }: any) => { unitCalls++; assert(quantity > 0, "zero must not reach legacy fallback-to-one helper"); },
   findWarehouseByCode: async () => ({ id: "warehouse-import" }),
   confirmInventoryCount: async (_tx: unknown, _context: unknown, _id: string, _total: number, placement: any) => { confirmed++; confirmedPlacement = placement; }, replaceAudienceTiers: async () => { tierCalls++; }, stateTargetsOf: () => ({}),
 });
 const tx = { inventoryItem: { create: async ({ data }: any) => { created.push(data); }, findFirst: async () => current, update: async ({ data }: any) => { updated.push(data); } } };
 for (const cantidad of [null, 0]) await write(tx, { organizationId: "org" }, plan({ cantidad, deposito: "D2", ubicacion: "E3-B2" }).items[0], null);
 assert.equal(created[0].quantity, 0); assert.equal(created[0].stockCountStatus, "PENDING_COUNT"); assert.equal(created[1].stockCountStatus, "CONFIRMED"); assert.equal(unitCalls, 0);
 assert.equal(created[0].defaultWarehouseId, "warehouse-import"); assert.equal(created[1].defaultLocation, "E3-B2");
 current = { quantity: 5, stockCountStatus: "CONFIRMED", _count: { components: 0 } };
 const existing = new Map([["SC1", { id: "item", units: 5, isCombo: false, inTrash: false, name: "Silla" }]]);
 await write(tx, { organizationId: "org" }, plan({ cantidad: null, precio: null }, existing).items[0], null);
 assert.equal(unitCalls, 0); assert.equal(confirmed, 0); assert.equal(tierCalls, 0); assert(!("listPrice" in updated[0])); assert(!("stockCountStatus" in updated[0])); assert(!("quantity" in updated[0]));
 current = { ...current, stockCountStatus: "PENDING_COUNT" };
 await write(tx, { organizationId: "org" }, plan({ cantidad: 7, deposito: "D2", ubicacion: "E3-B2" }, existing).items[0], null);
 assert.equal(confirmed, 1); assert.equal(confirmedPlacement.warehouseId, "warehouse-import"); assert.equal(confirmedPlacement.location, "E3-B2");
});

test("import count placement reaches only newly created units; UI confirmation keeps defaults", async () => {
 const imported = confirmationFixture("registered");
 await imported.confirm(5, { warehouseId: "warehouse-new", location: "E3-B2" });
 assert.equal(imported.state().placements.length, 1); assert.equal(imported.state().placements[0].quantity, 2);
 assert.equal(imported.state().placements[0].warehouseId, "warehouse-new"); assert.equal(imported.state().placements[0].location, "E3-B2");
 const ui = confirmationFixture(); await ui.confirm(1); assert.equal(ui.state().placements[0].warehouseId, undefined); assert.equal(ui.state().placements[0].location, undefined);
});
