import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { roleCan } from "../lib/server/permissions";
import { readJson, jsonError } from "../lib/server/http";
import { trashActionPath, canOfferAnonymize } from "../lib/trash-shared";

function route(role: string | null) {
 const writes: unknown[][] = [];
 const path = "app/api/admin/inventory/families/[id]/[action]/route.ts";
 const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
 const fn = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "POST")!;
 const post = runInNewContext(ts.transpileModule(fn.getText(sf).replace(/^export /, "") + ";POST;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
  Response, readJson, jsonError, trashErrorResponse: () => null,
  requireAdminContext: async (capability: any) => {
   assert.equal(capability, "trash.manage");
   return role && roleCan(role as any, capability) ? { ok: true, context: { organizationId: "tenant" } } : { ok: false, response: Response.json({}, { status: role ? 403 : 401 }) };
  },
  restore: async (...args: unknown[]) => writes.push(args), purgeInventoryFamily: async (...args: unknown[]) => writes.push(args),
 });
 const call = (action: string) => post(new Request("http://localhost/api/admin/inventory/families/id/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmName: "Familia QA", reason: "Motivo QA" }) }), { params: Promise.resolve({ id: "family", action }) });
 return { call, writes };
}

test("acciones de familia usan trash.manage real: sólo OWNER/ADMIN restauran o purgan", async () => {
 for (const role of [null, "VIEWER", "OPERATIONS", "FINANCE"]) {
  const f = route(role); for (const action of ["restore", "purge"]) assert.equal((await f.call(action)).status, role ? 403 : 401); assert.equal(f.writes.length, 0);
 }
 for (const role of ["OWNER", "ADMIN"]) {
  const f = route(role); assert.equal((await f.call("restore")).status, 200); assert.deepEqual(Array.from(f.writes[0]), ["InventoryFamily", "family", { organizationId: "tenant" }]);
  assert.equal((await f.call("purge")).status, 200); assert.deepEqual(JSON.parse(JSON.stringify(f.writes[1])), ["family", { confirmName: "Familia QA", reason: "Motivo QA" }, { organizationId: "tenant" }]);
 }
});

test("el registro de Eliminados apunta al controlador de familia sin ofrecer anonimizar", async () => {
 assert.equal(trashActionPath("InventoryFamily", "family", "restore"), "/api/admin/inventory/families/family/restore");
 assert.equal(trashActionPath("InventoryFamily", "family", "purge"), "/api/admin/inventory/families/family/purge");
 assert.equal(canOfferAnonymize("InventoryFamily", [{ kind: "familyVariants", count: 2 }]), false);
 const f = route("OWNER"); assert.equal((await f.call("anonymize")).status, 404); assert.equal(f.writes.length, 0);
});
