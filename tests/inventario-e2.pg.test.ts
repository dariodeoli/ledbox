import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/inventario-e2.pg.test.ts
test("Inventario E2 en PostgreSQL: payload liviano, agregados por groupBy, paginación por cursor y empresa", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { GridCursorError, encodeGridCursor, listInventoryGrid, loadGridExtras, matchInventoryByUnitCode, readGridLimit } = await import("../lib/server/inventory-grid");
  const { inventoryVisualState: visualOf } = await import("../lib/inventory-visual-state");
  const inventoryVisualState = (row: { archivedAt: Date | null } & Omit<Parameters<typeof visualOf>[0], "archivedAt">) => visualOf({ ...row, archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null });

  const orgs: string[] = [];
  const newOrg = async (label: string) => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: `Inventario E2 ${label}`, slug: `inv-e2-${id}` } });
    return id;
  };
  const hours = (now: Date, n: number) => new Date(now.getTime() + n * 3_600_000);
  const addItem = (organizationId: string, name: string, extra: Record<string, unknown> = {}) =>
    db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name, category: "General", quantity: 0, ...extra } });
  const addUnits = async (organizationId: string, inventoryId: string, prefix: string, statuses: string[], extra: Record<string, unknown> = {}) => {
    let n = 0;
    for (const status of statuses) {
      n += 1;
      await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId, code: `${prefix}-${String(n).padStart(2, "0")}`, status: status as never, ...extra } });
    }
    await db.inventoryItem.update({ where: { id: inventoryId }, data: { quantity: statuses.filter((status) => status !== "RETIRED").length } });
  };

  try {
    const now = new Date();
    const a = await newOrg("a");
    const b = await newOrg("b");
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: a, name: "Cliente" } });
    const warehouse = await db.warehouse.create({ data: { id: randomUUID(), organizationId: a, name: "Principal", code: "D1", isDefault: true } });
    const event = (name: string, start: Date, end: Date) =>
      db.event.create({ data: { id: randomUUID(), organizationId: a, clientId: client.id, name, startsAt: start, endsAt: end } });

    // Un caso real por cada fila del mapa de estados.
    const copa = await addItem(a, "Copa", { sku: "COP" });
    await addUnits(a, copa.id, "COP", [...Array(12).fill("AVAILABLE"), ...Array(3).fill("DAMAGED"), ...Array(5).fill("MAINTENANCE")], { warehouseId: warehouse.id, location: "E1" });
    const rented = await event("Boda ahora", hours(now, -2), hours(now, 6));
    await db.eventInventory.create({ data: { id: randomUUID(), eventId: rented.id, inventoryId: copa.id, quantity: 20, startsAt: hours(now, -2), endsAt: hours(now, 6) } });
    const future = await event("Evento futuro", hours(now, 72), hours(now, 80));
    await db.eventInventory.create({ data: { id: randomUUID(), eventId: future.id, inventoryId: copa.id, quantity: 4, startsAt: hours(now, 72), endsAt: hours(now, 80) } });

    const plato = await addItem(a, "Plato");
    await addUnits(a, plato.id, "PLA", Array(6).fill("AVAILABLE"));
    const gone = await event("Evento vencido", hours(now, -50), hours(now, -30));
    await db.eventInventory.create({ data: { id: randomUUID(), eventId: gone.id, inventoryId: plato.id, quantity: 3, startsAt: hours(now, -50), endsAt: hours(now, -30), checkedOut: true, checkedOutAt: hours(now, -48), checkoutQuantity: 3, returnedQuantity: 1 } });

    const mesa = await addItem(a, "Mesa", { quantity: 8, incidentHold: 8 });
    await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a, inventoryId: mesa.id, kind: "DAMAGE", quantity: 8, heldByQuantity: true } });
    const silla = await addItem(a, "Silla", { quantity: 4, incidentHold: 4 });
    await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a, inventoryId: silla.id, kind: "CLEANING", quantity: 4, heldByQuantity: true } });
    await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a, inventoryId: silla.id, kind: "REPAIR", quantity: 9, heldByQuantity: true, status: "RESOLVED" } });

    await t.test("1) la fila es liviana: sin unidades ni asignaciones, con los agregados del estado", async () => {
      const page = await listInventoryGrid({ organizationId: a, limit: 50, now });
      assert.equal(page.nextCursor, null);
      assert.equal(page.total, 4);
      for (const row of page.inventory) {
        assert.equal("units" in row, false);
        assert.equal("assignments" in row, false);
        assert.equal("imageData" in row, false);
        assert.ok(row.stock && row.availability.unitsByStatus && row.availability.holdByKind);
      }
      const byName = (name: string) => page.inventory.find((row) => row.name === name)!;
      const c = byName("Copa");
      assert.deepEqual(c.availability.unitsByStatus, { AVAILABLE: 12, DAMAGED: 3, MAINTENANCE: 5 });
      assert.equal(c.availability.committedNow, 20, "las 20 comprometidas de la boda de hoy");
      assert.equal(c.availability.nextCommittedAt, hours(now, 72).toISOString(), "la próxima reserva es la futura, no la de ahora");
      assert.deepEqual(c.stock.locations, [{ warehouseId: warehouse.id, location: "E1", units: 20 }]);
      assert.equal(c.stock.unitCount, 20);
      assert.equal(byName("Plato").availability.overduePending, 2, "salieron 3, volvió 1: faltan 2 con el fin vencido");
      assert.deepEqual(byName("Mesa").availability.holdByKind, { DAMAGE: 8 });
      assert.deepEqual(byName("Silla").availability.holdByKind, { CLEANING: 4 }, "un incidente resuelto no retiene");
    });

    await t.test("2) cada estado del mapa sale de la availability real", async () => {
      const page = await listInventoryGrid({ organizationId: a, limit: 50, now });
      const key = (name: string) => inventoryVisualState(page.inventory.find((row) => row.name === name)!).state.key;
      assert.equal(key("Plato"), "overdue", "vencida gana sobre cualquier otro");
      assert.equal(key("Mesa"), "damaged");
      assert.equal(key("Silla"), "maintenance");
      const copaState = inventoryVisualState(page.inventory.find((row) => row.name === "Copa")!);
      assert.equal(copaState.state.key, "rented", "libres 0: todas las sanas están comprometidas");
      assert.equal(copaState.reserved?.tone, "accent");
    });

    await t.test("3) paginación por cursor: sin repetidos, sin huecos y el total solo en la primera página", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: Awaited<ReturnType<typeof listInventoryGrid>> = await listInventoryGrid({ organizationId: a, limit: 2, cursor, now });
        pages += 1;
        assert.ok(page.inventory.length <= 2);
        assert.equal("total" in page, cursor === null);
        seen.push(...page.inventory.map((row) => row.name));
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(pages, 2);
      assert.deepEqual(seen, ["Copa", "Mesa", "Plato", "Silla"]);
    });

    await t.test("3b) cursor vencido: si el producto del cursor se borró entre dos páginas sigue desde el siguiente", async () => {
      const org = await newOrg("cursor");
      const created = [];
      for (const name of ["Alfa", "Beta", "Delta", "Gama"]) created.push(await addItem(org, name));
      const first = await listInventoryGrid({ organizationId: org, limit: 2, now });
      assert.deepEqual(first.inventory.map((row) => row.name), ["Alfa", "Beta"]);
      assert.ok(first.nextCursor);
      await db.inventoryItem.delete({ where: { id: created[1].id } });
      const second = await listInventoryGrid({ organizationId: org, limit: 2, cursor: first.nextCursor, now });
      assert.deepEqual(second.inventory.map((row) => row.name), ["Delta", "Gama"], "no falla ni repite: sigue por (nombre, id)");
      assert.equal(second.nextCursor, null);
      await assert.rejects(listInventoryGrid({ organizationId: org, cursor: "no-es-un-cursor", now }), GridCursorError);
    });

    await t.test("4) más de 300 productos: sin tope, páginas de 300 como máximo", async () => {
      const big = await newOrg("grande");
      await db.inventoryItem.createMany({
        data: Array.from({ length: 640 }, (_, index) => ({ id: randomUUID(), organizationId: big, name: `Producto ${String(index).padStart(4, "0")}`, category: "General", quantity: 0 })),
      });
      assert.equal(readGridLimit("9999"), 300);
      assert.equal(readGridLimit(null), 150);
      const names: string[] = [];
      let cursor: string | null = null;
      let first: Awaited<ReturnType<typeof listInventoryGrid>> | null = null;
      do {
        const page: Awaited<ReturnType<typeof listInventoryGrid>> = await listInventoryGrid({ organizationId: big, limit: 300, cursor, now });
        first ??= page;
        assert.ok(page.inventory.length <= 300);
        names.push(...page.inventory.map((row) => row.name));
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(first?.total, 640);
      assert.equal(names.length, 640);
      assert.equal(new Set(names).size, 640);
      assert.deepEqual(names, [...names].sort(), "orden estable por nombre");
    });

    await t.test("5) empresa: nada de A en B, un cursor ajeno se rechaza y la búsqueda por código está acotada", async () => {
      const bItem = await addItem(b, "Copa de B");
      await addUnits(b, bItem.id, "COP", ["AVAILABLE"]);
      const pageB = await listInventoryGrid({ organizationId: b, now });
      assert.deepEqual(pageB.inventory.map((row) => row.name), ["Copa de B"]);
      await assert.rejects(listInventoryGrid({ organizationId: b, cursor: copa.id, now }), GridCursorError, "un id suelto ya no es un cursor válido");
      const forged = await listInventoryGrid({ organizationId: b, cursor: encodeGridCursor({ name: "A", id: copa.id }), now });
      assert.deepEqual(forged.inventory.map((row) => row.name), ["Copa de B"], "un cursor armado con datos de A solo recorre la empresa B");
      assert.deepEqual(await matchInventoryByUnitCode(a, "cop-0"), [copa.id], "insensible a mayúsculas y solo de la empresa A");
      assert.deepEqual(await matchInventoryByUnitCode(b, "COP-01"), [bItem.id]);
      assert.deepEqual(await matchInventoryByUnitCode(a, "x"), [], "menos de dos caracteres no busca");
      const extras = await loadGridExtras({ organizationId: b, itemIds: [copa.id], assignments: [], now });
      assert.equal(extras.get(copa.id)?.stock.unitCount, 0, "los agregados de un producto ajeno vienen vacíos");
    });

    await t.test("6) con rango: suma la disponibilidad del rango sin perder los agregados", async () => {
      const page = await listInventoryGrid({ organizationId: a, limit: 50, now, range: { start: hours(now, 71), end: hours(now, 81) } });
      const c = page.inventory.find((row) => row.name === "Copa")!;
      assert.ok(c.availability.range, "trae el rango");
      assert.equal(c.availability.range?.committed, 4, "solo la reserva futura cae en el rango");
      assert.equal(c.availability.unitsByStatus?.AVAILABLE, 12);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  }
});
