import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("reubicar unidades seleccionadas en el mismo depósito: solo disponibles y todo o nada", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
  const { db } = await import("../lib/server/db");
  const { relocateUnitsWithinWarehouse } = await import("../lib/server/inventory-warehouses");
  const organizationId = randomUUID();
  const inventoryId = randomUUID();
  const warehouseId = randomUUID();
  const secondWarehouseId = randomUUID();
  const firstUnitId = randomUUID();
  const secondUnitId = randomUUID();
  const unavailableUnitId = randomUUID();
  try {
    await db.organization.create({ data: { id: organizationId, name: "QA reubicación", slug: `qa-relocate-${organizationId}` } });
    await db.inventoryItem.create({ data: { id: inventoryId, organizationId, name: "Unidad QA", category: "QA", quantity: 3 } });
    await db.warehouse.createMany({ data: [
      { id: warehouseId, organizationId, name: "Depósito QA", code: `Q${organizationId.slice(0, 5)}`, isDefault: true },
      { id: secondWarehouseId, organizationId, name: "Otro QA", code: `R${organizationId.slice(0, 5)}` },
    ] });
    await db.inventoryUnit.createMany({ data: [
      { id: firstUnitId, organizationId, inventoryId, warehouseId, code: `A${organizationId.slice(0, 8)}`, status: "AVAILABLE", location: "E1" },
      { id: secondUnitId, organizationId, inventoryId, warehouseId, code: `B${organizationId.slice(0, 8)}`, status: "AVAILABLE", location: "E1" },
      { id: unavailableUnitId, organizationId, inventoryId, warehouseId, code: `C${organizationId.slice(0, 8)}`, status: "MAINTENANCE", location: "E1" },
    ] });

    const moved = await db.$transaction((tx) => relocateUnitsWithinWarehouse(tx, { organizationId, inventoryId, warehouseId, unitIds: [firstUnitId, secondUnitId], location: "E2" }));
    assert.deepEqual(moved, { ok: true, moved: 2 });
    assert.deepEqual((await db.inventoryUnit.findMany({ where: { organizationId }, orderBy: { code: "asc" }, select: { id: true, location: true } })).map(({ id, location }) => [id, location]), [
      [firstUnitId, "E2"], [secondUnitId, "E2"], [unavailableUnitId, "E1"],
    ]);

    const client = await db.client.create({ data: { id: randomUUID(), organizationId, name: "Reserva QA" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId, clientId: client.id, name: "Reserva QA", status: "CONFIRMED" } });
    const assignment = await db.eventInventory.create({ data: { id: randomUUID(), organizationId, eventId: event.id, inventoryId, quantity: 1 } });
    const reserved = await db.$transaction((tx) => relocateUnitsWithinWarehouse(tx, { organizationId, inventoryId, warehouseId, unitIds: [firstUnitId], location: "E3" }));
    assert.equal(reserved.ok, false);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: firstUnitId } })).location, "E2", "un compromiso del producto bloquea el lote completo porque no se asocia a un código físico");
    await db.eventInventory.update({ where: { id: assignment.id }, data: { releasedAt: new Date() } });

    const blocked = await db.$transaction((tx) => relocateUnitsWithinWarehouse(tx, { organizationId, inventoryId, warehouseId, unitIds: [firstUnitId, unavailableUnitId], location: "E3" }));
    assert.equal(blocked.ok, false);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: firstUnitId } })).location, "E2", "no parcial al incluir unidad no disponible");
    const wrongWarehouse = await db.$transaction((tx) => relocateUnitsWithinWarehouse(tx, { organizationId, inventoryId, warehouseId: secondWarehouseId, unitIds: [firstUnitId], location: "E4" }));
    assert.equal(wrongWarehouse.ok, false);
    const duplicate = await db.$transaction((tx) => relocateUnitsWithinWarehouse(tx, { organizationId, inventoryId, warehouseId, unitIds: [firstUnitId, firstUnitId], location: "E4" }));
    assert.equal(duplicate.ok, false);
  } finally {
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
