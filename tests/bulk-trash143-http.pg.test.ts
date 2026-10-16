import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Servidor local del mismo checkout/DB; sin proveedor externo ni correos.
// TEST_DATABASE_URL=postgresql://... BULK143_BASE_URL=http://127.0.0.1:3172 AUTH_SECRET=... JWT_SECRET=... node --import tsx --test tests/bulk-trash143-http.pg.test.ts
test("143 HTTP: selección de seis tipos, más de 600 clientes, watermark, roles y archivo/papelera canónicos", { skip: !process.env.TEST_DATABASE_URL || !process.env.BULK143_BASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!), base = new URL(process.env.BULK143_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db"), { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), foreignOrg = randomUUID(), users: string[] = [];
  const session = async (organizationId: string, role: "OWNER" | "VIEWER" | "OPERATIONS" = "OWNER") => {
    const id = randomUUID(); users.push(id);
    const user = await db.adminUser.create({ data: { id, name: "Fixture bulk143", email: `${id}@example.invalid`, role: "OWNER", passwordHash: "not-login" } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: id, role } });
    return `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
  };
  try {
    await db.organization.createMany({ data: [{ id: org, name: "QA143 temporal", slug: `qa143-${org}` }, { id: foreignOrg, name: "QA143 aislada", slug: `qa143-${foreignOrg}` }] });
    const owner = await session(org), viewer = await session(org, "VIEWER"), other = await session(foreignOrg), operations = await session(org, "OPERATIONS");
    const clientIds = Array.from({ length: 605 }, () => randomUUID());
    await db.client.createMany({ data: clientIds.map((id, n) => ({ id, organizationId: org, name: `Cliente ${n}`, company: `Empresa ${n}`, contactName: `Responsable ${n}` })) });
    const ids = () => Array.from({ length: 205 }, () => randomUUID());
    await db.supplier.createMany({ data: ids().map(id => ({ id, organizationId: org, name: `Proveedor ${id}` })) });
    await db.promoter.createMany({ data: ids().map(id => ({ id, organizationId: org, name: `Promotora ${id}` })) });
    await db.inventoryItem.createMany({ data: ids().map(id => ({ id, organizationId: org, name: `Producto ${id}`, category: "QA", quantity: 0 })) });
    await db.budget.createMany({ data: ids().map(id => ({ id, organizationId: org, clientId: clientIds[0], title: `Presupuesto ${id}` })) });
    await db.event.createMany({ data: ids().map(id => ({ id, organizationId: org, clientId: clientIds[0], name: `Evento ${id}` })) });
    const call = (path: string, cookie = owner, body?: unknown) => fetch(`${base.origin}${path}`, { headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
    const paths = [ ["/api/admin/clients", "clients", 605], ["/api/admin/resources?only=suppliers", "suppliers", 205], ["/api/admin/resources?only=promoters", "promoters", 205], ["/api/admin/inventory", "inventory", 205], ["/api/admin/budgets", "budgets", 205], ["/api/admin/event-ops", "events", 205] ] as const;
    for (const [path, key, expected] of paths) {
      const target = new URL(path, base); target.searchParams.set("fields", "bulk-selection");
      assert.equal((await call(target.pathname + target.search, viewer)).status, 403);
      let count = 0, snapshot = "", cursor: string | null = null; const seen = new Set<string>();
      do {
        if (cursor) target.searchParams.set("cursor", cursor);
        const response = await call(target.pathname + target.search); assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`); const data = await response.json();
        assert.equal(data.bulkSelection.total, expected); if (snapshot) assert.equal(data.bulkSelection.snapshotAt, snapshot); else snapshot = data.bulkSelection.snapshotAt;
        for (const row of data[key]) { assert.ok(!seen.has(row.id)); seen.add(row.id); assert.equal(row.organizationId, org); count++; }
        cursor = data.bulkSelection.nextCursor;
        if (!target.searchParams.has("cursor") && cursor) {
          const crossed = new URL(target); crossed.searchParams.set("cursor", cursor);
          assert.equal((await call(crossed.pathname + crossed.search, other)).status, 409);
          crossed.searchParams.set("q", "changed"); assert.equal((await call(crossed.pathname + crossed.search)).status, 409);
          if (key === "clients") await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Alta posterior al seleccionar todos", createdAt: new Date(Date.now() + 10_000) } });
        }
      } while (cursor);
      assert.equal(count, expected, path);
    }
    const selected = clientIds[1];
    assert.equal((await call(`/api/admin/clients/${selected}/trash`, owner, { reason: "QA" })).status, 409, "activo no se elimina ni archiva por detrás");
    assert.equal((await call(`/api/admin/clients/${selected}/archive`, owner, { reason: "QA" })).status, 200);
    assert.equal((await call(`/api/admin/clients/${selected}/trash`, owner, { reason: "QA" })).status, 200);
    assert.equal((await call(`/api/admin/clients/${selected}/restore`, operations, { reason: "QA" })).status, 403);
    assert.equal((await call(`/api/admin/clients/${selected}/restore`, owner, { reason: "QA" })).status, 200);
    const { getRentalSettings } = await import("../lib/server/rental-settings");
    assert.equal((await getRentalSettings(org)).trashPurgeDays, null);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, foreignOrg] } } }); await db.adminUser.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
