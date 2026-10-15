import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
    await t.test("un nuevo faltante resuelto vuelve a disponible tras una baja histórica restaurada", async () => {
      const s = await seed(), a = await s.open("MISSING");
      await close(a.id, "WRITTEN_OFF");
      await db.inventoryUnit.update({ where: { id: s.unit.id }, data: { status: "AVAILABLE" } });
      const b = await s.open("MISSING"); await close(b.id, "RESOLVED");
      assert.equal(await s.status(), "AVAILABLE"); assert.equal(await s.free(), 1);
    });
    await t.test("ciclos separan bajas y faltantes nuevos aunque todas sus fechas coincidan", async () => {
      const s = await seed(), a = await s.open("MISSING"); await close(a.id, "WRITTEN_OFF");
      await db.inventoryUnit.update({ where: { id: s.unit.id }, data: { status: "AVAILABLE" } });
      const b = await s.open("MISSING");
      const same = new Date("2030-01-01T00:00:00.000Z");
      await db.inventoryIncident.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { openedAt: same, resolvedAt: same } });
      assert.notEqual(a.unitCycle, b.unitCycle);
      await close(b.id, "RESOLVED"); assert.equal(await s.status(), "AVAILABLE");
    });
    await t.test("restauración anterior al deploy con ciclo0 no hereda bajas históricas; legacy abierto es conservador", async () => {
      const s = await seed();
      await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: org, inventoryId: s.item.id, unitId: s.unit.id, kind: "MISSING", quantity: 1, status: "WRITTEN_OFF", unitCycle: 0 } });
      const next = await s.open("MISSING"); assert.ok(next.unitCycle > 0);
      await close(next.id, "RESOLVED"); assert.equal(await s.status(), "AVAILABLE");
      const legacy = await seed();
      await db.inventoryUnit.update({ where: { id: legacy.unit.id }, data: { status: "LOST" } });
      await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: org, inventoryId: legacy.item.id, unitId: legacy.unit.id, kind: "MISSING", quantity: 1, status: "WRITTEN_OFF" } });
      const old = await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: org, inventoryId: legacy.item.id, unitId: legacy.unit.id, kind: "REPAIR", quantity: 1 } });
      await close(old.id, "RESOLVED"); assert.equal(await legacy.status(), "LOST"); assert.equal(await legacy.free(), 0);
    });
    await t.test("devoluciones guardan el ciclo de la unidad en el faltante", async () => {
      const s = await seed();
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente QA" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Evento QA", startsAt: new Date("2035-02-01"), endsAt: new Date("2035-02-02") } });
      const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
      const { dispatchAssignment, returnAssignment } = await import("../lib/server/inventory-operations");
      const assigned = await commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId: s.item.id, quantity: 1, startsAt: new Date("2035-02-01"), endsAt: new Date("2035-02-02") });
      assert.ok(assigned.ok);
      assert.ok((await dispatchAssignment({ organizationId: org, assignmentId: assigned.assignment.id, at: new Date("2035-02-01"), condition: "Bueno" })).ok);
      const returned = await returnAssignment({ organizationId: org, assignmentId: assigned.assignment.id, at: new Date("2035-02-02"), condition: "Faltante", quantity: 0, missing: 1, missingUnitIds: [s.unit.id] });
      assert.ok(returned.ok); assert.ok(returned.incidents[0].unitCycle > 0);
      assert.equal(returned.incidents[0].unitCycle, (await db.inventoryUnit.findUniqueOrThrow({ where: { id: s.unit.id } })).incidentCycle);
    });
    await t.test("importador restaura y crea un faltante nuevo en otro ciclo", async () => {
      const { applyCatalog } = await import("../lib/server/import-catalog");
      const { normalizeCatalog } = await import("../lib/import-catalog");
      const { portalAuditContext } = await import("../lib/server/audit");
      const run = async (perdidas: number) => {
        const parsed = normalizeCatalog({ moneda: "PYG", productos: [{ codigo: "CICLO-IMPORT", nombre: "Silla ciclo QA", tipo: "unidad", precio: 10000, cantidad: 1, perdidas }] });
        assert.ok(parsed.ok);
        const result = await applyCatalog(portalAuditContext(org, "QA"), { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [], lote: randomUUID() });
        assert.deepEqual(result.fallidos, []);
      };
      await run(1);
      const item = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku: "CICLO-IMPORT" } });
      const first = await db.inventoryIncident.findFirstOrThrow({ where: { inventoryId: item.id, status: "OPEN" } });
      assert.ok(first.unitCycle > 0); await close(first.id, "WRITTEN_OFF");
      await run(0); await run(1);
      const next = await db.inventoryIncident.findFirstOrThrow({ where: { inventoryId: item.id, status: "OPEN" } });
      assert.ok(next.unitCycle > first.unitCycle); await close(next.id, "RESOLVED");
      assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: next.unitId! } })).status, "AVAILABLE");
    });
    await t.test("migración aditiva reejecutable conserva ciclos y estados", async () => {
      const before = await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true, status: true, incidentCycle: true } });
      const migration = new URL("../prisma/migrations/202611020001_inventory_incident_cycles/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url!, "-v", "ON_ERROR_STOP=1", "-q", "-f", migration], { stdio: "pipe" });
      assert.deepEqual(await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true, status: true, incidentCycle: true } }), before);
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
    await db.eventInventory.deleteMany({ where: { event: { organizationId: org } } });
    await db.deliveryNote.deleteMany({ where: { organizationId: org } });
    await db.event.deleteMany({ where: { organizationId: org } });
    await db.client.deleteMany({ where: { organizationId: org } });
    await db.inventoryUnit.deleteMany({ where: { organizationId: { in: [org, otherOrg] } } });
    await db.inventoryItem.deleteMany({ where: { organizationId: { in: [org, otherOrg] } } });
    await db.adminMembership.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
