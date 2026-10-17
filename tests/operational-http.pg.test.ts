import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in contra un servidor de desarrollo LOCAL del mismo árbol; nunca producción.
test("API operativa: estados concurrentes, lote atómico, renombre público y permisos", { skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_HTTP_BASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.TEST_HTTP_BASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { createFamily } = await import("../lib/server/inventory-families");
  const { createInventoryUnits } = await import("../lib/server/inventory-units");
  const { resolveInventoryCategory, categoryWriteData } = await import("../lib/server/inventory-categories");
  const org = randomUUID(), other = randomUUID();
  const users: string[] = [];
  const login = async (role: "OWNER" | "OPERATIONS" | "VIEWER", organizationId = org) => {
    const id = randomUUID(); users.push(id);
    const user = await db.adminUser.create({ data: { id, email: `${id}@example.invalid`, name: "QA Ops", passwordHash: "not-a-login", role, autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: id, organizationId, role } });
    return `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
  };
  try {
    await db.organization.createMany({ data: [org, other].map(id => ({ id, name: "QA HTTP operaciones", slug: `ops-http-${id}` })) });
    const owner = await login("OWNER"), operator = await login("OPERATIONS"), viewer = await login("VIEWER"), foreign = await login("OWNER", other);
    const call = async (path: string, body: unknown, cookie = owner, method = "POST") => {
      const r = await fetch(new URL(path, base), { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await r.text();
      assert.ok(r.headers.get("content-type")?.includes("json"), `${r.status}: ${text.slice(0, 300)}`);
      return { status: r.status, data: JSON.parse(text) };
    };
    const inventory = (body: unknown, cookie = owner) => call("/api/admin/inventory", body, cookie);
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: `SillaQA${org.slice(0, 4)}`, category: "Sillas", quantity: 0 } });
    await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 2 }));
    const units = await db.inventoryUnit.findMany({ where: { inventoryId: item.id } });
    await t.test("dos retiros HTTP esperando el mismo producto dejan cantidad cero", async () => {
      // Calienta la ruta antes de intercalar peticiones con el lock.
      assert.equal((await inventory({ kind: "unit-update", id: units[0].id, notes: "QA" })).status, 200);
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      const ready = new Promise<void>(r => { locked = r; });
      const holder = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${item.id} FOR UPDATE`;
        locked(); await gate;
      }, { timeout: 20000 });
      await ready;
      const pending = units.map(unit => inventory({ kind: "unit-update", id: unit.id, status: "RETIRED" }));
      await new Promise(r => setTimeout(r, 500)); release(); await holder;
      for (const response of await Promise.all(pending)) assert.equal(response.status, 200);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id, status: { not: "RETIRED" } } }), 0);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 0);
      const result = await inventory({ kind: "bulk-units", ids: units.map(u => u.id).reverse(), changes: { status: "AVAILABLE" } });
      assert.equal(result.status, 200);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 2);
    });
    await t.test("lote mixto variante+suelto rechaza 409 sin cambiar categoría, precio ni crear taxonomía", async () => {
      await db.$transaction(async tx => {
        const category = await resolveInventoryCategory(tx, org, { category: "Sillas" }); assert.ok(category);
        await tx.inventoryItem.update({ where: { id: item.id }, data: categoryWriteData(category) });
      });
      const family = await db.$transaction(tx => createFamily(tx, org, { name: "SillaQA", axes: [{ label: "Color", values: ["Negro"] }], members: [{ itemId: item.id, options: { color: "Negro" } }] }));
      assert.ok(family.ok);
      const loose = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "MantelQA", category: "Textil", listPrice: 50 } });
      const before = await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true, categoryId: true, category: true, listPrice: true } });
      const categories = await db.inventoryCategory.count({ where: { organizationId: org } });
      const r = await inventory({ kind: "bulk-items", ids: [loose.id, item.id], changes: { category: "Nueva inválida", listPrice: 999 }, idempotencyKey: randomUUID() });
      assert.equal(r.status, 409); assert.match(r.data.error, /Variantes/);
      assert.deepEqual(await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true, categoryId: true, category: true, listPrice: true } }), before);
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org } }), categories);
      assert.equal((await inventory({ kind: "unit-update", id: units[0].id, status: "RETIRED" }, viewer)).status, 403);
      assert.equal((await inventory({ kind: "unit-update", id: units[0].id, status: "RETIRED" }, foreign)).status, 404);
    });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "ClienteQA" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Evento QA" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: "BodaQA", total: 100, subtotal: 100 } });
    await t.test("ambas entradas protegen nombre aceptado y permiten operación", async () => {
      assert.equal((await call("/api/admin/events", { id: event.id, name: "Evento nuevo" }, operator, "PATCH")).status, 200);
      await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      assert.equal((await call("/api/admin/events", { id: event.id, name: "No permitido" }, operator, "PATCH")).status, 409);
      assert.equal((await call(`/api/admin/budgets/${budget.id}/event`, { name: "No permitido", originalName: "Evento nuevo" }, owner, "PATCH")).status, 409);
      assert.equal((await call("/api/admin/events", { id: event.id, name: "Evento nuevo", notes: "Montaje confirmado", status: "IN_PROGRESS" }, operator, "PATCH")).status, 200);
      assert.equal((await call("/api/admin/events", { id: event.id, name: "Ajeno" }, foreign, "PATCH")).status, 404);
      assert.equal((await call("/api/admin/events", { id: event.id, name: "No viewer" }, viewer, "PATCH")).status, 403);
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).name, "Evento nuevo");
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.adminUser.deleteMany({ where: { id: { in: users } } });
    await dbWithDeleted.$disconnect();
  }
});
