import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { CLIENT_IDENTITY_SELECT, clientIdentityDTO } from "../lib/server/client-identity";
import { clientPresentation } from "../lib/client-identity";

/** Real GET + real canonical projection/DTO; session/DB boundaries are doubles.
 * Projection honors the actual Prisma select, so a missing field stays missing. */
function fixture(denied = false) {
 let queries = 0;
 const date = new Date("2031-03-10T12:00:00Z");
 const source = { id: "client", name: "Historic", company: "Company", tradeName: "Commercial", legalName: "Legal", contactName: "Explicit manager", type: "RESELLER", deletedAt: date, phone: "+595981000000", email: "PRIVATE-EMAIL", contactPhone: "PRIVATE-PHONE", notes: "PRIVATE-NOTES", logo: { updatedAt: date, data: Buffer.from("PRIVATE-BYTES") } };
 const project = (row: any, select: any): any => Object.fromEntries(Object.entries(select).map(([key, value]: any) => [key, value === true ? row[key] : row[key] == null ? null : project(row[key], value.select)]));
 const db = { event: { findMany: async (query: any) => {
  queries++; assert.equal(query.where.organizationId, "tenant");
  assert.equal(query.include.client.select.phone, true, "preserve existing operative phone contract");
  return [{ id: "event", assignments: [], tasks: [], client: project(source, query.include.client.select) }];
 } } };
 const path = "app/api/admin/event-ops/route.ts", sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
 const declarations = sf.statements.filter(node => ts.isFunctionDeclaration(node) && ["GET", "withCleaning"].includes(node.name?.text ?? "") || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(sf) === "promoterSelect")).map(node => node.getText(sf).replace(/^export /, "")).join("\n");
 const get = runInNewContext(ts.transpileModule(declarations + ";GET;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { db, CLIENT_IDENTITY_SELECT, clientIdentityDTO, URL, Response, Date, requireAdminContext: async () => denied ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, context: { organizationId: "tenant" } }, loadRentalSettings: async () => ({}), resolveRentalBuffers: () => ({ afterMin: 0 }) });
 return { get, queries: () => queries };
}

test("event panel summary retains the tile's canonical avatar, business, manager and segment without private contacts", async () => {
 const f = fixture(); const response = await f.get(new Request("http://localhost/api/admin/event-ops?fields=panel"));
 assert.equal(response.status, 200); const data = await response.json(); const client = data.events[0].client;
 assert.equal(client.logoUpdatedAt, "2031-03-10T12:00:00.000Z"); assert.equal(client.phone, "+595981000000");
 assert.equal(client.deletedAt, "2031-03-10T12:00:00.000Z");
 const presentation = clientPresentation(client); assert.match(presentation.primary, /Commercial/); assert.match(presentation.primary, /eliminado/i); assert.equal(presentation.responsible, "Explicit manager"); assert.equal(presentation.category, "Mayorista");
 for (const field of ["logo", "email", "contactPhone", "notes"]) assert(!Object.hasOwn(client, field), field);
 assert(!JSON.stringify(data).includes("PRIVATE-")); assert.equal(f.queries(), 1);
});

test("event panel identity still requires current tenant authorization before querying", async () => {
 const f = fixture(true); const response = await f.get(new Request("http://localhost/api/admin/event-ops?fields=panel"));
 assert.equal(response.status, 403); assert.equal(f.queries(), 0);
});
