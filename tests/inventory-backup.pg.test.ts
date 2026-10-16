import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
test("portable inventory export/restore preserves mixed ownership, assets, graph and rollback without operations", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); process.env.DATABASE_URL = url.toString();
  const { dbWithDeleted: db } = await import("../lib/server/db");
  const { exportInventoryBackup, readInventoryBackup, restoreInventoryBackup } = await import("../lib/server/inventory-backup");
  const sharp = (await import("sharp")).default;
  const source = randomUUID(), target = randomUUID(), rollback = randomUUID();
  try {
    await db.organization.create({ data: { id: source, name: "Backup source fixture", slug: `backup-${source}` } });
    for (const id of [target, rollback]) await db.organization.create({ data: { id, name: "Restore fixture", slug: `backup-${id}`, isDemo: true, demoParentId: source, demoReady: false, demoExpiresAt: new Date(Date.now() + 3600000) } });
    const s1 = randomUUID(), s2 = randomUUID(), wh1 = randomUUID(), wh2 = randomUUID(), cat = randomUUID(), family = randomUUID(), item = randomUUID(), combo = randomUUID(), collection = randomUUID();
    await db.supplier.createMany({ data: [s1, s2].map(id => ({ id, organizationId: source, name: "Same display name" })) });
    await db.warehouse.createMany({ data: [{ id: wh1, organizationId: source, code: "A", name: "One", isDefault: true }, { id: wh2, organizationId: source, code: "B", name: "Two" }] });
    const image = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#abcdef" } }).webp().toBuffer());
    await db.inventoryCategory.create({ data: { id: cat, organizationId: source, name: "Seat", key: "seat", imageData: image, imageMime: "image/webp" } });
    await db.inventoryFamily.create({ data: { id: family, organizationId: source, name: "Seat", code: "F1", categoryId: cat, axes: [{ key: "color", values: [{ value: "Blue" }] }], coverItemId: item } });
    await db.inventoryItem.create({ data: { id: item, organizationId: source, name: "Seat Blue", sku: "S1", category: "Seat", categoryId: cat, quantity: 3, familyId: family, variantOptions: { color: "Blue" }, variantKey: "color=blue", wholesalePrice: 800, listPrice: 1000, defaultStockOrigin: "CONSIGNED", defaultSourceSupplierId: s1, defaultWarehouseId: wh1, supplierId: s2, imageData: image, imageMime: "image/webp" } });
    for (const [index, owner, status] of [[1, null, "AVAILABLE"], [2, s1, "MAINTENANCE"], [3, s2, "LOST"], [4, null, "RETIRED"]] as const) await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: source, inventoryId: item, code: `U${index}`, status, stockOrigin: owner ? "CONSIGNED" : "OWNED", ownerSupplierId: owner, warehouseId: index % 2 ? wh1 : wh2, location: "E3", notes: "Preserve", purchaseCost: 450, supplierId: s2, incidentCycle: 2 } });
    await db.inventoryItem.createMany({ data: [{ id: combo, organizationId: source, sku: "C1", name: "Combo", category: "Seat", quantity: 0 }, { id: randomUUID(), organizationId: source, sku: "PENDING", name: "Unknown", category: "Seat", quantity: 0, stockCountStatus: "PENDING_COUNT" }, { id: randomUUID(), organizationId: source, sku: "EXT", name: "External", category: "Seat", quantity: 0, defaultStockOrigin: "EXTERNAL_RENTAL", defaultSourceSupplierId: s2 }] });
    await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: source, parentId: combo, componentId: item, quantity: 2 } });
    await db.inventoryPriceTier.create({ data: { id: randomUUID(), organizationId: source, inventoryId: item, audience: "WHOLESALE", fromDays: 3, mode: "TOTAL", price: 2000 } });
    await db.inventoryImage.create({ data: { id: randomUUID(), organizationId: source, itemId: item, position: 1, mime: "image/webp", size: image.length, data: image } });
    await db.collection.create({ data: { id: collection, organizationId: source, name: "Style", slug: "style", imageData: image, imageMime: "image/webp" } });
    await db.collectionItem.create({ data: { organizationId: source, collectionId: collection, itemId: item } });
    const pack = readInventoryBackup(await exportInventoryBackup(source));
    assert.equal(pack.summary.InventoryUnit, 4);
    assert.equal(pack.assetBytes, image.length * 4, "quota counts four stored copies of one deduplicated asset");
    const { zipSync, strToU8 } = await import("fflate"); const { backupHash } = await import("../lib/server/inventory-backup");
    const mutations = [
      (d: any) => { d.InventoryUnit[0].ownerSupplierId = "foreign"; },
      (d: any) => { d.InventoryItem.find((i: any) => i.sku === "S1").quantity = 100; },
      (d: any) => { d.InventoryComponent[0].quantity = -1; },
      (d: any) => { d.InventoryCategory[0].parentId = d.InventoryCategory[0].id; },
      (d: any) => { d.InventoryUnit.push(d.InventoryUnit[0]); },
      (d: any) => { d.Supplier[0].apiSecret = "must-not-import"; },
    ];
    for (const mutate of mutations) {
      const data = structuredClone(pack.data); mutate(data);
      const files = { "data.json": strToU8(JSON.stringify(data)), ...pack.assets };
      const archive = zipSync({ ...files, "manifest.json": strToU8(JSON.stringify({ format: "ledbox-inventory-backup", version: 1, files: Object.entries(files).map(([path, b]) => ({ path, bytes: b.length, sha256: backupHash(b) })) })) });
      assert.throws(() => readInventoryBackup(archive));
    }
    await assert.rejects(db.$transaction(async tx => { await restoreInventoryBackup(tx, rollback, pack); throw new Error("fail after writes"); }), /fail after writes/);
    assert.equal(await db.inventoryItem.count({ where: { organizationId: rollback } }), 0); assert.equal((await db.organization.findUniqueOrThrow({ where: { id: rollback } })).demoReady, false);
    await db.$transaction(tx => restoreInventoryBackup(tx, target, pack));
    const restored = readInventoryBackup(await exportInventoryBackup(target)); assert.deepEqual(restored.summary, pack.summary); assert.deepEqual(Object.keys(restored.assets).sort(), Object.keys(pack.assets).sort());
    const physical = await db.inventoryUnit.findMany({ where: { organizationId: target }, include: { ownerSupplier: true, warehouse: true } });
    assert.equal(physical.filter(u => u.stockOrigin === "CONSIGNED").length, 2); assert.equal(new Set(physical.filter(u => u.ownerSupplierId).map(u => u.ownerSupplierId)).size, 2); assert.deepEqual(physical.map(u => u.status).sort(), ["AVAILABLE", "LOST", "MAINTENANCE", "RETIRED"]); assert.ok(physical.every(u => u.notes === "Preserve" && u.purchaseCost === 450 && u.incidentCycle === 2));
    assert.equal(new Set(physical.map(u => u.warehouseId)).size, 2);
    assert.equal(restored.data.InventoryItem.find(i => i.sku === "PENDING")!.stockCountStatus, "PENDING_COUNT");
    for (const delegate of [db.eventInventory, db.treasuryMovement, db.budget, db.mailLog] as any[]) assert.equal(await delegate.count({ where: { organizationId: target } }), 0);
    await assert.rejects(db.$transaction(tx => restoreInventoryBackup(tx, target, pack)), /nueva y vacía/);
    assert.deepEqual(readInventoryBackup(await exportInventoryBackup(source)).summary, pack.summary);
  } finally { await db.organization.deleteMany({ where: { id: { in: [target, rollback] } } }); await db.organization.delete({ where: { id: source } }); await db.$disconnect(); }
});
