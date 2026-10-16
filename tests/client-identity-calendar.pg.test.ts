import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

test("calendar's real queries project only scoped commercial identities, without logo bytes or private contacts", { skip: !process.env.TEST_DATABASE_URL }, async () => {
 const url = new URL(process.env.TEST_DATABASE_URL!); assert(["localhost", "127.0.0.1"].includes(url.hostname)); process.env.DATABASE_URL = url.toString();
 const { db } = await import("../lib/server/db");
 const [notifications, availability, operations, movements, identity, presentation, http] = await Promise.all([import("../lib/server/notifications"), import("../lib/server/inventory-availability"), import("../lib/server/inventory-operations"), import("../lib/calendar-movements"), import("../lib/server/client-identity"), import("../lib/client-identity"), import("../lib/server/http")]);
 const org = randomUUID(), foreign = randomUUID();
 try {
  for (const id of [org, foreign]) await db.organization.create({ data: { id, name: "Identity QA", slug: `identity-qa-${id}` } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Historic", tradeName: "Commercial", contactName: "Explicit manager", contactPhone: "PRIVATE-CONTACT", notes: "PRIVATE-NOTES", type: "RESELLER" } });
  await db.clientLogo.create({ data: { id: randomUUID(), clientId: client.id, mime: "image/png", size: 4, data: Buffer.from("LOGO") } });
  const foreignClient = await db.client.create({ data: { id: randomUUID(), organizationId: foreign, name: "FOREIGN-CLIENT" } });
  const at = new Date("2031-03-10T12:00:00Z");
  const ownEvent = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, status: "CONFIRMED", name: "Own event", startsAt: at, endsAt: new Date("2031-03-11T12:00:00Z") } });
  await db.event.create({ data: { id: randomUUID(), organizationId: foreign, clientId: foreignClient.id, name: "FOREIGN-EVENT", startsAt: at } });
  const stock = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Movement stock", category: "QA", quantity: 1 } });
  await db.eventInventory.create({ data: { id: randomUUID(), eventId: ownEvent.id, inventoryId: stock.id, quantity: 1 } });
  await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, amount: 1000, status: "RECEIVED", paidAt: at } });
  const sf = ts.createSourceFile("calendar.ts", readFileSync("app/api/admin/calendar/route.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declarations = sf.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)).map(node => node.getText(sf).replace(/^export /, "")).join("\n");
  const get = runInNewContext(ts.transpileModule(declarations + ";GET;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { ...notifications, ...availability, ...operations, ...movements, ...identity, ...presentation, ...http, db, URL, Date, Response, requireAdminContext: async () => ({ ok: true, context: { organizationId: org } }) });
  const response = await get(new Request("http://localhost/api/admin/calendar?from=2031-03-01&to=2031-03-31")); assert.equal(response.status, 200);
  const body = await response.json(); const wire = JSON.stringify(body); assert(!wire.includes("FOREIGN")); assert(!wire.includes("PRIVATE-")); assert(!wire.includes("LOGO"));
  const event = body.items.find((row: any) => row.kind === "event"), payment = body.items.find((row: any) => row.kind === "collection"), movement = body.items.find((row: any) => row.kind === "inventory_out");
  for (const row of [event, payment, movement]) { assert(row); assert.equal(row.client.id, client.id); assert.equal(row.client.tradeName, "Commercial"); assert.equal(row.client.contactName, "Explicit manager"); assert.equal(row.client.type, "RESELLER"); assert(row.client.logoUpdatedAt); assert(!Object.hasOwn(row.client, "logo")); assert(!Object.hasOwn(row.client, "phone")); assert(!Object.hasOwn(row.client, "email")); }
  await db.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
  const deletedResponse = await get(new Request("http://localhost/api/admin/calendar?from=2031-03-01&to=2031-03-31"));
  const deletedBody = await deletedResponse.json(); assert(deletedBody.items.find((row: any) => row.kind === "event").client.deletedAt);
 } finally { await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } }); await db.$disconnect(); }
});
