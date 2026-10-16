import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { applyInventoryFilters, EMPTY_GRID_FILTERS } from "../lib/inventory-grid-view";
import type { AdminInventoryGridRow } from "../lib/admin-types";

// Sólo contra servidor del mismo checkout y PG local descartable schema79.
test("278 HTTP:50fichas sinstock cambian defaults; unidades, reservas, precios y otrotenant se conservan", { skip: !process.env.TEST_DATABASE_URL || !process.env.DEPOSITOS278_BASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!), base = new URL(process.env.DEPOSITOS278_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.ok(["localhost", "127.0.0.1"].includes(base.hostname)); process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db"), { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), otherOrg = randomUUID(), users: string[] = [];
  async function cookie(role: "OWNER" | "VIEWER") {
    const id = randomUUID(); users.push(id); const user = await db.adminUser.create({ data: { id, name: "QA278", email: `${id}@example.invalid`, role: "OWNER", passwordHash: "no-login" } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: id, organizationId: org, role } }); return `ledbox_session=${(await createSession(user, org)).jwt}`;
  }
  try {
    await db.organization.createMany({ data: [{ id: org, name: "QA278", slug: `qa278-${org}` }, { id: otherOrg, name: "QA278 ajena", slug: `qa278-${otherOrg}` }] });
    const d1 = randomUUID(), d2 = randomUUID(), d3 = randomUUID(), foreignDepot = randomUUID();
    await db.warehouse.createMany({ data: [{ id: d1, organizationId: org, code: "D1", name: "Físico" }, { id: d2, organizationId: org, code: "D2", name: "Catálogo" }, { id: d3, organizationId: org, code: "D3", name: "Nuevo previsto" }, { id: foreignDepot, organizationId: otherOrg, code: "D3", name: "Ajeno" }] });
    const ids = Array.from({ length: 50 }, () => randomUUID());
    await db.inventoryItem.createMany({ data: ids.map((id, n) => ({ id, organizationId: org, name: `Ficha${n}`, category: "QA", quantity: 0, stockCountStatus: "PENDING_COUNT", defaultWarehouseId: d2, defaultLocation: "A1", listPrice: 1000, wholesalePrice: 900 })) });
    const physical = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Con unidades", category: "QA", quantity: 3, defaultWarehouseId: d2 } });
    await db.inventoryUnit.createMany({ data: Array.from({ length: 3 }, (_, n) => ({ id: randomUUID(), organizationId: org, inventoryId: physical.id, code: `U${n}`, status: "AVAILABLE", warehouseId: d1, location: "B1" })) });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Reserva preservada" } });
    await db.eventInventory.create({ data: { id: randomUUID(), organizationId: org, eventId: event.id, inventoryId: physical.id, quantity: 1 } });
    const foreign = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: otherOrg, name: "Ajeno", category: "QA" } });
    const owner = await cookie("OWNER"), viewer = await cookie("VIEWER");
    const call = (changes: unknown, selected: string[] = ids, session = owner) => fetch(`${base.origin}/api/admin/inventory`, { method: "POST", headers: { Cookie: session, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "bulk-items", ids: selected, changes }) });
    const beforeUnits = await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }), beforeReserve = await db.eventInventory.findMany({ where: { eventId: event.id } });
    assert.equal(beforeReserve.length, 1);
    const beforeItems = await db.inventoryItem.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    const response = await call({ defaultWarehouseId: d3, defaultLocation: "C2" }); assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).updated, 50);
    const afterItems = await db.inventoryItem.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    for (let n = 0; n < afterItems.length; n++) { const { defaultWarehouseId, defaultLocation, updatedAt, ...after } = afterItems[n]; const { defaultWarehouseId: _d, defaultLocation: _l, updatedAt: _u, ...before } = beforeItems[n]; assert.equal(defaultWarehouseId, d3); assert.equal(defaultLocation, "C2"); assert.deepEqual(after, before); }
    assert.equal(await db.inventoryUnit.count({ where: { inventoryId: { in: ids } } }), 0);
    assert.deepEqual(await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }), beforeUnits);
    assert.deepEqual(await db.eventInventory.findMany({ where: { eventId: event.id } }), beforeReserve);
    const gridResponse = await fetch(`${base.origin}/api/admin/inventory?fields=grid&limit=100`, { headers: { Cookie: owner } }); assert.equal(gridResponse.status, 200); const grid: AdminInventoryGridRow[] = (await gridResponse.json()).inventory;
    const ctx = { openIncidentIds: new Set<string>(), unitMatchIds: new Set<string>(), categoryTree: [], now: new Date() };
    assert.equal(applyInventoryFilters(grid, { ...EMPTY_GRID_FILTERS, defaultWarehouseId: d3 }, ctx).length, 50);
    assert.deepEqual(applyInventoryFilters(grid, { ...EMPTY_GRID_FILTERS, defaultWarehouseId: d2, warehouseId: d1 }, ctx).map(row => row.id), [physical.id]);
    assert.equal((await call({ defaultWarehouseId: d3, defaultLocation: "C3" }, [physical.id])).status, 200);
    assert.deepEqual(await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }), beforeUnits, "cambiar defaults de ficha con unidades tampoco las traslada");
    assert.deepEqual(await db.eventInventory.findMany({ where: { eventId: event.id } }), beforeReserve);
    assert.equal((await call({ defaultWarehouseId: foreignDepot })).status, 404);
    assert.equal((await call({ defaultWarehouseId: d2 }, [ids[0], foreign.id])).status, 404);
    assert.equal((await call({ defaultLocation: "D4" }, ids, viewer)).status, 403);
    assert.deepEqual(await db.inventoryItem.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }), afterItems);
    assert.equal((await call({ defaultLocation: null })).status, 200);
    assert.equal(await db.inventoryItem.count({ where: { id: { in: ids }, defaultWarehouseId: d3, defaultLocation: null } }), 50);
  } finally { await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } }); await db.adminUser.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); }
});
