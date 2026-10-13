import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("eventos: el 409 de cierre trae código y la UI ofrece «Cerrar igual» con nota obligatoria, solo con permiso de escritura", () => {
  const api = read("app/api/admin/events/route.ts");
  assert.match(api, /409, "closure_blocked"/);
  const adminApi = read("lib/admin-api.ts");
  assert.match(adminApi, /return code \? \{ ok: false, error: message, code \}/);
  const ui = read("components/admin/modules/EventosModule.tsx");
  assert.match(ui, /result\.code === "closure_blocked"/);
  assert.match(ui, /Cerrar igual/);
  assert.match(ui, /forceClose: true, forceCloseNote: note/);
  assert.match(ui, /form=\{forceFormId\}/);
  assert.match(ui, /note\.length < 5 \|\| note\.length > 400/);
  assert.match(ui, /\{writable && closeBlock \?/);
  assert.match(ui, /const closable = writable &&/);
});

test("incidentes: «Unidad sin identificar» solo para retenidos por cantidad en ítems con unidades", async () => {
  const { isUnidentifiedUnitIncident, UNIDENTIFIED_UNIT_LABEL } = await import("../lib/inventory-incident-label");
  assert.equal(UNIDENTIFIED_UNIT_LABEL, "Unidad sin identificar");
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: null, inventory: { _count: { units: 3 } } }), true);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: null, inventory: { _count: { units: 0 } } }), false);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: false, unitId: null, inventory: { _count: { units: 3 } } }), false);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: "u1", inventory: { _count: { units: 3 } } }), false);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: null, inventory: {} }), false);
  assert.match(read("components/admin/modules/InventoryIncidents.tsx"), /isUnidentifiedUnitIncident\(incident\)/);
  assert.match(read("app/api/admin/inventory/incidents/route.ts"), /_count: \{ select: \{ units: true \} \}/);
});

test("finanzas: «Pagar» del trabajo de proveedor es un AdminDialog con footer, dirty y form={id}; el monto no cambia", () => {
  const src = read("components/admin/modules/FinanzasModule.tsx");
  const start = src.indexOf("savePayJob(event");
  assert.ok(start > 0);
  const block = src.slice(src.indexOf("{writable && payJob && payJobRow ?"), src.indexOf("<AdminDataState", src.indexOf("{writable && payJob && payJobRow ?")));
  assert.match(block, /<AdminDialog/);
  assert.match(block, /dirty=\{JSON\.stringify\(payJob\) !== JSON\.stringify\(payJobBase\)\}/);
  assert.match(block, /form=\{payJobFormId\}/);
  assert.doesNotMatch(block, /admin-inline-form/);
  assert.match(src, /amount: String\(supplierJobBalance\(job\) \|\| ""\)/);
  assert.match(src, /const amount = Number\(payJob\.amount\);/);
});
