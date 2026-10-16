import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { stableOrderBudgetItems } from "../lib/budget-item-order";

function fixture() {
  const now = new Date("2026-11-01T12:00:00Z");
  const stock = (id: string, extra: Record<string, unknown> = {}) => ({ id, organizationId: "org", name: id, updatedAt: now, deletedAt: null, quantity: 10, stockCountStatus: "CONFIRMED", status: "AVAILABLE", comboIncomplete: false, defaultStockOrigin: "OWNED", components: [], ...extra });
  const budget = { id: "budget", updatedAt: now, eventId: "event", event: { id: "event", organizationId: "org", deletedAt: null, updatedAt: now, startsAt: now, endsAt: new Date(now.getTime() + 86400000), setupAt: null, strikeAt: null }, items: [{ id: "line", name: "Mesa", quantity: 2, inventoryId: "item", days: 1, unitPrice: 1000, subtotal: 2000 }] };
  const state = { budget, inventory: [stock("item")], calls: [] as any[], incomplete: [] as string[], during: () => {}, result: { eventId: "event", range: { startsAt: now, endsAt: new Date(now.getTime() + 86400000) }, dryRunGroups: [{ inventoryId: "item", itemIds: ["line"], requested: 2, available: 10, covered: 2, state: "available", reason: "capacity" }] as any[], outcomes: [] as any[], failed: false, blocked: false } };
  const database = { budget: { findFirst: async ({ where }: any) => { assert.equal(where.organizationId, "org"); return where.id === "budget" ? structuredClone(state.budget) : null; } }, inventoryItem: { findMany: async ({ where }: any) => { assert.equal(where.organizationId, "org"); return structuredClone(state.inventory); } } };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/server/budget-send-availability.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, Date, Map, Set, require: (name: string) => ({
    "../budget-item-order": { stableOrderBudgetItems }, "node:crypto": { createHash }, "./db": { db: database }, "./approval-stock": { incompleteGameLines: async () => state.incomplete },
    "./inventory-availability": { eventReservationRange: (event: any) => { const start = event.setupAt ?? event.startsAt, end = event.strikeAt ?? event.endsAt; return start ? { startsAt: start, endsAt: end && end >= start ? end : null } : null; }, reserveBudgetInventory: async (options: any) => { state.calls.push(options); state.during(); return state.result; } },
  }[name]) });
  return { state, stock, check: () => exports.checkBudgetSendAvailability({ organizationId: "org", budgetId: "budget", expectedUpdatedAt: now, context: { organizationId: "org" } }) };
}

test("send preflight delegates only dryRun; checkedAt does not invalidate a stable review", async () => {
  const f = fixture(), first = await f.check(), second = await f.check();
  assert.equal(first.review.state, "available"); assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(f.state.calls.length, 2); assert.ok(f.state.calls.every(call => call.dryRun === true && call.strict === undefined));
});

test("missing/inverted dates and manual/no lines stay unverified without pretending a stock calculation", async () => {
  for (const scenario of ["missing", "inverted", "manual", "empty"] as const) {
    const f = fixture();
    if (scenario === "missing") f.state.budget.event.endsAt = null as any;
    if (scenario === "inverted") f.state.budget.event.endsAt = new Date("2020-01-01");
    if (scenario === "manual") f.state.budget.items[0].inventoryId = null as any;
    if (scenario === "empty") f.state.budget.items = [];
    const result = await f.check(); assert.equal(result.review.state, "unverified", scenario); assert.equal(f.state.calls.length, 0);
  }
});

