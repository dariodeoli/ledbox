import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("unit export preserves physical warehouse split, retirement and tenant isolation without costs", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { exportInventoryUnits } = await import("../lib/server/inventory-unit-export");
  const org = randomUUID(), foreign = randomUUID();
  await db.organization.createMany({ data: [org, foreign].map(id => ({ id, name: "Export QA", slug: `export-${id}` })) });
  try {
    const [d1, d2] = await Promise.all(["D1", "D2"].map(code => db.warehouse.create({ data: { id: randomUUID(), organizationId: org, code, name: code } })));
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "=UnsafeName", sku: "EXPORT-1", category: "QA", quantity: 1, stockCountStatus: "PENDING_COUNT" } });
    const other = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: foreign, name: "FOREIGN-SECRET", category: "QA", quantity: 1 } });
    for (const [index, warehouse] of [d1, d2].entries()) await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: item.id, code: `EXPORT-U${index}`, warehouseId: warehouse.id, location: `E${index}-B2`, status: index ? "RETIRED" : "AVAILABLE", purchaseCost: 1234567 } });
    await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: foreign, inventoryId: other.id, code: "FOREIGN-UNIT" } });
    // Empty and external/pending catalog entries must not become fictitious physical rows.
    await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "EMPTY-NO-UNITS", category: "QA", quantity: 0, defaultWarehouseId: d1.id } });
    const response = await exportInventoryUnits(org);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const csv = await response.text();
    assert.equal(csv.trim().split(/\r?\n/).length, 3);
    assert.match(csv, /D1;D1;E0-B2/); assert.match(csv, /D2;D2;E1-B2/);
    assert.match(csv, /RETIRED/); assert.match(csv, /Pendiente conteo/);
    assert.match(csv, /'=UnsafeName/);
    assert.doesNotMatch(csv, /FOREIGN|EMPTY-NO-UNITS|1234567|Costo|Proveedor/);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await db.$disconnect();
  }
});
