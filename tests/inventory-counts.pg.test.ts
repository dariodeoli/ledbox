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
  const { createInventoryCount, InventoryCountInputError } = await import("../lib/server/inventory-counts");
  const organizationId = randomUUID();
  await db.organization.create({ data: { id: organizationId, name: "Conteos QA", slug: `conteo-${organizationId}` } });
  const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "Silla QA", category: "Muebles", quantity: 3 } });
  const warehouse = await db.warehouse.create({ data: { id: randomUUID(), organizationId, name: "Depósito QA", code: `Q${organizationId.slice(0, 5)}`, isDefault: true } });
  const units = await Promise.all(["AVAILABLE", "AVAILABLE", "MAINTENANCE"].map((status, i) => db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: item.id, warehouseId: warehouse.id, code: `QC-${organizationId.slice(0, 5)}-${i}`, status: status as "AVAILABLE" | "MAINTENANCE" } })));
  await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId: item.id, warehouseId: warehouse.id, code: `QC-${organizationId.slice(0, 5)}-R`, status: "RETIRED" } });
  try {
    const session = await db.$transaction((tx) => createInventoryCount(tx, {
      organizationId, actor: { id: "actor-1", name: "Operadora QA", email: "ops@example.test" },
      lines: [{ inventoryId: item.id, warehouseId: warehouse.id, countedQuantity: 2 }],
    }));
    assert.equal(session.actorId, "actor-1");
    assert.equal(session.actorName, "Operadora QA");
    assert.ok(session.countedAt instanceof Date);
    assert.equal(session.lines[0].expectedQuantity, 3, "retiradas no se consideran en stock esperado");
    assert.equal(session.lines[0].countedQuantity, 2);
    assert.equal(session.lines[0].discrepancy, -1);
    assert.equal(await db.inventoryUnit.count({ where: { id: { in: units.map((unit) => unit.id) } } }), 3);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 3);
    await assert.rejects(
      () => db.$transaction((tx) => createInventoryCount(tx, { organizationId, actor: { id: "actor-1", name: "QA", email: "" }, lines: [{ inventoryId: item.id, warehouseId: warehouse.id, countedQuantity: 0 }, { inventoryId: item.id, warehouseId: warehouse.id, countedQuantity: 1 }] })),
      InventoryCountInputError,
    );
  } finally {
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