test("pending parent/component remains unknown, confirmed zero is real shortage, external default preserves physical stock", async () => {
  for (const kind of ["parent", "component", "zero", "external", "external-physical", "incomplete"] as const) {
    const f = fixture();
    if (kind === "parent") f.state.inventory[0].stockCountStatus = "PENDING_COUNT";
    if (kind === "component") f.state.inventory[0].components = [{ componentId: "part", quantity: 1, component: f.stock("part", { stockCountStatus: "PENDING_COUNT" }) }] as any;
    if (kind.startsWith("external")) f.state.inventory[0].defaultStockOrigin = "EXTERNAL_RENTAL";
    if (["zero", "external"].includes(kind)) f.state.inventory[0].quantity = 0;
    if (kind === "incomplete") { f.state.inventory[0].comboIncomplete = true; f.state.incomplete = ["incomplete"]; }
    if (kind !== "external-physical") { f.state.result.blocked = true; f.state.result.dryRunGroups[0] = { ...f.state.result.dryRunGroups[0], state: "shortage", available: 0, covered: 0 }; f.state.result.outcomes = [{ itemId: "line", inventoryId: "item", quantity: 2, available: 0, conflicts: [{ eventName: "PRIVATE_OTHER_CLIENT" }], reason: "PRIVATE_REASON" }]; }
    const result = await f.check();
    assert.equal(result.review.state, kind === "zero" ? "shortage" : kind === "incomplete" ? "incomplete" : kind === "external-physical" ? "available" : "unverified", kind);
    if (kind === "zero") assert.equal(result.review.warnings[0].available, 0);
    else if (kind !== "external-physical") assert.equal(result.review.warnings[0].available, null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("preflight errors never become available; snapshot drift and foreign component fail closed", async () => {
  const failed = fixture(); failed.state.result.failed = true; assert.equal((await failed.check()).review.state, "error");
  const drift = fixture(); drift.state.during = () => { drift.state.budget.event.endsAt = new Date("2026-12-01"); };
  await assert.rejects(drift.check(), /Cambiaron/);
  const stock = fixture(); stock.state.during = () => { stock.state.inventory[0].stockCountStatus = "PENDING_COUNT"; };
  await assert.rejects(stock.check(), /Cambiaron/);
  const tenant = fixture(); tenant.state.inventory[0].components = [{ componentId: "foreign", component: tenant.stock("foreign", { organizationId: "other" }) }] as any;
  await assert.rejects(tenant.check(), /ajena/); assert.equal(tenant.state.calls.length, 0);
});


test("all lines require explicit engine groups; available rows survive another group's shortage and excluded rows stay excluded", async () => {
  const f = fixture();
  f.state.budget.items.push({ ...f.state.budget.items[0], id: "short", inventoryId: "short-stock", name: "Faltante", quantity: 3 });
  f.state.budget.items.push({ ...f.state.budget.items[0], id: "excluded", excluded: true } as any);
  f.state.inventory.push(f.stock("short-stock"));
  f.state.result.blocked = true;
  f.state.result.dryRunGroups.push({ inventoryId: "short-stock", itemIds: ["short"], requested: 3, available: 1, covered: 1, state: "shortage", reason: "capacity" });
  const review = (await f.check()).review;
  assert.deepEqual(Array.from(review.lines, (line: any) => [line.itemId, line.state, line.available]), [["line", "available", 10], ["short", "shortage", 1], ["excluded", "excluded", null]]);
  assert.equal(review.lines[2].covered, null);
  f.state.result.dryRunGroups.shift();
  assert.equal((await f.check()).review.state, "error", "missing outcome never proves availability");
});

test("movement or retained assignments do not become new free stock; duplicates share canonical MAX", async () => {
  const f = fixture();
  f.state.budget.items.push({ ...f.state.budget.items[0], id: "duplicate", quantity: 1 });
  f.state.result.dryRunGroups[0].itemIds.push("duplicate");
  const rows = (await f.check()).review.lines;
  assert.equal(rows.length, 2); assert.ok(rows.every((line: any) => line.sharedGroup && line.groupRequested === 2));
  for (const reason of ["movement", "kept", "conflict"]) {
    f.state.result.dryRunGroups[0] = { ...f.state.result.dryRunGroups[0], state: "unverified", reason, covered: 2, available: reason === "kept" ? 0 : null };
    const result = await f.check(); assert.equal(result.review.state, "unverified"); assert.ok(result.review.lines.every((line: any) => line.available === null));
  }
});


test("any missing/foreign group or range mismatch invalidates every included projection", async () => {
  for (const mismatch of ["extra", "range", "missing"]) {
    const f = fixture();
    f.state.budget.items.push({ ...f.state.budget.items[0], id: "excluded", excluded: true } as any);
    if (mismatch === "extra") f.state.result.dryRunGroups.push({ inventoryId: "foreign", itemIds: ["foreign"], requested: 1, available: 10, covered: 1, state: "available", reason: "capacity" });
    if (mismatch === "range") f.state.result.range.endsAt = new Date("2038-01-01");
    if (mismatch === "missing") f.state.result.dryRunGroups = [];
    const result = await f.check(); assert.equal(result.review.state, "error");
    assert.equal(result.review.checkedLines, 0); assert.equal(result.review.range, null);
    assert.ok(result.review.lines.every((line: any) => line.state !== "available" && line.available === null && line.covered === null && line.range === null), mismatch);
    assert.equal(result.review.lines[1].state, "excluded");
  }
});
