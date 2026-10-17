import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("catálogo de venta: inclusión tenant-scoped separada del alquiler y sin mutar inventario", { skip: !process.env.TEST_DATABASE_URL || !process.env.INVENTORY_AUDIT_BASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.INVENTORY_AUDIT_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const organizationIds = [randomUUID(), randomUUID()];
  const userIds: string[] = [];
  try {
    await db.organization.createMany({ data: organizationIds.map(id => ({ id, name: "QA catálogo separado", slug: `sale-catalog-${id}` })) });
    const cookies: string[] = [];
    for (const organizationId of organizationIds) {
      const id = randomUUID(); userIds.push(id);
      const user = await db.adminUser.create({ data: { id, name: "QA catálogo", email: `${id}@example.invalid`, passwordHash: "no-login", autoLockEnabled: false } });
      await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: id, organizationId, role: "OWNER" } });
      cookies.push(`ledbox_session=${(await createSession(user, organizationId)).jwt}`);
    }
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: organizationIds[0], name: "Producto dual QA", category: "QA", quantity: 3, visibleOnWeb: true, catalogAudience: "RETAIL" } });
    const call = (cookie: string, saleCatalogEnabled: unknown) => fetch(new URL("/api/admin/inventory", base), {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "item", id: item.id, saleCatalogEnabled }),
    });
    const before = await db.inventoryItem.findFirstOrThrow({ where: { id: item.id, organizationId: organizationIds[0] } });
    assert.equal(before.saleCatalogEnabled, false);
    const invalid = await call(cookies[0], "yes");
    assert.equal(invalid.status, 400);
    const foreign = await call(cookies[1], true);
    assert.equal(foreign.status, 404);
    const enabled = await call(cookies[0], true);
    assert.equal(enabled.status, 200, await enabled.clone().text());
    const result = (await enabled.json()).inventory;
    assert.equal(result.saleCatalogEnabled, true);
    assert.equal(result.visibleOnWeb, true, "la marca de venta no modifica el canal existente de alquiler");
    assert.equal(result.catalogAudience, "RETAIL");
    const after = await db.inventoryItem.findFirstOrThrow({ where: { id: item.id, organizationId: organizationIds[0] } });
    assert.deepEqual(
      { quantity: after.quantity, stockCountStatus: after.stockCountStatus, saleCatalogEnabled: after.saleCatalogEnabled },
      { quantity: before.quantity, stockCountStatus: before.stockCountStatus, saleCatalogEnabled: true },
    );
    assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id } }), 0);
    assert.equal(await db.eventInventory.count({ where: { inventoryId: item.id } }), 0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: organizationIds[0], entity: "InventoryItem", entityId: item.id }, orderBy: { createdAt: "desc" } });
    assert.match(JSON.stringify(audit.detail), /saleCatalogEnabled/);
    assert.equal(await db.auditLog.count({ where: { organizationId: organizationIds[1], entity: "InventoryItem", entityId: item.id } }), 0);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
});
