import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in, ONLY a disposable localhost database migrated by the integrator.
// TEST_DATABASE_URL=postgresql://...@127.0.0.1:port/lbx137_qa node --import tsx --test --test-concurrency=1 tests/stock-count.pg.test.ts
test("stock count confirmation persists knowledge, units and reservation gates", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert(["localhost", "127.0.0.1"].includes(url.hostname), "disposable local PostgreSQL only");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { confirmInventoryCount } = await import("../lib/server/inventory-stock-count");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { availabilityForRange, commitInventoryAssignment, lockInventoryItems } = await import("../lib/server/inventory-availability");
  const { createInventoryUnits, syncInventoryQuantity } = await import("../lib/server/inventory-units");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { applyCatalog } = await import("../lib/server/import-catalog");
  const organizations = [randomUUID(), randomUUID()];
  const [org, foreign] = organizations;
  const ctx = portalAuditContext(org, "Count QA");
  const date = (day: number) => new Date(Date.UTC(2031, 2, day, 12));
  const pending = (name: string, extra = {}) => db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category: "Count QA", quantity: 0, stockCountStatus: "PENDING_COUNT", ...extra } });
  const confirm = (id: string, total: number, context = ctx) => db.$transaction(tx => confirmInventoryCount(tx, context, id, total));
  const reload = async (id: string) => ({
    item: await db.inventoryItem.findUniqueOrThrow({ where: { id }, select: { quantity: true, stockCountStatus: true, name: true, notes: true } }),
    units: await db.inventoryUnit.findMany({ where: { inventoryId: id }, orderBy: { id: "asc" } }),
    audits: await db.auditLog.findMany({ where: { organizationId: org, entity: "InventoryItem", entityId: id }, orderBy: { id: "asc" } }),
    assignments: await db.eventInventory.findMany({ where: { inventoryId: id }, orderBy: { id: "asc" } }),
  });
  try {
    for (const id of organizations) await db.organization.create({ data: { id, name: "Count QA", slug: `count-qa-${id}` } });
    await t.test("pending zero confirmed as zero creates no phantom unit; replay is idempotent", async () => {
      const item = await pending("Zero count");
      assert.equal((await confirm(item.id, 0)).added, 0);
      const first = await reload(item.id);
      assert.equal(first.item.quantity, 0); assert.equal(first.item.stockCountStatus, "CONFIRMED"); assert.equal(first.units.length, 0); assert.equal(first.audits.length, 1);
      await confirm(item.id, 0); assert.deepEqual(await reload(item.id), first);
    });
    await t.test("pending zero confirmed as three creates exactly three; replay retains unit identities", async () => {
      const item = await pending("Three count");
      assert.equal((await confirm(item.id, 3)).added, 3);
      const first = await reload(item.id);
      assert.equal(first.item.quantity, 3); assert.equal(first.item.stockCountStatus, "CONFIRMED"); assert.equal(first.units.length, 3);
      assert(first.units.every(unit => unit.status === "AVAILABLE")); assert.equal(new Set(first.units.map(unit => unit.code)).size, 3); assert.equal(first.audits.length, 1);
      await confirm(item.id, 3); assert.deepEqual(await reload(item.id), first);
    });
    await t.test("smaller/invalid totals and foreign tenant fail without mutating units or knowledge", async () => {
      const item = await pending("Registered pending");
      await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 3 }));
      const before = await reload(item.id); assert.equal(before.item.stockCountStatus, "PENDING_COUNT");
      for (const count of [0, 2, -1, 1.5, 100001]) { await assert.rejects(confirm(item.id, count)); assert.deepEqual(await reload(item.id), before); }
      await assert.rejects(confirm(item.id, 3, portalAuditContext(foreign, "Foreign QA"))); assert.deepEqual(await reload(item.id), before);
      await confirm(item.id, 4); const after = await reload(item.id); assert.equal(after.units.length, 4); assert.equal(after.item.stockCountStatus, "CONFIRMED");
      assert(before.units.every(unit => after.units.some(next => next.id === unit.id && next.code === unit.code)));
    });
    await t.test("retired units stay retired and never increase the active total that must be counted", async () => {
      const item = await pending("Retired count");
      await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 2 }));
      const retired = await db.inventoryUnit.findFirstOrThrow({ where: { inventoryId: item.id } });
      await db.$transaction(async tx => { await lockInventoryItems(tx, org, [item.id]); await tx.inventoryUnit.update({ where: { id: retired.id }, data: { status: "RETIRED" } }); await syncInventoryQuantity(tx, item.id); });
      assert.equal((await reload(item.id)).item.quantity, 1);
      assert.equal((await confirm(item.id, 1)).added, 0);
      let after = await reload(item.id); assert.equal(after.units.length, 2); assert.equal(after.item.quantity, 1); assert.equal(after.units.find(unit => unit.id === retired.id)?.status, "RETIRED");
      assert.equal((await confirm(item.id, 2)).added, 1);
      after = await reload(item.id); assert.equal(after.units.length, 3); assert.equal(after.item.quantity, 2); assert.equal(after.units.find(unit => unit.id === retired.id)?.status, "RETIRED");
    });
    await t.test("defined and incomplete combos cannot confirm an independent count", async () => {
      const piece = await pending("Piece");
      const defined = await pending("Defined combo"), incomplete = await pending("Incomplete combo", { comboIncomplete: true });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: org, parentId: defined.id, componentId: piece.id, quantity: 1 } });
      for (const item of [defined, incomplete]) { const before = await reload(item.id); await assert.rejects(confirm(item.id, 2), /componentes/); assert.deepEqual(await reload(item.id), before); }
    });
    await t.test("real import metadata save with null count never confirms pending knowledge", async () => {
      const sku = `M-${randomUUID()}`;
      const item = await pending("Metadata count", { sku });
      const parsed = normalizeCatalog({ productos: [{ codigo: sku, nombre: "Renamed metadata", descripcion: "New public description", cantidad: null }] }); assert(parsed.ok);
      const result = await applyCatalog(ctx, { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [], lote: randomUUID() });
      assert.deepEqual(result.fallidos, []);
      const after = await reload(item.id); assert.equal(after.item.name, "Renamed metadata"); assert.equal(after.item.stockCountStatus, "PENDING_COUNT"); assert.equal(after.item.quantity, 0); assert.equal(after.units.length, 0);
    });
    await t.test("pending with registered units blocks real reservation; explicit confirmation enables it", async () => {
      const item = await pending("Reservation count");
      await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 3 }));
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Count client" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Count event", setupAt: date(10), startsAt: date(10), endsAt: date(12), strikeAt: date(12) } });
      const stored = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      const availability = await availabilityForRange({ organizationId: org, item: { ...stored, maintenance: 0 }, startsAt: date(10), endsAt: date(12) });
      assert.equal(availability.stockCountStatus, "PENDING_COUNT"); assert.equal(availability.available, 0); assert(availability.blocked); assert.equal(availability.total, 3);
      const commit = () => commitInventoryAssignment({ organizationId: org, inventoryId: item.id, eventId: event.id, quantity: 2, startsAt: date(10), endsAt: date(12) });
      const rejected = await commit(); assert.equal(rejected.ok, false); assert.equal(await db.eventInventory.count({ where: { inventoryId: item.id } }), 0);
      await confirm(item.id, 3); assert((await commit()).ok); assert.equal((await db.eventInventory.findFirstOrThrow({ where: { inventoryId: item.id } })).quantity, 2);
    });
    await t.test("import confirmation places only the new units in the requested warehouse/location", async () => {
      const primary = await db.warehouse.create({ data: { id: randomUUID(), organizationId: org, name: "Primary placement", code: `A${randomUUID().slice(0, 5).toUpperCase()}` } });
      const secondary = await db.warehouse.create({ data: { id: randomUUID(), organizationId: org, name: "Secondary placement", code: `B${randomUUID().slice(0, 5).toUpperCase()}` } });
      const sku = `P-${randomUUID()}`;
      const item = await pending("Placed pending", { sku });
      await db.$transaction(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 2, warehouseId: primary.id, location: "E1-B1" }));
      const before = (await reload(item.id)).units;
      const parsed = normalizeCatalog({ productos: [{ codigo: sku, nombre: item.name, cantidad: 4, deposito: secondary.code, ubicacion: "E3-B2" }] }); assert(parsed.ok);
      assert.equal(parsed.value.doc.productos[0].deposito, secondary.code); assert.equal(parsed.value.doc.productos[0].ubicacion, "E3-B2");
      const result = await applyCatalog(ctx, { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [], lote: randomUUID() }); assert.deepEqual(result.fallidos, []);
      const after = await reload(item.id); assert.equal(after.item.quantity, 4); assert.equal(after.item.stockCountStatus, "CONFIRMED");
      for (const unit of before) assert.deepEqual(after.units.find(next => next.id === unit.id), unit, "existing unit is not silently moved");
      const added = after.units.filter(unit => !before.some(old => old.id === unit.id)); assert.equal(added.length, 2); assert(added.every(unit => unit.warehouseId === secondary.id && unit.location === "E3-B2"));
    });
    await t.test("new zero/null imports retain default placement for future count confirmation", async () => {
      const warehouse = await db.warehouse.create({ data: { id: randomUUID(), organizationId: org, name: "Empty item warehouse", code: `C${randomUUID().slice(0, 5).toUpperCase()}` } });
      for (const cantidad of [0, null]) {
        const sku = `D-${randomUUID()}`;
        const parsed = normalizeCatalog({ productos: [{ codigo: sku, nombre: "Empty placed product", cantidad, deposito: warehouse.code, ubicacion: "E4-B2" }] }); assert(parsed.ok);
        const result = await applyCatalog(ctx, { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [], lote: randomUUID() }); assert.deepEqual(result.fallidos, []);
        const item = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku } });
        assert.equal(item.defaultWarehouseId, warehouse.id); assert.equal(item.defaultLocation, "E4-B2"); assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id } }), 0);
        await confirm(item.id, 1); const units = (await reload(item.id)).units; assert.equal(units.length, 1); assert.equal(units[0].warehouseId, warehouse.id); assert.equal(units[0].location, "E4-B2");
      }
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: organizations } } });
    await db.$disconnect();
  }
});
