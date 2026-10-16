import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_HTTP_BASE_URL);
test("stock origin HTTP/PG: mixed ownership, no external fake stock, tenant, CAS and legacy preservation", { skip: !enabled }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!), base = process.env.TEST_HTTP_BASE_URL!;
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { createInventoryUnits } = await import("../lib/server/inventory-units");
  const { confirmInventoryCount } = await import("../lib/server/inventory-stock-count");
  const org = randomUUID(), other = randomUUID(); const userIds: string[] = [];
  try {
    await db.organization.createMany({ data: [{ id: org, name: "Origin QA", slug: `origin-${org}` }, { id: other, name: "Other QA", slug: `origin-${other}` }] });
    const owner = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Same supplier name" } });
    const ownerB = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Same supplier name" } });
    const foreign = await db.supplier.create({ data: { id: randomUUID(), organizationId: other, name: "Same supplier name" } });
    async function session(role: "OWNER" | "VIEWER", targetOrg = org) {
      const id = randomUUID(); userIds.push(id);
      const user = await db.adminUser.create({ data: { id, name: "Origin QA", email: `${id}@example.invalid`, passwordHash: "not-a-login", role } });
      await db.adminMembership.create({ data: { id: randomUUID(), organizationId: targetOrg, adminUserId: id, role } });
      return { user, cookie: `ledbox_session=${(await createSession(user, targetOrg)).jwt}` };
    }
    const auth = await session("OWNER"), viewer = await session("VIEWER"), outsider = await session("OWNER", other);
    const call = async (path: string, body: unknown, cookie = auth.cookie) => fetch(`${base}${path}`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let mixedId = "", unitId = "", externalId = "";
    await t.test("consigned creation copies owner once; default update changes only future units", async () => {
      const response = await call("/api/admin/resources", { kind: "inventory", name: "Mixed QA", quantity: 2, defaultStockOrigin: "CONSIGNED", defaultSourceSupplierId: owner.id });
      assert.equal(response.status, 201); const payload = await response.json(); mixedId = payload.inventory.id;
      const units = await db.inventoryUnit.findMany({ where: { inventoryId: mixedId }, orderBy: { id: "asc" } });
      assert.equal(units.length, 2); unitId = units[0].id; assert.ok(units.every(unit => unit.stockOrigin === "CONSIGNED" && unit.ownerSupplierId === owner.id && unit.supplierId === null));
      const changed = await call("/api/admin/inventory", { kind: "item", id: mixedId, defaultStockOrigin: "OWNED", defaultSourceSupplierId: null, expectedDefaultStockOrigin: "CONSIGNED", expectedDefaultSourceSupplierId: owner.id });
      assert.equal(changed.status, 200);
      await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: mixedId, name: "Mixed QA", quantity: 1 }));
      await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: mixedId, name: "Mixed QA", quantity: 1, stockOrigin: "CONSIGNED", ownerSupplierId: ownerB.id }));
      const after = await db.inventoryUnit.findMany({ where: { inventoryId: mixedId } });
      assert.equal(after.filter(unit => unit.stockOrigin === "CONSIGNED" && unit.ownerSupplierId === owner.id).length, 2); assert.equal(after.filter(unit => unit.ownerSupplierId === ownerB.id).length, 1); assert.equal(after.filter(unit => unit.stockOrigin === "OWNED").length, 1);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: mixedId } })).quantity, 4);
    });
    await t.test("external product creates no units and explicit positive quantity is rejected", async () => {
      const response = await call("/api/admin/resources", { kind: "inventory", name: "External QA", quantity: 0, defaultStockOrigin: "EXTERNAL_RENTAL", defaultSourceSupplierId: owner.id });
      assert.equal(response.status, 201); externalId = (await response.json()).inventory.id;
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: externalId } }), 0);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: externalId } })).quantity, 0);
      assert.equal((await call("/api/admin/resources", { kind: "inventory", name: "Invalid external QA", quantity: 1, defaultStockOrigin: "EXTERNAL_RENTAL", defaultSourceSupplierId: owner.id })).status, 400);
      for (const extra of [{}, { stockOrigin: null, ownerSupplierId: null }]) assert.equal((await call("/api/admin/inventory", { kind: "unit", inventoryId: externalId, ...extra })).status, 400);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: externalId } }), 0);
    });
    await t.test("foreign owner is 404, viewer is 403, stale owner update is 409 without partial metadata changes", async () => {
      assert.equal((await call("/api/admin/resources", { kind: "inventory", name: "Foreign QA", quantity: 1, defaultStockOrigin: "CONSIGNED", defaultSourceSupplierId: foreign.id })).status, 404);
      assert.equal((await call("/api/admin/inventory", { kind: "unit-update", id: unitId, stockOrigin: "OWNED", ownerSupplierId: null, expectedStockOrigin: "CONSIGNED", expectedOwnerSupplierId: owner.id }, viewer.cookie)).status, 403);
      assert.equal((await call("/api/admin/inventory", { kind: "unit-update", id: unitId, stockOrigin: "OWNED", ownerSupplierId: null, expectedStockOrigin: "CONSIGNED", expectedOwnerSupplierId: owner.id })).status, 200);
      const before = await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } });
      const stale = await call("/api/admin/inventory", { kind: "unit-update", id: unitId, notes: "must not commit", stockOrigin: "CONSIGNED", ownerSupplierId: owner.id, expectedStockOrigin: "CONSIGNED", expectedOwnerSupplierId: owner.id });
      assert.equal(stale.status, 409); assert.deepEqual(await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } }), before);
    });
    await t.test("active product reservation blocks owner reclassification without blocking notes; release allows it", async () => {
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Origin event QA" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Origin event QA", status: "CONFIRMED" } });
      const assignment = await db.eventInventory.create({ data: { id: randomUUID(), organizationId: org, eventId: event.id, inventoryId: mixedId, quantity: 1 } });
      const before = await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } });
      const change = { kind: "unit-update", id: unitId, stockOrigin: "CONSIGNED", ownerSupplierId: ownerB.id, expectedStockOrigin: "OWNED", expectedOwnerSupplierId: null };
      assert.equal((await call("/api/admin/inventory", { ...change, notes: "must not commit" })).status, 409);
      assert.deepEqual(await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } }), before);
      assert.equal((await call("/api/admin/inventory", { kind: "unit-update", id: unitId, notes: "Allowed notes while reserved" })).status, 200);
      await db.eventInventory.update({ where: { id: assignment.id }, data: { releasedAt: new Date() } });
      assert.equal((await call("/api/admin/inventory", change)).status, 200);
      const after = await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } });
      assert.equal(after.ownerSupplierId, ownerB.id); assert.equal(after.notes, "Allowed notes while reserved");
    });
    await t.test("legacy null survives unrelated edits and count confirmation copies defaults only for added units", async () => {
      const legacy = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Legacy QA", category: "QA", quantity: 0, stockCountStatus: "PENDING_COUNT" } });
      assert.equal((await call("/api/admin/inventory", { kind: "item", id: legacy.id, notes: "Unrelated" })).status, 200);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: legacy.id } })).defaultStockOrigin, null);
      const context = { organizationId: org, user: auth.user };
      await db.$transaction(tx => confirmInventoryCount(tx, context, legacy.id, 1));
      const unit = await db.inventoryUnit.findFirstOrThrow({ where: { inventoryId: legacy.id } }); assert.equal(unit.stockOrigin, null);
      await assert.rejects(db.$transaction(tx => confirmInventoryCount(tx, context, externalId, 1)), /alquiler externo/i);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: externalId } })).quantity, 0);
    });
    await t.test("ownership is present in private unit DTO; unrelated owner cannot read/update it; company purge remains atomic", async () => {
      const response = await fetch(`${base}/api/admin/inventory?itemId=${encodeURIComponent(mixedId)}`, { headers: { Cookie: auth.cookie } });
      assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /stockOrigin/); assert.match(text, /ownerSupplierId/);
      const foreignRead = await fetch(`${base}/api/admin/inventory?itemId=${encodeURIComponent(mixedId)}`, { headers: { Cookie: outsider.cookie } });
      assert.equal(foreignRead.status, 200); assert.deepEqual((await foreignRead.json()).inventory, []);
      const foreignAvailability = await fetch(`${base}/api/admin/inventory?inventoryId=${encodeURIComponent(mixedId)}`, { headers: { Cookie: outsider.cookie } });
      assert.equal(foreignAvailability.status, 404);
      assert.equal((await call("/api/admin/inventory", { kind: "unit-update", id: unitId, notes: "other tenant" }, outsider.cookie)).status, 404);
      // The enclosing finally removes both suppliers and units in one company cascade,
      // exercising the deferred NO ACTION ownership FK rather than losing owners via SET NULL.
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
});
