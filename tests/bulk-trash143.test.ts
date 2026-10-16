import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as rules from "../lib/bulk-trash";
import * as trash from "../lib/trash-shared";
import { buildCsv } from "../lib/admin-export";
const native = createRequire(import.meta.url);
function source(path: string, mocks: Record<string, unknown>, globals = {}) {
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (id: string) => mocks[id] ?? native(id), ...globals });
  return exports;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function harness(perform = async (_type: any, row: any) => ({ row, status: "success", message: "ok" }), store = new Map<string, string>()) {
  let at = 0; const values: any[] = [], dependencies: any[] = [], cleanups: any[] = [], effects: (() => void)[] = [];
  const react = { ...React,
    useState(initial: any) { const i = at++; if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial; return [values[i], (next: any) => { values[i] = typeof next === "function" ? next(values[i]) : next; }]; },
    useRef(initial: any) { const i = at++; return values[i] ??= { current: initial }; },
    useEffect(fn: any, deps: any[]) { const i = at++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const mod = source("components/admin/TrashBulk.tsx", { react, "@/lib/bulk-trash": rules, "@/lib/admin-bulk-trash": { performBulkTrash: perform }, "@/lib/admin-format": { formatNumber: String }, "@/lib/trash-shared": trash, "./AdminFields": {}, "./AdminUI": {}, "./modules/InventoryParts": {} }, { window: { sessionStorage: { getItem: (key: string) => store.get(key), setItem: (key: string, value: string) => store.set(key, value) } } });
  let options: any = { type: "Client", organizationId: "a", scopeKey: "active", enabled: true, visibleRows: [row("1"), row("2")], loadAllRows: async () => [row("1"), row("2"), row("3")], onChanged() {} };
  function render(changes = {}) { options = { ...options, ...changes }; at = 0; const result = mod.useBulkTrash(options); while (effects.length) effects.shift()!(); return result; }
  render();
  return { render, store, unmount() { cleanups.forEach(fn => fn?.()); } };
}
const row = (id: string) => ({ id, name: id, archivedAt: null });
test("el informe de lote exporta un renglón por resultado y etiqueta cada estado", () => {
  const block = rules.bulkTrashReportBlock([
    { row: { ...row("1"), name: "=2+2" }, status: "success", message: "Archivado" },
    { row: { ...row("2"), name: "Cliente; dos" }, status: "blocked", message: "Tiene reservas" },
    { row: row("3"), status: "failed", message: "Error de red" },
    { row: row("4"), status: "unknown", message: "Confirmá el estado" },
  ]);
  assert.deepEqual(block.header, ["ID", "Registro", "Resultado", "Detalle"]);
  assert.deepEqual(block.rows.map(result => result[2]), ["Confirmado", "Bloqueado", "Fallido", "Por confirmar"]);
  const csv = buildCsv([block]);
  assert.match(csv, /'=2\+2/);
  assert.match(csv, /"Cliente; dos"/);
  assert.equal((csv.match(/\r\n/g) ?? []).length, 5);
});
test("real selection hook preserves all-filter exceptions across pages and pinned filters", async () => {
  const h = harness(); await h.render().selectAll(); let bulk = h.render(); assert.equal(bulk.count, 3);
  bulk.toggle(row("2")); bulk = h.render({ visibleRows: [row("3")] }); assert.equal(bulk.count, 2); assert.equal(bulk.isSelected("2"), false);
  bulk.toggle(row("2")); bulk = h.render({ scopeKey: "other" }); assert.equal(bulk.count, 3); assert.equal(bulk.selectionScopeChanged, true);
  bulk.toggle(row("4")); assert.equal(h.render().count, 3); bulk.clear(); assert.equal(h.render().count, 0);
});
test("cancel and company switch discard late full-list results and reset loading; replacement by page cancels pending load", async () => {
  for (const action of ["clear", "company", "page", "filter"] as const) {
    const pending = deferred<any[]>(), h = harness(); const promise = h.render({ loadAllRows: () => pending.promise }).selectAll();
    let bulk = h.render(); assert.equal(bulk.loadingAll, true);
    if (action === "clear") bulk.clear();
    else if (action === "company") h.render({ organizationId: "b" });
    else if (action === "page") bulk.selectVisible();
    else h.render({ scopeKey: "new-filter" });
    pending.resolve([row("late")]); await promise; bulk = h.render();
    assert.equal(bulk.loadingAll, false, action); assert.equal(bulk.isKnown("late"), false, action); assert.equal(bulk.count, action === "page" ? 2 : 0, action);
  }
});
test("uncertain mutation stops remaining rows and blocks retries until fresh reread; report saved before POST", async () => {
  let calls = 0; let h: ReturnType<typeof harness>;
  h = harness(async (_type, selected) => { calls++; assert.match([...h.store.values()][0], /Intento iniciado/); return { row: selected, status: "unknown", message: "lost" }; });
  await h.render().selectAll(); h.render().setAction("archive"); await h.render().apply(); let bulk = h.render();
  assert.equal(calls, 1); assert.equal(bulk.count, 3); assert.equal(bulk.hasUncertainSelection, true); bulk.setAction("archive"); await h.render().apply(); assert.equal(calls, 1);
  await bulk.selectAll(); bulk = h.render(); assert.equal(bulk.hasUncertainSelection, false); assert.equal(bulk.count, 3);
});
test("late successful mutation cannot remove selection belonging to next company or continue old loop", async () => {
  const pending = deferred<any>(); let calls = 0; const h = harness(async (_type, selected) => { calls++; return pending.promise; });
  h.render().selectVisible(); h.render().setAction("archive"); const work = h.render().apply();
  h.render({ organizationId: "b" }); h.render().selectVisible(); pending.resolve({ row: row("1"), status: "success", message: "ok" }); await work;
  assert.equal(calls, 1); assert.equal(h.render().count, 2); assert.equal(h.render().busy, false);
});
test("real loader materializes over 600 rows and fails closed for missing, duplicate or changed pages", async () => {
  for (const mode of ["ok", "missing", "duplicate", "snapshot"] as const) {
    let page = 0;
    const mod = source("lib/admin-bulk-trash.ts", { "./admin-api": { adminApiGet: async () => { const start = page++ * 200; const count = Math.min(200, 605 - start); return { ok: true, data: { clients: Array.from({ length: count }, (_, n) => row(mode === "duplicate" && start ? "0" : String(start+n))), bulkSelection: mode === "missing" ? undefined : { total: 605, snapshotAt: mode === "snapshot" && start ? "changed" : "fixed", nextCursor: start + count < 605 ? String(page) : null, complete: start+count===605 } } }; } }, "./bulk-trash": rules, "./trash-shared": trash }, { URLSearchParams });
    if (mode === "ok") assert.equal((await mod.loadBulkTrashRows("/api/admin/clients", "clients")).length, 605);
    else await assert.rejects(mod.loadBulkTrashRows("/api/admin/clients", "clients"));
  }
});


test("reporte de dos éxitos permanece al recargar el recurso y se recupera tras remount sin repetir acciones", async () => {
  let calls = 0, refreshed = 0;
  const h = harness(async (_type, selected) => { calls++; return { row: selected, status: "success", message: "Archivado" }; });
  h.render({ onChanged() {
    refreshed++;
    // La recarga de useAdminResource vuelve a renderizar; no borra el reporte del hook.
    assert.equal(h.render({ visibleRows: [] }).report.length, 2);
  } }).selectVisible();
  h.render().setAction("archive");
  await h.render().apply();
  let bulk = h.render();
  assert.equal(calls, 2); assert.equal(refreshed, 1); assert.equal(bulk.count, 0); assert.equal(bulk.action, null);
  assert.equal(bulk.report.length, 2); assert.ok(bulk.report.every((row: rules.BulkTrashOutcome) => row.status === "success"));
  h.unmount();
  const reopened = harness(async () => { calls++; throw new Error("No debe reenviar al recuperar el reporte"); }, h.store);
  bulk = reopened.render();
  assert.equal(bulk.report.length, 2); assert.deepEqual([...bulk.report.map((result: rules.BulkTrashOutcome) => result.row.id)], ["1", "2"]);
  assert.equal(bulk.count, 0); assert.equal(bulk.action, null); assert.equal(calls, 2);
  reopened.render({ organizationId: "b" });
  assert.equal(reopened.render().report.length, 0);
  reopened.render({ organizationId: "a" });
  assert.equal(reopened.render().report.length, 2); assert.equal(calls, 2);
});
