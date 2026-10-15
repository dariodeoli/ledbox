import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { archivedFieldsForActive, crmActionCapability, CRM_MODELS, CRM_SEGMENTS } from "../lib/server/trash-crm";
import { roleCan } from "../lib/server/permissions";
import { deletedLabel, withDeletedLabel } from "../lib/deleted-label";

const read = (path: string) => readFileSync(path, "utf8");

test("capacidades: archivar, desarchivar y eliminar usan la escritura de la entidad; el resto trash.manage", () => {
  const write = { Client: "clients.write", Lead: "clients.write", Supplier: "suppliers.write", Promoter: "promoters.write", Budget: "budgets.write" } as const;
  for (const model of CRM_MODELS) {
    for (const action of ["archive", "unarchive", "trash"]) assert.equal(crmActionCapability(model, action), write[model], `${model}.${action}`);
    for (const action of ["restore", "purge", "anonymize"]) assert.equal(crmActionCapability(model, action), "trash.manage", `${model}.${action}`);
    assert.equal(crmActionCapability(model, "delete"), undefined);
    assert.equal(crmActionCapability(model, "constructor"), undefined);
  }
  for (const role of ["OPERATIONS", "FINANCE", "VIEWER"] as const) assert.equal(roleCan(role, "trash.manage"), false, role);
  assert.equal(roleCan("VIEWER", "clients.write"), false);
});

test("active↔archivedAt: desactivar archiva (una sola vez) y activar desarchiva", () => {
  const fresh = archivedFieldsForActive(false, { archivedAt: null }, "u1") as { archivedAt?: Date; archivedById?: string };
  assert.ok(fresh.archivedAt instanceof Date);
  assert.equal(fresh.archivedById, "u1");
  assert.deepEqual(archivedFieldsForActive(false, { archivedAt: new Date() }, "u1"), {});
  assert.deepEqual(archivedFieldsForActive(true, { archivedAt: new Date() }, "u1"), { archivedAt: null, archivedById: null });
});

test("cada entidad CRM tiene su ruta [id]/[action] y todas pasan por el manejador común", () => {
  for (const [segment, model] of Object.entries(CRM_SEGMENTS)) {
    const file = read(`app/api/admin/${segment}/[id]/[action]/route.ts`);
    assert.match(file, new RegExp(`handleCrmAction\\("${model}"`), segment);
  }
  const handler = read("lib/server/trash-crm-route.ts");
  assert.match(handler, /crmActionCapability/);
  assert.match(handler, /requireAdminContext\(capability\)/);
});

test("las mutaciones por id de estas entidades verifican que la fila esté viva (assertLive)", () => {
  const expectations: Array<[string, string]> = [
    ["app/api/admin/clients/[id]/route.ts", 'assertLive("Client"'],
    ["app/api/admin/suppliers/route.ts", 'assertLive("Supplier"'],
    ["app/api/admin/resources/route.ts", 'assertLive("Promoter"'],
    ["app/api/leads/route.ts", 'assertLive("Lead"'],
    ["app/api/admin/budgets/route.ts", 'assertLive("Budget"'],
  ];
  for (const [file, needle] of expectations) assert.ok(read(file).includes(needle), `${file} debe llamar ${needle}`);
});

test("el PATCH de proveedores mantiene active y archivedAt juntos", () => {
  assert.match(read("app/api/admin/suppliers/route.ts"), /archivedFieldsForActive\(/);
});

test("el portal y el logo no sirven al cliente eliminado", () => {
  assert.match(read("lib/server/budget-portal.ts"), /budget\.client\.deletedAt\) return null/);
  assert.match(read("app/api/portal/budget/[token]/client-logo/route.ts"), /deletedAt: null/);
  assert.match(read("lib/server/catalog-access.ts"), /client\.deletedAt/);
});

test("GET /api/admin/trash lista las 7 entidades", () => {
  const ops = read("lib/server/trash-ops.ts");
  for (const model of ["Event", "InventoryItem", "Client", "Lead", "Supplier", "Promoter", "Budget"]) assert.ok(ops.includes(`type: "${model}"`), model);
});

test("el rótulo «(eliminado)» sale de un helper compartido y se usa en cobros, por cobrar y gastos", () => {
  assert.equal(deletedLabel("Ana", new Date()), "Ana (eliminado)");
  assert.equal(withDeletedLabel({ name: "Ana", deletedAt: null }).name, "Ana");
  assert.equal(withDeletedLabel({ name: "Ana", deletedAt: new Date() }).name, "Ana (eliminado)");
  assert.equal(withDeletedLabel(null), null);
  const financeRoute = read("app/api/admin/finance/route.ts");
  assert.match(financeRoute, /import \{ readFinanceListing \} from "@\/lib\/server\/finance-listing"/);
  assert.match(financeRoute, /readFinanceListing\(organizationId, new URL\(request\.url\)\.searchParams\)/);
  for (const file of ["lib/server/finance-listing.ts", "app/api/admin/finance/expected/route.ts", "app/api/admin/expenses/route.ts"]) {
    assert.ok(read(file).includes("withDeletedLabel"), file);
    assert.match(read(file), /deletedAt: true/, file);
  }
  const listing = read("lib/server/finance-listing.ts");
  assert.match(listing, /client: withDeletedLabel\(payment\.client\)/);
  assert.match(listing, /supplier: withDeletedLabel\(job\.supplier\)/);
});

test("ia/anular encuentra al cliente eliminado (siempre dentro de la empresa)", () => {
  assert.match(read("app/api/admin/ia/anular/route.ts"), /where: \{ id, organizationId, deletedAt: undefined \}/);
});
