import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const dbUrl = process.env.TEST_DATABASE_URL, base = process.env.INVENTORY_AUDIT_BASE_URL;
const local = Boolean(dbUrl && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(dbUrl) && base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));

test("inventario HTTP: rechaza listas y escalares JSON sin escribir, conserva altas válidas", { skip: !local }, async (t) => {
  process.env.DATABASE_URL = dbUrl;
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), userId = randomUUID();
  try {
    await db.organization.create({ data: { id: org, slug: `inventory-json-${org}`, name: "QA inventario ficticio" } });
    const user = await db.adminUser.create({ data: { id: userId, name: "QA", email: `${userId}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId: org, role: "OWNER" } });
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const call = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla QA", category: "QA", quantity: 2 } });
    const snapshot = async () => ({
      items: await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, omit: { imageData: true } }),
      units: await db.inventoryUnit.count({ where: { organizationId: org } }),
      incidents: await db.inventoryIncident.count({ where: { organizationId: org } }),
      families: await db.inventoryFamily.count({ where: { organizationId: org } }),
      categories: await db.inventoryCategory.count({ where: { organizationId: org } }),
      audits: await db.auditLog.count({ where: { organizationId: org } }),
    });
    const before = await snapshot();
    for (const path of ["/api/admin/inventory", "/api/admin/inventory/incidents", "/api/admin/inventory/combos", "/api/admin/inventory/families"]) {
      await t.test(`${path}: null, listas y valores primitivos dan 400`, async () => {
        for (const body of [null, [], ["dato"], true, false, 42, "texto"]) {
          const response = await call(path, body);
          assert.equal(response.status, 400, `${JSON.stringify(body)}: ${await response.clone().text()}`);
          assert.equal(typeof (await response.json()).error, "string");
          assert.deepEqual(await snapshot(), before);
        }
      });
    }
    await t.test("los objetos válidos conservan edición, incidente, combo y familia", async () => {
      assert.equal((await call("/api/admin/inventory", { kind: "item", id: item.id, notes: "Dato válido" })).status, 200);
      assert.equal((await call("/api/admin/inventory/incidents", { kind: "create", inventoryId: item.id, incidentKind: "REPAIR", quantity: 1 })).status, 201);
      assert.equal((await call("/api/admin/inventory/combos", { kind: "combo-save", name: "Combo QA", components: [{ componentId: item.id, quantity: 1 }] })).status, 201);
      const member = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Mantel QA", category: "QA", quantity: 1 } });
      const response = await call("/api/admin/inventory/families", { name: "Manteles QA", axes: [{ label: "Color", values: [{ value: "Blanco" }] }], members: [{ itemId: member.id, options: { color: "Blanco" } }] });
      assert.equal(response.status, 201, await response.clone().text());
    });
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.inventoryIncident.deleteMany({ where: { organizationId: org } });
    await db.inventoryComponent.deleteMany({ where: { organizationId: org } });
    await db.inventoryUnit.deleteMany({ where: { organizationId: org } });
    await db.inventoryItem.deleteMany({ where: { organizationId: org } });
    await db.inventoryFamily.deleteMany({ where: { organizationId: org } });
    await db.inventoryCategory.deleteMany({ where: { organizationId: org } });
    await db.adminMembership.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
