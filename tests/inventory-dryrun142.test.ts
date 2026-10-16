import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

/** Ejecutar la función real; sólo DB/auditoría son límites simulados. */
function engine() {
  const text = readFileSync("lib/server/inventory-availability.ts", "utf8");
  const source = ts.createSourceFile("engine.ts", text, ts.ScriptTarget.Latest, true);
  const names = ["reserveBudgetInventory", "groupLinkedItems", "eventReservationRange", "StrictStockShortage", "DryRunRollback"];
  const pieces = source.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text)).map(node => node.getText(source).replace(/^export /, ""));
  const audits: unknown[] = [], transactions: unknown[] = [];
  const date = new Date("2037-01-01T12:00:00Z");
  const budget = { id: "budget", title: "Prueba", client: { name: "Ana" }, event: { id: "event", name: "Evento", startsAt: date, endsAt: new Date(date.getTime() + 86400000), setupAt: null, strikeAt: null }, items: [{ id: "line", name: "Mesa", quantity: 1, inventoryId: "item", inventory: { id: "item", name: "Mesa", quantity: 2, _count: { components: 0 } } }] };
  const module = { exports: {} as any };
  const code = ts.transpileModule(`${pieces.join("\n")}\nmodule.exports = reserveBudgetInventory;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, Date, Map, Error, console: { error() {} }, EMPTY_RESERVATION: { eventId: null, eventName: null, range: null, outcomes: [], requested: 0, reserved: 0, conflicts: 0, failed: false }, EVENT_RANGE_SELECT: {}, MAINTENANCE_UNITS_SELECT: {},
    db: { budget: { findFirst: async ({ where }: any) => { assert.equal(where.organizationId, "org"); return budget; } }, $transaction: async () => { transactions.push(true); throw new Error("DB unavailable"); } },
    recordAudit: async (entry: unknown) => audits.push(entry),
  });
  return { run: (dryRun = true) => module.exports({ organizationId: "org", budgetId: "budget", context: {}, dryRun }), budget, audits, transactions };
}

test("motor real: error transaccional de dryRun devuelve failed y no audita una aprobación", async () => {
  const f = engine(), result = await f.run();
  assert.equal(result.failed, true); assert.equal(result.reserved, 0); assert.equal(f.transactions.length, 1); assert.equal(f.audits.length, 0);
});

test("motor real: dryRun sin evento o rango no abre tx ni audita", async () => {
  for (const scenario of ["event", "end", "inverted"]) {
    const f = engine();
    if (scenario === "event") f.budget.event = null as any;
    else if (scenario === "end") f.budget.event.endsAt = null as any;
    else f.budget.event.endsAt = new Date("2000-01-01");
    const result = await f.run(); assert.equal(result.failed, false); assert.equal(result.range, null);
    assert.equal(f.transactions.length, 0); assert.equal(f.audits.length, 0);
  }
});
