import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.INVENTORY_AUDIT_BASE_URL;
const localDatabase = Boolean(databaseUrl && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(databaseUrl));
const localServer = Boolean(baseUrl && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl));

test("#179 reparaciones: aislamiento por empresa, transición inválida y RETIRED preservado (PostgreSQL + API)", { skip: !localDatabase || !localServer }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { db } = await import("../lib/server/db");
  const { createIncident } = await import("../lib/server/inventory-operations");
  const { syncInventoryQuantity } = await import("../lib/server/inventory-units");
  const { createSession } = await import("../lib/server/auth");

  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  try {
    await db.organization.createMany({ data: [organizationId, otherOrganizationId].map((id) => ({ id, slug: `repair-qa-${id}`, name: "Reparaciones QA" })) });
    const user = await db.adminUser.create({ data: { id: userId, email: `${userId}@example.invalid`, name: "QA reparaciones", role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.createMany({ data: [organizationId, otherOrganizationId].map((id) => ({ id: randomUUID(), adminUserId: userId, organizationId: id, role: "OWNER" as const })) });
    const cookie = `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
    const otherCookie = `ledbox_session=${(await createSession(user, otherOrganizationId)).jwt}`;
    const call = (body: unknown) => fetch(`${baseUrl}/api/admin/inventory/incidents`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Repuesto QA", category: "QA", quantity: 1 } });
    const unit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: item.id, code: `REP-${randomUUID()}` } });
    const created = await createIncident({ organizationId, inventoryId: item.id, unitId: unit.id, kind: "REPAIR", quantity: 1 });
    assert.ok(created.ok, JSON.stringify(created));

    const foreignAttempt = await call({ kind: "transition", id: created.incident.id, to: "RESOLVED" });
    assert.equal(foreignAttempt.status, 404, "otra empresa no puede ver ni modificar la reparación");
    assert.equal((await db.inventoryIncident.findUniqueOrThrow({ where: { id: created.incident.id } })).status, "OPEN");

    const invalid = await call({ kind: "transition", id: created.incident.id, to: "REOPENED" });
    assert.equal(invalid.status, 400, "el endpoint rechaza destinos que no forman parte de las transiciones");
    assert.equal((await db.inventoryIncident.findUniqueOrThrow({ where: { id: created.incident.id } })).status, "OPEN");

    await db.$transaction(async (tx) => {
      await tx.inventoryUnit.update({ where: { id: unit.id }, data: { status: "RETIRED" } });
      await syncInventoryQuantity(tx, item.id);
    });
    const resolved = await call({ kind: "transition", id: created.incident.id, to: "RESOLVED" });
    assert.equal(resolved.status, 200);
    assert.equal((await db.inventoryIncident.findUniqueOrThrow({ where: { id: created.incident.id } })).status, "RESOLVED");
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).status, "RETIRED", "resolver una reparación no devuelve a disponibilidad una unidad retirada");
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 0);

    const traceItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Equipo dañado QA", category: "QA", quantity: 1 } });
    const traceUnit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: traceItem.id, code: `DAN-${randomUUID()}` } });
    const damage = await call({ kind: "create", inventoryId: traceItem.id, incidentKind: "DAMAGE", unitId: traceUnit.id, notes: "Golpe registrado en QA" });
    assert.equal(damage.status, 201);
    const damageIncident = (await damage.json() as { incident: { id: string; unitCycle: number } }).incident;
    assert.ok(damageIncident.unitCycle > 0);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: traceUnit.id } })).status, "DAMAGED");

    const otherHistory = await fetch(`${baseUrl}/api/admin/inventory/incidents?unitId=${traceUnit.id}`, { headers: { Cookie: otherCookie } });
    assert.equal(otherHistory.status, 200);
    assert.deepEqual((await otherHistory.json() as { incidents: unknown[] }).incidents, [], "el historial de una unidad no se filtra entre empresas");
    const ownHistory = await fetch(`${baseUrl}/api/admin/inventory/incidents?unitId=${traceUnit.id}`, { headers: { Cookie: cookie } });
    assert.equal(ownHistory.status, 200);
    const listed = (await ownHistory.json() as { incidents: Array<{ id: string; unit: { id: string; code: string }; unitCycle: number }> }).incidents;
    assert.equal(listed.length, 1);
    assert.deepEqual([listed[0].id, listed[0].unit.id, listed[0].unit.code, listed[0].unitCycle], [damageIncident.id, traceUnit.id, traceUnit.code, damageIncident.unitCycle]);

    const repair = await call({ kind: "transition", id: damageIncident.id, to: "IN_REPAIR", notes: "Reparación iniciada en QA" });
    assert.equal(repair.status, 200);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: traceUnit.id } })).status, "DAMAGED", "entrar a reparación conserva la unidad fuera de circulación");
    const returnedToUse = await call({ kind: "transition", id: damageIncident.id, to: "RESOLVED", notes: "Reparación finalizada en QA" });
    assert.equal(returnedToUse.status, 200);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: traceUnit.id } })).status, "AVAILABLE");
    const trace = await db.inventoryIncident.findMany({ where: { organizationId, unitId: traceUnit.id }, orderBy: { openedAt: "asc" } });
    assert.equal(trace.length, 1, "el daño y su reparación continúan como una sola causa trazable");
    assert.deepEqual([trace[0].kind, trace[0].unitCycle, trace[0].status], ["DAMAGE", damageIncident.unitCycle, "RESOLVED"]);

    const completeTrace = async (unitId: string, sessionCookie: string) => fetch(`${baseUrl}/api/admin/inventory/incidents?unitTrace=${encodeURIComponent(unitId)}`, { headers: { Cookie: sessionCookie } });
    const availableTrace = await completeTrace(traceUnit.id, cookie);
    assert.equal(availableTrace.status, 200);
    const availableHistory = await availableTrace.json() as { unit: { code: string; status: string }; history: Array<{ incidentId: string; action: string; detail: { changes?: { status?: { to?: string } } } | null }> };
    assert.deepEqual([availableHistory.unit.code, availableHistory.unit.status], [traceUnit.code, "AVAILABLE"]);
    assert.deepEqual(availableHistory.history.map((entry) => entry.action), ["create", "status", "status"]);
    assert.deepEqual(availableHistory.history.slice(1).map((entry) => entry.detail?.changes?.status?.to), ["IN_REPAIR", "RESOLVED"]);
    assert.equal((await completeTrace(traceUnit.id, otherCookie)).status, 404, "la lectura detallada no revela unidades de otra empresa");

    const retiredItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Equipo retirado QA", category: "QA", quantity: 1 } });
    const retiredUnit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: retiredItem.id, code: `RET-${randomUUID()}` } });
    const retiredDamage = await call({ kind: "create", inventoryId: retiredItem.id, incidentKind: "DAMAGE", unitId: retiredUnit.id, notes: "Daño QA para baja" });
    assert.equal(retiredDamage.status, 201);
    const retiredIncident = (await retiredDamage.json() as { incident: { id: string } }).incident;
    assert.equal((await call({ kind: "transition", id: retiredIncident.id, to: "IN_REPAIR" })).status, 200);
    assert.equal((await call({ kind: "transition", id: retiredIncident.id, to: "WRITTEN_OFF", notes: "No recuperable en QA" })).status, 200);
    const retiredResult = await completeTrace(retiredUnit.id, cookie);
    const retiredHistory = await retiredResult.json() as { unit: { status: string }; incidents: Array<{ kind: string; status: string }>; history: Array<{ detail: { changes?: { status?: { to?: string } } } | null }> };
    assert.equal(retiredResult.status, 200);
    assert.equal(retiredHistory.unit.status, "RETIRED");
    assert.deepEqual(retiredHistory.incidents.map((incident) => [incident.kind, incident.status]), [["DAMAGE", "WRITTEN_OFF"]]);
    assert.deepEqual(retiredHistory.history.slice(1).map((entry) => entry.detail?.changes?.status?.to), ["IN_REPAIR", "WRITTEN_OFF"]);

    const lostItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Equipo perdido QA", category: "QA", quantity: 1 } });
    const lostUnit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: lostItem.id, code: `PER-${randomUUID()}` } });
    const missing = await call({ kind: "create", inventoryId: lostItem.id, incidentKind: "MISSING", unitId: lostUnit.id, notes: "Faltante QA" });
    assert.equal(missing.status, 201);
    const missingIncident = (await missing.json() as { incident: { id: string } }).incident;
    assert.equal((await call({ kind: "transition", id: missingIncident.id, to: "WRITTEN_OFF", notes: "Pérdida confirmada en QA" })).status, 200);
    const lostResult = await completeTrace(lostUnit.id, cookie);
    const lostHistory = await lostResult.json() as { unit: { status: string }; incidents: Array<{ kind: string; status: string }>; history: Array<{ detail: { changes?: { status?: { to?: string } } } | null }> };
    assert.equal(lostResult.status, 200);
    assert.equal(lostHistory.unit.status, "LOST");
    assert.deepEqual(lostHistory.incidents.map((incident) => [incident.kind, incident.status]), [["MISSING", "WRITTEN_OFF"]]);
    assert.deepEqual(lostHistory.history.slice(1).map((entry) => entry.detail?.changes?.status?.to), ["WRITTEN_OFF"]);
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await db.inventoryIncident.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await db.inventoryUnit.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await db.inventoryItem.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await db.adminMembership.deleteMany({ where: { organizationId } });
    await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
