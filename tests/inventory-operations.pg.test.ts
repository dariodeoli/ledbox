import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/inventory-operations.pg.test.ts
test("operaciones de alquiler en PostgreSQL: salida y devolución parcial, incidentes, cierre y concurrencia", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { commitInventoryAssignment, availabilityForRange, maintenanceUnits, MAINTENANCE_UNITS_SELECT } = await import("../lib/server/inventory-availability");
  const ops = await import("../lib/server/inventory-operations");

  const day = (n: number, hour = 12) => new Date(Date.UTC(2032, 0, n, hour));
  async function seed(options: { quantity?: number; units?: boolean } = {}) {
    const quantity = options.quantity ?? 10;
    const org = randomUUID();
    await db.organization.create({ data: { id: org, name: "Operaciones QA", slug: `ops-qa-${org}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla", category: "Mobiliario", quantity } });
    const unitIds: string[] = [];
    if (options.units) {
      for (let i = 1; i <= quantity; i++) {
        const unit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: item.id, code: `SIL-${String(i).padStart(2, "0")}` } });
        unitIds.push(unit.id);
      }
    }
    const event = await db.event.create({
      data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda", setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13) },
    });
    const assign = async (qty: number) => {
      const result = await commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId: item.id, quantity: qty, startsAt: day(10), endsAt: day(13) });
      assert.ok(result.ok, JSON.stringify(result));
      return result.assignment;
    };
    // Disponibilidad en una ventana lejana: aísla lo que retienen los incidentes.
    const free = async () => {
      const row = await db.inventoryItem.findFirstOrThrow({ where: { id: item.id }, include: { _count: { select: MAINTENANCE_UNITS_SELECT } } });
      return (await availabilityForRange({ organizationId: org, item: { ...row, maintenance: maintenanceUnits(row) }, startsAt: day(20), endsAt: day(21) })).available;
    };
    return { org, client, item, unitIds, event, assign, free };
  }
  const at = day(11);
  const dispatch = (org: string, assignmentId: string, quantity?: number) =>
    ops.dispatchAssignment({ organizationId: org, assignmentId, ...(quantity ? { quantity } : {}), at, condition: "Bueno", note: "Retira Juan", actorId: "u1" });
  const giveBack = (org: string, assignmentId: string, extra: Partial<Parameters<typeof ops.returnAssignment>[0]> = {}) =>
    ops.returnAssignment({ organizationId: org, assignmentId, at: day(13), condition: "Bueno", actorId: "u1", ...extra });

  await t.test("la migración de incidentes aplicada dos veces no falla", () => {
    const file = new URL("../prisma/migrations/202610150001_inventory_incidents/migration.sql", import.meta.url).pathname;
    for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
  });

  await t.test("devolver 7 de 10 deja 3 pendientes y no libera el equipo; el resto cierra la devolución", async () => {
    const { org, assign, event } = await seed();
    const a = await assign(10);
    const out = await dispatch(org, a.id);
    assert.ok(out.ok);
    assert.equal(out.assignment.checkoutQuantity, 10);
    assert.equal(out.assignment.checkedOutById, "u1");
    assert.equal(out.assignment.checkoutNote, "Retira Juan");
    const first = await giveBack(org, a.id, { quantity: 7 });
    assert.ok(first.ok);
    assert.equal(first.pending, 3);
    assert.equal(first.closed, false);
    assert.equal(first.assignment.returnedQuantity, 7);
    assert.equal(first.assignment.checkedIn, false);
    assert.equal(first.assignment.checkedInAt, null);
    assert.equal(ops.pendingReturnQuantity(first.assignment), 3);
    const closure = await ops.eventClosureBlockers(org, event.id);
    assert.deepEqual(closure.pendingReturns.map((r) => r.pending), [3]);
    assert.match(ops.closureBlockMessage(closure)!, /faltan devolver 3 de «Silla»/);
    const over = await giveBack(org, a.id, { quantity: 4 });
    assert.ok(!over.ok && over.status === 409);
    const rest = await giveBack(org, a.id, { quantity: 3 });
    assert.ok(rest.ok && rest.closed && rest.pending === 0);
    assert.equal(ops.closureBlockMessage(await ops.eventClosureBlockers(org, event.id)), null);
  });

  await t.test("salida parcial: 6 y luego 4; no se puede despachar de más ni devolver sin salida", async () => {
    const { org, assign } = await seed();
    const a = await assign(10);
    const early = await giveBack(org, a.id, { quantity: 1 });
    assert.ok(!early.ok && early.status === 409);
    assert.ok((await dispatch(org, a.id, 6)).ok);
    const tooMany = await dispatch(org, a.id, 5);
    assert.ok(!tooMany.ok && tooMany.status === 409);
    assert.ok((await dispatch(org, a.id, 4)).ok);
    assert.equal((await db.eventInventory.findUniqueOrThrow({ where: { id: a.id } })).checkoutQuantity, 10);
    const done = await dispatch(org, a.id, 1);
    assert.ok(!done.ok && done.status === 409);
  });

  await t.test("un faltante crea el incidente y la unidad queda LOST, fuera del stock", async () => {
    const { org, assign, unitIds, item, free } = await seed({ units: true });
    const a = await assign(10);
    await dispatch(org, a.id);
    const wrongCount = await giveBack(org, a.id, { quantity: 8, missing: 2, missingUnitIds: [unitIds[3]] });
    assert.ok(!wrongCount.ok && wrongCount.status === 400, "con unidades, si se eligen códigos tienen que ser todos");
    const result = await giveBack(org, a.id, { quantity: 9, missing: 1, missingUnitIds: [unitIds[3]] });
    assert.ok(result.ok && result.closed);
    assert.equal(result.incidents.length, 1);
    assert.equal(result.incidents[0].kind, "MISSING");
    assert.equal(result.incidents[0].unitId, unitIds[3]);
    assert.equal(result.incidents[0].assignmentId, a.id);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitIds[3] } })).status, "LOST");
    assert.equal(await free(), 9);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 10, "perdida pero no retirada");
  });

  await t.test("contrato viejo: daño y faltante sin códigos en un ítem con unidades se retienen por cantidad", async () => {
    const { org, assign, item, free } = await seed({ units: true });
    const a = await assign(10);
    await dispatch(org, a.id);
    const result = await giveBack(org, a.id, { quantity: 8, damaged: 1, missing: 2 });
    assert.ok(result.ok && result.closed, JSON.stringify(result));
    assert.equal(result.incidents.length, 2);
    for (const incident of result.incidents) {
      assert.equal(incident.unitId, null);
      assert.equal(incident.heldByQuantity, true);
      assert.match(incident.notes ?? "", /Unidad sin identificar/);
    }
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, 3);
    assert.equal(await free(), 7);
    for (const incident of result.incidents) {
      assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: incident.id, to: "RESOLVED" })).ok);
    }
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, 0);
    assert.equal(await free(), 10);
  });

  await t.test("un incidente con unidad que pierde su unitId (FK SET NULL) no desbalancea incidentHold", async () => {
    const { org, assign, item, unitIds, client } = await seed({ units: true });
    const a = await assign(4);
    await dispatch(org, a.id);
    const byQty = await giveBack(org, a.id, { quantity: 3, damaged: 1 });
    assert.ok(byQty.ok);
    const other = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Otro", setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13) } });
    const b = await db.eventInventory.create({ data: { id: randomUUID(), eventId: other.id, inventoryId: item.id, quantity: 1, checkedOut: true, checkedOutAt: at, checkoutQuantity: 1 } });
    const withUnit = await giveBack(org, b.id, { quantity: 0, missing: 1, missingUnitIds: [unitIds[5]] });
    assert.ok(withUnit.ok);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, 1);
    // La unidad se borra: el incidente queda con unitId NULL pero NO se retuvo por cantidad.
    await db.inventoryUnit.delete({ where: { id: unitIds[5] } });
    const orphan = await db.inventoryIncident.findUniqueOrThrow({ where: { id: withUnit.incidents[0].id } });
    assert.equal(orphan.unitId, null);
    assert.equal(orphan.heldByQuantity, false);
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: orphan.id, to: "RESOLVED" })).ok);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, 1, "el incidente con unidad no baja el contador");
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: byQty.incidents[0].id, to: "RESOLVED" })).ok);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, 0);
  });

  await t.test("un daño por cantidad descuenta mientras esté abierto y vuelve al resolverse", async () => {
    const { org, assign, item, free } = await seed();
    const a = await assign(3);
    await dispatch(org, a.id);
    const result = await giveBack(org, a.id, { damaged: 2 });
    assert.ok(result.ok && result.closed);
    assert.equal(result.incidents[0].kind, "DAMAGE");
    assert.equal(result.incidents[0].quantity, 2);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, 2);
    assert.equal(await free(), 8);
    const repair = await ops.transitionIncident({ organizationId: org, incidentId: result.incidents[0].id, to: "IN_REPAIR", cost: 150_000 });
    assert.ok(repair.ok);
    assert.equal(await free(), 8, "en reparación sigue descontando");
    const resolved = await ops.transitionIncident({ organizationId: org, incidentId: result.incidents[0].id, to: "RESOLVED", cost: 180_000 });
    assert.ok(resolved.ok);
    assert.equal(resolved.incident.cost, 180_000);
    assert.ok(resolved.incident.resolvedAt);
    assert.equal(await free(), 10);
    const again = await ops.transitionIncident({ organizationId: org, incidentId: result.incidents[0].id, to: "WRITTEN_OFF" });
    assert.ok(!again.ok && again.status === 409, "un incidente cerrado no admite cambios");
  });

  await t.test("una reparación resuelta devuelve la unidad y WRITTEN_OFF no la devuelve", async () => {
    const { org, assign, unitIds, item, free } = await seed({ units: true });
    const a = await assign(10);
    await dispatch(org, a.id);
    const back = await giveBack(org, a.id, { quantity: 10, damaged: 2, damagedUnitIds: [unitIds[0], unitIds[1]] });
    assert.ok(back.ok);
    assert.equal(await free(), 8);
    const [repaired, writtenOff] = back.incidents;
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: repaired.id, to: "IN_REPAIR", cost: 90_000 })).ok);
    assert.equal(await free(), 8);
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: repaired.id, to: "RESOLVED" })).ok);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitIds[0] } })).status, "AVAILABLE");
    assert.equal(await free(), 9);
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: writtenOff.id, to: "WRITTEN_OFF", cost: 400_000 })).ok);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitIds[1] } })).status, "RETIRED");
    assert.equal(await free(), 9, "la baja no la devuelve");
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 9, "la unidad retirada sale del ítem");
    // Historial de la unidad: el incidente queda ligado a la reserva y a la unidad.
    const history = await db.inventoryIncident.findMany({ where: { unitId: unitIds[1] } });
    assert.equal(history.length, 1);
    assert.equal(history[0].eventId, a.eventId);
    assert.equal(history[0].cost, 400_000);
  });

  await t.test("dar de baja un daño por cantidad saca las unidades del ítem", async () => {
    const { org, assign, item, free } = await seed();
    const a = await assign(2);
    await dispatch(org, a.id);
    const back = await giveBack(org, a.id, { damaged: 2 });
    assert.ok(back.ok);
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: back.incidents[0].id, to: "WRITTEN_OFF" })).ok);
    const row = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.deepEqual([row.quantity, row.incidentHold], [8, 0]);
    assert.equal(await free(), 8);
  });

  await t.test("un evento con devoluciones pendientes o faltantes abiertos no se puede cerrar", async () => {
    const { org, assign, event, unitIds } = await seed({ units: true });
    const a = await assign(4);
    await dispatch(org, a.id);
    assert.equal((await ops.eventClosureBlockers(org, event.id)).pendingReturns[0].pending, 4);
    const back = await giveBack(org, a.id, { quantity: 3, missing: 1, missingUnitIds: [unitIds[0]] });
    assert.ok(back.ok && back.closed);
    const blockers = await ops.eventClosureBlockers(org, event.id);
    assert.equal(blockers.pendingReturns.length, 0);
    assert.equal(blockers.openMissing.length, 1);
    assert.match(ops.closureBlockMessage(blockers)!, /faltantes abiertos sin decisión/);
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: back.incidents[0].id, to: "WRITTEN_OFF" })).ok);
    assert.equal(ops.closureBlockMessage(await ops.eventClosureBlockers(org, event.id)), null);
  });

  await t.test("otra empresa recibe 404 en salida, devolución, incidentes y alta", async () => {
    const mine = await seed({ units: true });
    const other = await seed();
    const a = await mine.assign(4);
    await dispatch(mine.org, a.id);
    const back = await giveBack(mine.org, a.id, { quantity: 3, damaged: 1, damagedUnitIds: [mine.unitIds[0]] });
    assert.ok(back.ok);
    const checks = [
      await dispatch(other.org, a.id),
      await giveBack(other.org, a.id, { quantity: 1 }),
      await ops.transitionIncident({ organizationId: other.org, incidentId: back.incidents[0].id, to: "RESOLVED" }),
      await ops.createIncident({ organizationId: other.org, inventoryId: mine.item.id, kind: "REPAIR", quantity: 1 }),
    ];
    for (const check of checks) assert.ok(!check.ok && check.status === 404);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: mine.unitIds[0] } })).status, "DAMAGED");
    // Unidades de otro ítem/empresa no se aceptan.
    const mixed = await giveBack(mine.org, a.id, { quantity: 1, damaged: 1, damagedUnitIds: [other.item.id] });
    assert.ok(!mixed.ok && mixed.status === 404);
  });

  await t.test("dos devoluciones simultáneas no duplican ni devuelven de más (10 rondas)", async () => {
    for (let round = 0; round < 10; round++) {
      const { org, assign } = await seed();
      const a = await assign(10);
      await dispatch(org, a.id);
      const [x, y] = await Promise.all([giveBack(org, a.id, { quantity: 6, damaged: 1 }), giveBack(org, a.id, { quantity: 6, damaged: 1 })]);
      assert.equal([x, y].filter((r) => r.ok).length, 1, `ronda ${round}: una sola entra`);
      const loser = [x, y].find((r) => !r.ok)!;
      assert.ok(!loser.ok && loser.status === 409);
      const row = await db.eventInventory.findUniqueOrThrow({ where: { id: a.id } });
      assert.equal(row.returnedQuantity, 6);
      assert.equal(await db.inventoryIncident.count({ where: { assignmentId: a.id } }), 1);
    }
    const { org, assign, item } = await seed();
    const a = await assign(10);
    await dispatch(org, a.id);
    const both = await Promise.all([giveBack(org, a.id, { quantity: 5, damaged: 1 }), giveBack(org, a.id, { quantity: 5, damaged: 2 })]);
    assert.ok(both.every((r) => r.ok), "dos mitades caben");
    const row = await db.eventInventory.findUniqueOrThrow({ where: { id: a.id } });
    assert.deepEqual([row.returnedQuantity, row.damagedQuantity, row.checkedIn], [10, 3, true]);
    const open = await db.inventoryIncident.findMany({ where: { inventoryId: item.id, status: { in: ["OPEN", "IN_REPAIR"] } } });
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).incidentHold, open.reduce((sum, i) => sum + i.quantity, 0), "el contador coincide con los incidentes abiertos");
  });

  await t.test("alta manual de un incidente de limpieza sobre una unidad la retiene hasta resolverlo", async () => {
    const { org, unitIds, item, free } = await seed({ units: true });
    const created = await ops.createIncident({ organizationId: org, inventoryId: item.id, unitId: unitIds[2], kind: "CLEANING", quantity: 1, notes: "Manchas" });
    assert.ok(created.ok);
    assert.equal(await free(), 9);
    assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: created.incident.id, to: "RESOLVED" })).ok);
    assert.equal(await free(), 10);
  });

  await t.test("la cantidad de una asignación no puede bajar de lo ya despachado", async () => {
    const { org, assign, item, event } = await seed();
    const a = await assign(5);
    await dispatch(org, a.id, 4);
    const lower = await commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId: item.id, quantity: 3 });
    assert.ok(!lower.ok && lower.reason === "conflict");
  });
});
