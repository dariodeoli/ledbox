import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const url = process.env.TEST_DATABASE_URL;
const local = Boolean(url && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(url));

test("incidentes: resolver no revierte bajas y la edición de unidades no libera reparaciones abiertas", { skip: !local }, async (t) => {
  process.env.DATABASE_URL = url;
  const { db } = await import("../lib/server/db");
  const { createIncident, transitionIncident } = await import("../lib/server/inventory-operations");
  const { availabilityForRange, maintenanceUnits, MAINTENANCE_UNITS_SELECT } = await import("../lib/server/inventory-availability");
  const { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), otherOrg = randomUUID(), userId = randomUUID();
  const seed = async (organizationId = org) => {
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Unidad QA ficticia", category: "QA", quantity: 1 } });
    const unit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: item.id, code: randomUUID() } });
    const open = async (kind: "REPAIR" | "CLEANING" | "MISSING") => {
      const result = await createIncident({ organizationId, inventoryId: item.id, unitId: unit.id, kind, quantity: 1 });
      assert.ok(result.ok, JSON.stringify(result));
      return result.incident;
    };
    const status = async () => (await db.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).status;
    const free = async () => {
      const row = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: { _count: { select: MAINTENANCE_UNITS_SELECT } } });
      return (await availabilityForRange({ organizationId, item: { ...row, maintenance: maintenanceUnits(row) }, startsAt: new Date("2035-01-01"), endsAt: new Date("2035-01-02") })).available;
    };
    return { item, unit, open, status, free };
  };
  const close = async (incidentId: string, to: "WRITTEN_OFF" | "RESOLVED", organizationId = org) => {
    const result = await transitionIncident({ organizationId, incidentId, to });
    assert.ok(result.ok, JSON.stringify(result));
  };
  try {
    await db.organization.createMany({ data: [org, otherOrg].map(id => ({ id, slug: `incident-unit-${id}`, name: "QA ficticio" })) });
    for (const order of ["baja primero", "resolución primero", "concurrente"] as const) {
      await t.test(`${order}: otra reparación resuelta nunca resucita una unidad dada de baja`, async () => {
        const s = await seed(), a = await s.open("REPAIR"), b = await s.open("CLEANING");
        if (order === "baja primero") { await close(a.id, "WRITTEN_OFF"); await close(b.id, "RESOLVED"); }
        else if (order === "resolución primero") { await close(b.id, "RESOLVED"); await close(a.id, "WRITTEN_OFF"); }
        else await Promise.all([close(a.id, "WRITTEN_OFF"), close(b.id, "RESOLVED")]);
        assert.equal(await s.status(), "RETIRED");
        assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: s.item.id } })).quantity, 0);
        assert.equal(await s.free(), 0);
      });
    }
    await t.test("un faltante dado de baja conserva LOST al resolver otra reparación", async () => {
      const s = await seed(), a = await s.open("REPAIR"), b = await s.open("MISSING");
      await close(b.id, "WRITTEN_OFF"); await close(a.id, "RESOLVED");
      assert.equal(await s.status(), "LOST"); assert.equal(await s.free(), 0);
    });
    await t.test("un retiro manual no se revierte al cerrar una reparación", async () => {
      const s = await seed(), a = await s.open("REPAIR");
      const { syncInventoryQuantity } = await import("../lib/server/inventory-units");
      await db.$transaction(async tx => { await tx.inventoryUnit.update({ where: { id: s.unit.id }, data: { status: "RETIRED" } }); await syncInventoryQuantity(tx, s.item.id); });
      await close(a.id, "RESOLVED");
      assert.equal(await s.status(), "RETIRED"); assert.equal(await s.free(), 0);
    });
    await t.test("resolver un faltante normal sí recupera la unidad", async () => {
      const s = await seed(), a = await s.open("MISSING");
      await close(a.id, "RESOLVED");
      assert.equal(await s.status(), "AVAILABLE"); assert.equal(await s.free(), 1);
    });
    await t.test("una baja histórica no bloquea reparaciones nuevas tras restaurar explícitamente", async () => {
      const s = await seed(), a = await s.open("MISSING");
      await close(a.id, "WRITTEN_OFF");
      await db.inventoryUnit.update({ where: { id: s.unit.id }, data: { status: "AVAILABLE" } });
      const b = await s.open("REPAIR"); await close(b.id, "RESOLVED");
      assert.equal(await s.status(), "AVAILABLE"); assert.equal(await s.free(), 1);
    });
    const base = process.env.INVENTORY_AUDIT_BASE_URL;
    const localHttp = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));
    await t.test("HTTP individual y lote: 409 atómico con incidentes abiertos; restaura explícitamente sin abiertos", { skip: !localHttp }, async () => {
      const user = await db.adminUser.create({ data: { id: userId, email: `${userId}@example.invalid`, name: "QA", role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
      await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId: org, role: "OWNER" } });
      const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
      const call = (body: unknown) => fetch(`${base}/api/admin/inventory`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const s = await seed(), clean = await seed(), foreign = await seed(otherOrg), a = await s.open("REPAIR");
      assert.equal((await call({ kind: "unit-update", id: s.unit.id, status: "AVAILABLE", notes: "No debe guardarse" })).status, 409);
      assert.equal(await s.status(), "MAINTENANCE"); assert.equal(await s.free(), 0);
      assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: s.unit.id } })).notes, null);
      assert.equal((await call({ kind: "bulk-units", ids: [s.unit.id, clean.unit.id], changes: { status: "AVAILABLE", notes: "No debe guardarse" } })).status, 409);
      for (const id of [s.unit.id, clean.unit.id]) assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id } })).notes, null);
      assert.equal((await call({ kind: "unit-update", id: foreign.unit.id, status: "AVAILABLE" })).status, 404);
      assert.equal((await call({ kind: "bulk-units", ids: [clean.unit.id, foreign.unit.id], changes: { notes: "No" } })).status, 404);
      assert.equal((await call({ kind: "unit-update", id: s.unit.id, status: "RETIRED" })).status, 200);
      await close(a.id, "RESOLVED"); assert.equal(await s.status(), "RETIRED");
      assert.equal((await call({ kind: "unit-update", id: s.unit.id, status: "AVAILABLE" })).status, 200);
      assert.equal(await s.free(), 1);
      const again = await s.open("CLEANING");
      await close(again.id, "RESOLVED");
      assert.equal((await call({ kind: "bulk-units", ids: [s.unit.id, clean.unit.id], changes: { status: "AVAILABLE", notes: "Guardado" } })).status, 200);
      for (let round = 0; round < 5; round++) {
        const racing = await seed();
        const [updated, opened] = await Promise.all([
          call({ kind: "unit-update", id: racing.unit.id, status: "AVAILABLE" }),
          createIncident({ organizationId: org, inventoryId: racing.item.id, unitId: racing.unit.id, kind: "REPAIR", quantity: 1 }),
        ]);
        assert.ok([200, 409].includes(updated.status)); assert.ok(opened.ok);
        assert.equal(await racing.status(), "MAINTENANCE"); assert.equal(await racing.free(), 0);
      }
    });
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: { in: [org, otherOrg] } } });
    await db.inventoryIncident.deleteMany({ where: { organizationId: { in: [org, otherOrg] } } });
    await db.inventoryUnit.deleteMany({ where: { organizationId: { in: [org, otherOrg] } } });
    await db.inventoryItem.deleteMany({ where: { organizationId: { in: [org, otherOrg] } } });
    await db.adminMembership.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
