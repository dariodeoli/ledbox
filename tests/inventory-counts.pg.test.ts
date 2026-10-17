import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("conteo físico guarda actor, fecha y discrepancia sin modificar stock", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const psqlUrl = new URL(url);
  psqlUrl.searchParams.delete("schema");
  const file = new URL("../prisma/migrations/202611050001_inventory_physical_counts/migration.sql", import.meta.url).pathname;
  for (let i = 0; i < 2; i++) execFileSync("psql", [psqlUrl.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
  const { db } = await import("../lib/server/db");
  const { createInventoryCount, listInventoryCountHistory, InventoryCountInputError } = await import("../lib/server/inventory-counts");
  const { recordAudit } = await import("../lib/server/audit");
  const organizationId = randomUUID(); const otherOrganizationId = randomUUID();
  await db.organization.create({ data: { id: organizationId, name: "Conteos QA", slug: `conteo-${organizationId}` } });
  await db.organization.create({ data: { id: otherOrganizationId, name: "Otro tenant QA", slug: `conteo-${otherOrganizationId}` } });
  const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Silla QA", category: "Muebles", quantity: 3 } });
  const secondItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Mesa QA", category: "Muebles", quantity: 1 } });
  const foreignItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: otherOrganizationId, name: "Privado QA", category: "QA", quantity: 1 } });
  const warehouse = await db.warehouse.create({ data: { id: randomUUID(), organizationId, name: "Depósito QA", code: `Q${organizationId.slice(0, 5)}`, isDefault: true } });
  const foreignWarehouse = await db.warehouse.create({ data: { id: randomUUID(), organizationId: otherOrganizationId, name: "Privado QA", code: `X${organizationId.slice(0, 5)}`, isDefault: true } });
  const units = await Promise.all(["AVAILABLE", "AVAILABLE", "MAINTENANCE"].map((status, i) => db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: item.id, warehouseId: warehouse.id, code: `QC-${organizationId.slice(0, 5)}-${i}`, status: status as "AVAILABLE" | "MAINTENANCE" } })));
  await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: item.id, warehouseId: warehouse.id, code: `QC-${organizationId.slice(0, 5)}-R`, status: "RETIRED" } });
  try {
    const session = await db.$transaction(async (tx) => {
      const created = await createInventoryCount(tx, {
        organizationId, actor: { id: "actor-1", name: "Operadora QA", email: "ops@example.test" },
        lines: [{ inventoryId: item.id, warehouseId: warehouse.id, countedQuantity: 2 }, { inventoryId: secondItem.id, warehouseId: warehouse.id, countedQuantity: 1 }],
      });
      await recordAudit({
        context: { organizationId, user: { id: "actor-1", name: "Operadora QA", email: "ops@example.test", role: "OPERATIONS" } },
        action: "create", entity: "InventoryCountSession", entityId: created.id,
        summary: `Registró un conteo físico de ${created.lines.length} productos`,
        detail: { fields: { lineas: created.lines.length, discrepancias: created.lines.filter((line) => line.discrepancy !== 0).length } },
      }, tx);
      return created;
    });
    assert.equal(session.actorId, "actor-1");
    assert.equal(session.actorName, "Operadora QA");
    assert.ok(session.countedAt instanceof Date);
    const countedItemLine = session.lines.find((line) => line.inventoryId === item.id)!;
    assert.equal(countedItemLine.expectedQuantity, 3, "retiradas no se consideran en stock esperado");
    assert.equal(countedItemLine.countedQuantity, 2);
    assert.equal(countedItemLine.discrepancy, -1);
    const audit = await db.auditLog.findFirst({ where: { organizationId, entity: "InventoryCountSession", entityId: session.id } });
    assert.equal(audit?.actorId, "actor-1");
    assert.equal(audit?.action, "create");
    assert.deepEqual(audit?.detail, { fields: { lineas: 2, discrepancias: 2 } });
    assert.equal(await db.inventoryUnit.count({ where: { id: { in: units.map((unit) => unit.id) } } }), 3);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 3);
    const itemHistory = await db.$transaction((tx) => listInventoryCountHistory(tx, { organizationId, take: 50, inventoryId: item.id }));
    assert.equal(itemHistory.length, 1);
    assert.deepEqual(itemHistory[0].lines.map((line) => line.inventoryId), [item.id], "filtered verification returns only the requested product lines");
    assert.deepEqual(await db.$transaction((tx) => listInventoryCountHistory(tx, { organizationId, take: 50, inventoryId: foreignItem.id })), [], "an ID from another tenant has the same empty result as an unknown item");
    assert.deepEqual(await db.$transaction((tx) => listInventoryCountHistory(tx, { organizationId, take: 50, warehouseId: foreignWarehouse.id })), [], "foreign warehouses do not reveal count sessions");
    await assert.rejects(() => db.$transaction((tx) => createInventoryCount(tx, { organizationId, actor: { id: "actor-1", name: "QA", email: "" }, lines: [{ inventoryId: foreignItem.id, warehouseId: warehouse.id, countedQuantity: 0 }] })), InventoryCountInputError);
    await assert.rejects(() => db.$transaction((tx) => createInventoryCount(tx, { organizationId, actor: { id: "actor-1", name: "QA", email: "" }, lines: [{ inventoryId: item.id, warehouseId: foreignWarehouse.id, countedQuantity: 0 }] })), InventoryCountInputError);
    assert.equal(await db.inventoryCountSession.count({ where: { organizationId } }), 1, "rejected cross-tenant references do not persist sessions");
    await assert.rejects(
      () => db.$transaction((tx) => createInventoryCount(tx, { organizationId, actor: { id: "actor-1", name: "QA", email: "" }, lines: [{ inventoryId: item.id, warehouseId: warehouse.id, countedQuantity: 0 }, { inventoryId: item.id, warehouseId: warehouse.id, countedQuantity: 1 }] })),
      InventoryCountInputError,
    );
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await db.$disconnect();
  }
});
