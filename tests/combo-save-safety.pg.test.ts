import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in, disposable localhost PostgreSQL only. Never enabled by DATABASE_URL alone.
test("combo conversion is atomic, tenant safe and serializes topology edits", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "only disposable local PostgreSQL");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { saveCombo } = await import("../lib/server/inventory-combos");
  const organizations: string[] = [];
  async function seed() {
    const org = randomUUID(); organizations.push(org);
    await db.organization.create({ data: { id: org, name: "QA combo safety", slug: `combo-safe-${org}` } });
    const item = async (name: string, quantity = 3, extra = {}) => {
      const product = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category: "Muebles", quantity, ...extra } });
      if (quantity > 0) await db.inventoryUnit.createMany({ data: Array.from({ length: quantity }, (_, index) => ({ id: randomUUID(), organizationId: org, inventoryId: product.id, code: `${product.id}-${index}`, purchaseCost: 1234 + index, notes: "Original physical unit" })) });
      return product;
    };
    const parent = await item("Convertible", 3); const piece = await item("Mesa", 3);
    const save = (components: unknown, extra = {}) => saveCombo({ organizationId: org, id: parent.id, convertFromUnit: true, data: { name: parent.name, category: "Muebles", sku: null }, components, ...extra });
    const snapshot = async () => ({
      item: await db.inventoryItem.findUniqueOrThrow({ where: { id: parent.id } }),
      units: await db.inventoryUnit.findMany({ where: { inventoryId: parent.id }, orderBy: { id: "asc" } }),
      incidents: await db.inventoryIncident.findMany({ where: { inventoryId: parent.id }, orderBy: { id: "asc" } }),
      edges: await db.inventoryComponent.findMany({ where: { parentId: parent.id }, orderBy: { id: "asc" } }),
      categories: await db.inventoryCategory.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
    });
    return { org, parent, piece, item, save, snapshot };
  }
  try {
    await t.test("self, missing/foreign and empty/invalid components preserve every unit field and history", async () => {
      const f = await seed(), other = await seed();
      for (const components of [[], [{ componentId: f.piece.id, quantity: 0 }], [{ componentId: f.parent.id, quantity: 1 }], [{ componentId: randomUUID(), quantity: 1 }], [{ componentId: other.piece.id, quantity: 1 }]]) {
        const before = await f.snapshot(); const result = await f.save(components);
        assert.equal(result.ok, false); assert.deepEqual(await f.snapshot(), before);
      }
    });
    await t.test("complete and incomplete combos cannot become pieces; rejection preserves clean stock", async () => {
      const f = await seed();
      const incomplete = await f.item("Juego pendiente", 0, { comboIncomplete: true });
      const complete = await saveCombo({ organizationId: f.org, data: { name: "Combo real", category: "Combos", sku: null }, components: [{ componentId: f.piece.id, quantity: 1 }] });
      assert.ok(complete.ok);
      for (const id of [incomplete.id, complete.combo.id]) {
        const before = await f.snapshot(); const result = await f.save([{ componentId: id, quantity: 1 }]);
        assert.equal(!result.ok && result.reason, "nested"); assert.deepEqual(await f.snapshot(), before);
      }
    });
    await t.test("duplicate SKU after physical delete rolls back units, category creation and parent changes", async () => {
      const f = await seed(); const duplicateSku = `DUP-${randomUUID()}`;
      await f.item("SKU ocupado", 0, { sku: duplicateSku });
      const before = await f.snapshot();
      const result = await f.save([{ componentId: f.piece.id, quantity: 1 }], { data: { name: "Nuevo nombre", category: `Nueva-${randomUUID()}`, sku: duplicateSku } });
      assert.equal(!result.ok && result.reason, "duplicate-sku"); assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("even resolved unit incidents prohibit conversion and remain byte-for-byte intact", async () => {
      const f = await seed(); const unit = (await f.snapshot()).units[0];
      await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: f.org, inventoryId: f.parent.id, unitId: unit.id, kind: "DAMAGE", status: "RESOLVED", quantity: 1, resolvedAt: new Date() } });
      const before = await f.snapshot();
      const result = await f.save([{ componentId: f.piece.id, quantity: 1 }]);
      assert.equal(!result.ok && result.reason, "invalid"); assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("any historical event assignment prohibits conversion even when released", async () => {
      const f = await seed(); const client = await db.client.create({ data: { id: randomUUID(), organizationId: f.org, name: "QA client" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: f.org, clientId: client.id, name: "QA event", startsAt: new Date("2031-01-01"), endsAt: new Date("2031-01-02") } });
      await db.eventInventory.create({ data: { id: randomUUID(), organizationId: f.org, inventoryId: f.parent.id, eventId: event.id, quantity: 1, releasedAt: new Date() } });
      const before = await f.snapshot(); const result = await f.save([{ componentId: f.piece.id, quantity: 1 }]);
      assert.equal(!result.ok && result.reason, "has-reservations"); assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("valid conversion preserves product id and creates unknown text category as existing contract requires", async () => {
      const f = await seed(); const category = `Nueva-${randomUUID()}`;
      const result = await f.save([{ componentId: f.piece.id, quantity: 2 }], { data: { name: "Juego", category, sku: null } });
      assert.ok(result.ok); assert.equal(result.combo.id, f.parent.id);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: f.parent.id } }), 0);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: f.parent.id } })).quantity, 0);
      assert.ok(await db.inventoryCategory.findFirst({ where: { organizationId: f.org, name: category } }));
      assert.equal((await db.inventoryComponent.findMany({ where: { parentId: f.parent.id } }))[0].quantity, 2);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: f.piece.id } }), 3);
    });
    await t.test("concurrent A→B / B→A conversions cannot persist a cycle or erase rejected side's units", async () => {
      for (let round = 0; round < 4; round++) {
        const f = await seed();
        const results = await Promise.all([
          f.save([{ componentId: f.piece.id, quantity: 1 }]),
          saveCombo({ organizationId: f.org, id: f.piece.id, convertFromUnit: true, data: { name: f.piece.name, category: "Muebles", sku: null }, components: [{ componentId: f.parent.id, quantity: 1 }] }),
        ]);
        assert.equal(results.filter(result => result.ok).length, 1);
        assert.equal(await db.inventoryComponent.count({ where: { organizationId: f.org } }), 1);
        const rejected = results[0].ok ? f.piece.id : f.parent.id;
        assert.equal(await db.inventoryUnit.count({ where: { inventoryId: rejected } }), 3);
      }
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: organizations } } });
    await db.$disconnect();
  }
});
