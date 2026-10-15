import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("disponibilidad completa: la historia no oculta una reserva posterior (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const engine = await import("../lib/server/inventory-availability");
  const catalog = await import("../lib/server/catalog-public");
  const organizationId = randomUUID();
  const clientId = randomUUID();
  const inventoryId = randomUUID();
  const startsAt = new Date("2040-11-01T03:00:00Z");
  const endsAt = new Date("2040-11-02T02:59:00Z");
  const old = new Date("2030-01-01T12:00:00Z");
  const item = { id: inventoryId, name: "Sillas de prueba", status: "AVAILABLE" as const, quantity: 10, maintenance: 0 };
  const createHistory = async (count: number) => {
    const ids = Array.from({ length: count }, () => randomUUID());
    await db.event.createMany({ data: ids.map((id) => ({ id, organizationId, clientId, name: "Evento histórico", startsAt: old, endsAt: old })) });
    await db.eventInventory.createMany({ data: ids.map((eventId) => ({ id: randomUUID(), organizationId, inventoryId, eventId, quantity: 1, startsAt: old, endsAt: old })) });
  };
  try {
    await db.organization.create({ data: { id: organizationId, name: "Prueba histórica", slug: `history-${organizationId}` } });
    await db.client.create({ data: { id: clientId, organizationId, name: "Cliente ficticio" } });
    await db.inventoryItem.create({ data: { id: inventoryId, organizationId, name: item.name, category: "Sillas", quantity: 10, visibleOnWeb: true, catalogAudience: "RETAIL", listPrice: 10000 } });
    await createHistory(500);
    const eventId = randomUUID();
    await db.event.create({ data: { id: eventId, organizationId, clientId, name: "Reserva vigente", startsAt, endsAt } });
    await db.eventInventory.create({ data: { id: randomUUID(), organizationId, inventoryId, eventId, quantity: 10, startsAt, endsAt } });
    await t.test("501 asignaciones: el motor encuentra las diez unidades comprometidas", async () => {
      const actual = await engine.availabilityForRange({ organizationId, item, startsAt, endsAt });
      assert.equal(actual.available, 0, `esperado 0 libres; actual ${actual.available}, comprometidas ${actual.committed}`);
    });
    await t.test("la reserva atómica rechaza sobreventa después de 500 históricas", async () => {
      const eventId = randomUUID();
      await db.event.create({ data: { id: eventId, organizationId, clientId, name: "Nueva reserva", startsAt, endsAt } });
      const result = await engine.commitInventoryAssignment({ organizationId, eventId, inventoryId, quantity: 1, startsAt, endsAt });
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, "insufficient");
      assert.equal(await db.eventInventory.count({ where: { eventId } }), 0);
    });
    await createHistory(4500);
    await t.test("5001 asignaciones: la tienda informa sin disponibilidad", async () => {
      const rows = await catalog.loadVisibleRows(organizationId, "RETAIL");
      const range = { startsAt, endsAt, fromKey: "2040-11-01", toKey: "2040-11-01", days: 1 };
      const actual = (await catalog.hintsFor(organizationId, rows, range)).get(inventoryId);
      assert.equal(actual, "CONSULT", JSON.stringify(actual));
    });
    await t.test("501 solapadas: pagina completo y excluye las 5000 históricas en SQL", async () => {
      const ids = Array.from({ length: 500 }, () => randomUUID());
      await db.event.createMany({ data: ids.map((id) => ({ id, organizationId, clientId, name: "Evento concurrente", startsAt, endsAt })) });
      await db.eventInventory.createMany({ data: ids.map((eventId) => ({ id: randomUUID(), organizationId, inventoryId, eventId, quantity: 1, startsAt, endsAt })) });
      let queries = 0;
      let loaded = 0;
      const pages: number[] = [];
      const client = { eventInventory: { findMany: async (args: Parameters<typeof db.eventInventory.findMany>[0]) => {
        queries++;
        const rows = await db.eventInventory.findMany(args);
        loaded += rows.length;
        pages.push(rows.length);
        return rows;
      } } } as unknown as import("../lib/server/inventory-availability").AvailabilityClient;
      const began = performance.now();
      const rows = await engine.loadCommittedAssignments({ organizationId, inventoryIds: [inventoryId], range: { startsAt, endsAt }, client });
      const actual = engine.buildAvailability({ ...item, quantity: 1000 }, rows, startsAt, endsAt);
      assert.equal(actual.committed, 510);
      assert.equal(actual.available, 490);
      assert.equal(loaded, 501);
      assert.equal(queries, 2);
      assert.deepEqual(pages, [500, 1]);
      t.diagnostic(`5501 asignaciones: ${loaded} filas relevantes; ${queries} consultas; ${(performance.now() - began).toFixed(1)} ms`);
    });

    await t.test("combos y cotización no ofrecen piezas comprometidas después del historial", async () => {
      const comboId = randomUUID();
      await db.inventoryItem.create({ data: { id: comboId, organizationId, name: "Juego de sillas", category: "Combos", quantity: 0, listPrice: 18000 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId, parentId: comboId, componentId: inventoryId, quantity: 2 } });
      const combos = await import("../lib/server/inventory-combos");
      const quote = await import("../lib/server/combo-quote");
      const capacity = (await combos.comboCapacitiesForRange({ organizationId, comboIds: [comboId], startsAt, endsAt })).get(comboId);
      assert.equal(capacity?.capacity, 0);
      const actual = await quote.comboQuote({ organizationId, comboId, quantity: 1, days: 1, audience: "RETAIL", range: { startsAt, endsAt } });
      assert.equal(actual?.components[0].available, 0);
      assert.equal(actual?.components[0].short, true);
      const freeId = randomUUID();
      await db.inventoryItem.create({ data: { id: freeId, organizationId, name: "Reemplazo libre", category: "Sillas", quantity: 20 } });
      const substitutes = await engine.findSubstitutes({ organizationId, item: { id: freeId, category: "Sillas", status: "AVAILABLE" }, startsAt, endsAt });
      assert.ok(!substitutes.some((row) => row.id === inventoryId), "no ofrece el componente ocupado como sustituto");
    });

    await t.test("prefiltro conserva rangos heredados, abiertos, colchones y devoluciones tardías", async () => {
      const matrixId = randomUUID();
      await db.inventoryItem.create({ data: { id: matrixId, organizationId, name: "Matriz", category: "Sillas", quantity: 100 } });
      const before = new Date(startsAt.getTime() - 90 * 60000);
      const after = new Date(endsAt.getTime() + 90 * 60000);
      const cases = [
        { label: "heredado", event: { startsAt, endsAt } },
        { label: "montaje", event: { setupAt: startsAt, startsAt: after, endsAt: after } },
        { label: "desmontaje", event: { startsAt: old, endsAt: old, strikeAt: startsAt } },
        { label: "abierto", event: {} },
        { label: "fin hereda inicio propio", event: {}, row: { startsAt } },
        { label: "fin hereda montaje", event: { setupAt: startsAt } },
        { label: "colchón anterior", event: { startsAt: before, endsAt: before } },
        { label: "colchón posterior", event: { startsAt: after, endsAt: after } },
        { label: "devolución tardía", event: { startsAt: old, endsAt: old }, row: { checkedInAt: startsAt, checkedIn: true } },
        { label: "salió y no volvió", event: { startsAt: old, endsAt: old }, row: { checkedOut: true } },
        { label: "histórico fuera", event: { startsAt: old, endsAt: old } },
        { label: "retención vencida", event: { startsAt, endsAt }, row: { holdExpiresAt: new Date("2000-01-01T00:00:00Z") } },
        { label: "liberado", event: { startsAt, endsAt }, row: { releasedAt: old } },
        { label: "cancelado", event: { startsAt, endsAt, status: "CANCELLED" as const } },
      ];
      for (const entry of cases) {
        const eventId = randomUUID();
        await db.event.create({ data: { id: eventId, organizationId, clientId, name: entry.label, ...entry.event } });
        await db.eventInventory.create({ data: { id: randomUUID(), organizationId, eventId, inventoryId: matrixId, quantity: 1, ...entry.row } });
      }
      const all = await engine.loadAssignments(matrixId, organizationId);
      const filtered = await engine.loadCommittedAssignments({ organizationId, inventoryIds: [matrixId], range: { startsAt, endsAt, bufferMinutes: 120 } });
      const matrix = { ...item, id: matrixId, quantity: 100, buffers: { beforeMin: 60, afterMin: 60 } };
      const now = new Date("2040-11-01T12:00:00Z");
      const expected = engine.buildAvailability(matrix, all, startsAt, endsAt, now);
      const actual = engine.buildAvailability(matrix, filtered, startsAt, endsAt, now);
      assert.equal(expected.committed, 10, JSON.stringify(expected.conflicts));
      assert.equal(actual.committed, expected.committed);
      assert.deepEqual(actual.conflicts.map((row) => row.id).sort(), expected.conflicts.map((row) => row.id).sort());
      assert.ok(filtered.length < all.length, "SQL elimina la historia irrelevante");
      assert.equal((await engine.loadCommittedAssignments({ organizationId: randomUUID(), inventoryIds: [matrixId], range: { startsAt, endsAt } })).length, 0);
      assert.equal((await engine.loadCommittedAssignments({ organizationId, inventoryIds: [], range: { startsAt, endsAt } })).length, 0);
      const open = await engine.loadCommittedAssignments({ organizationId, inventoryIds: [matrixId], range: { startsAt: new Date(-8.64e15), endsAt: new Date(8.64e15) } });
      assert.equal(open.length, all.length, "rango abierto lee completo sin timestamps fuera del rango SQL");
      const excluded = await engine.loadCommittedAssignments({ organizationId, inventoryIds: [matrixId], excludeId: filtered[0].id, range: { startsAt, endsAt, bufferMinutes: 120 } });
      assert.ok(!excluded.some((row) => row.id === filtered[0].id));
    });
  } finally {
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
