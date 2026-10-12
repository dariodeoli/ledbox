import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

// Executes the real consumer, canonical arithmetic and quote/signature lock
// orchestration with explicit boundary doubles. No PostgreSQL/MVCC/ledger proof.
test("FIN editor canonical pricing executes after lock with legacy rows, without economic authority", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "fin-editor-commercial-"));
  const output = join(directory, "consumer.cjs");
  const stateModule = `
    let state;
    export function initialize(value) { state = value; }
    export const db = {
      budget: { findFirst: async () => state.current },
      $transaction: async (write) => {
        const tx = {
          $queryRaw: async () => { state.calls.push("lock"); return []; },
          signatureRequest: { count: async () => { state.calls.push("signature"); return state.signed ? 1 : 0; } },
          inventoryItem: { count: async () => 0 },
          budget: {
            findUnique: async () => state.fresh,
            findUniqueOrThrow: async () => state.saved || state.fresh,
            update: async ({ data }) => { state.calls.push("budget-write"); state.saved = { ...state.fresh, ...data, items: state.written }; return state.saved; }
          },
          budgetItem: {
            deleteMany: async () => { state.calls.push("item-delete"); },
            update: async ({ where, data }) => { state.calls.push("item-write"); state.written.push({ id: where.id, ...data }); },
            create: async ({ data }) => { state.calls.push("item-create"); state.written.push(data); }
          }
        };
        return write(tx);
      }
    };
  `;
  try {
    await build({
      stdin: { contents: 'export { saveBudgetEditor } from "./lib/server/budget-editor"; export { initialize } from "fin-contract-state";', resolveDir: process.cwd() },
      outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
      plugins: [{ name: "explicit-fin-contract-doubles", setup(plugin) {
        plugin.onResolve({ filter: /^fin-contract-state$/ }, () => ({ path: "state", namespace: "fin-double" }));
        plugin.onResolve({ filter: /^\.\/db$/ }, (args) => args.importer.startsWith(resolve("lib/server")) ? { path: "state", namespace: "fin-double" } : undefined);
        plugin.onResolve({ filter: /^\.\/audit$/ }, (args) => args.importer.startsWith(resolve("lib/server")) ? { path: "audit", namespace: "fin-double" } : undefined);
        plugin.onResolve({ filter: /^\.\/budget-payment-plan$/ }, (args) => args.importer.endsWith("budget-editor.ts") ? { path: "ledger", namespace: "fin-double" } : undefined);
        plugin.onLoad({ filter: /.*/, namespace: "fin-double" }, (args) => ({ contents: args.path === "state" ? stateModule
          : args.path === "audit" ? "export async function recordAudit() {} export function auditChanges() { return null; }"
            : "export async function recalculateBudgetPaymentPlan() {} export async function validateBudgetPlanAccounts() {}", loader: "js" }));
      } }],
    });
    const consumer = createRequire(import.meta.url)(output);
    const context = { organizationId: "org", role: "FINANCE", user: { id: "actor", name: "FIN", email: "fin@example.invalid", role: "FINANCE" } };
    function fixture() {
      const current = { id: "budget", organizationId: "org", title: "Manual", status: "DRAFT", approvedAt: null, comparisonId: null,
        updatedAt: new Date("2026-10-11T00:00:00Z"), discount: 25, advanceAmount: 10, materialCost: 7, laborCost: 11,
        items: [{ id: "active", name: "Active", quantity: 2, days: 3, unitPrice: 20, costPrice: 4, excluded: false },
          { id: "removed", name: "Removed", quantity: 1, days: 1, unitPrice: 900, costPrice: 100, excluded: true }] };
      return { current, fresh: current, calls: [] as string[], written: [] as unknown[], saved: null, signed: false };
    }
    await t.test("fixed legacy discount, excluded lines and new identity persist canonical Int totals only", async () => {
      const state = fixture(); consumer.initialize(state);
      const response = await consumer.saveBudgetEditor(context, "budget", { items: [...state.current.items, { name: "New", quantity: 1, days: 2, unitPrice: 30, costPrice: 0 }] });
      assert.equal(response.status, 200);
      const { budget } = await response.json();
      assert.equal(budget.subtotal, 180); assert.equal(budget.discount, 25); assert.equal(budget.total, 155);
      assert.equal(budget.costEstimate, 24); assert.equal(budget.materialCost, 7); assert.equal(budget.laborCost, 11);
      assert.equal(budget.items.find((item: { id: string }) => item.id === "removed").subtotal, 0);
      assert.ok(budget.items[2].id); assert.equal(new Set(budget.items.map((item: { id: string }) => item.id)).size, 3);
      assert.deepEqual(state.calls.slice(0, 2), ["lock", "signature"]);
      for (const field of ["effectiveCost", "costComplete", "margin", "legacyCostsReconciled", "zeroCostConfirmedIds"]) assert.equal(Object.hasOwn(budget, field), false);
    });
    await t.test("overflow, excessive fixed discount and excessive fixed advance fail before any writes", async () => {
      for (const mode of ["overflow", "discount", "advance"]) {
        const state = fixture(); consumer.initialize(state);
        const item = { ...state.current.items[0], unitPrice: mode === "overflow" ? 2147483647 : 20, costPrice: 0 };
        if (mode === "advance") state.current.advanceAmount = 121;
        await assert.rejects(consumer.saveBudgetEditor(context, "budget", { items: [item, state.current.items[1]], ...(mode === "discount" ? { discount: 121 } : {}) }), { status: 400 });
        assert.deepEqual(state.calls, ["lock", "signature"]); assert.deepEqual(state.written, []);
      }
    });
    await t.test("stale revision, signed budget and foreign tenant cannot reach pricing writes", async () => {
      for (const mode of ["stale", "signed", "tenant"]) {
        const state = fixture();
        if (mode === "stale") state.fresh = { ...state.current, updatedAt: new Date("2026-10-12T00:00:00Z") };
        if (mode === "signed") state.signed = true;
        if (mode === "tenant") state.fresh = { ...state.current, organizationId: "foreign" };
        consumer.initialize(state);
        await assert.rejects(consumer.saveBudgetEditor(context, "budget", { items: state.current.items }), { status: mode === "tenant" ? 404 : 409 });
        assert.equal(state.calls.some((call) => call.includes("write") || call.includes("delete") || call.includes("create")), false);
      }
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
