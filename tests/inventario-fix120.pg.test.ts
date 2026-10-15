import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/inventario-fix120.pg.test.ts
test("Inventario E1 (notas de QA 2.1.120) en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const categories = await import("../lib/server/inventory-categories");
  const { categoryKey, categoryPathKey } = await import("../lib/inventory-categories");
  const warehouses = await import("../lib/server/inventory-warehouses");

  const orgs: string[] = [];
  const newOrg = async () => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: `Fix120 ${id}`, slug: `fix120-${id}` } });
    return id;
  };
  const addItem = (organizationId: string, name: string, category: string) =>
    db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name, category, quantity: 0 } });
  const addUnit = (organizationId: string, inventoryId: string, code: string, warehouseId: string | null, status: "AVAILABLE" | "MAINTENANCE" = "AVAILABLE") =>
    db.inventoryUnit.create({ data: { id: randomUUID(), organizationId, inventoryId, code, warehouseId, status } });
  const addWarehouse = (organizationId: string, code: string, isDefault = false) =>
    db.warehouse.create({ data: { id: randomUUID(), organizationId, name: `Depósito ${code}`, code, isDefault } });
  const psql = (file: string) => execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
  const migration = new URL("../prisma/migrations/202610240001_inventory_taxonomy_warehouses/migration.sql", import.meta.url).pathname;

  try {
    await t.test("1) borrar un depósito mientras se mueve una unidad nunca deja unidades con warehouseId en NULL", async () => {
      for (let round = 0; round < 8; round++) {
        const org = await newOrg();
        const d1 = await addWarehouse(org, "D1", true);
        const d2 = await addWarehouse(org, "D2");
        const item = await addItem(org, "Copa", "Vajilla");
        await addUnit(org, item.id, `C-${round}-1`, d1.id);
        const [deleted, moved] = await Promise.all([
          db.$transaction((tx) => warehouses.deleteWarehouse(tx, org, d2.id)).catch((error: unknown) => ({ ok: false as const, status: 409 as const, error: String(error) })),
          db.$transaction((tx) => warehouses.moveUnitsBetweenWarehouses(tx, { organizationId: org, inventoryId: item.id, fromWarehouseId: d1.id, toWarehouseId: d2.id, quantity: 1 }))
            .catch((error: unknown) => ({ ok: false as const, status: 409 as const, error: String(error) })),
        ]);
        assert.equal(await db.inventoryUnit.count({ where: { organizationId: org, warehouseId: null } }), 0, `ronda ${round}: ninguna unidad queda sin depósito`);
        // O gana el movimiento (y el borrado se rechaza) o gana el borrado (y el movimiento no encuentra destino).
        assert.ok(!(deleted.ok && moved.ok), `ronda ${round}: no pueden ganar los dos`);
        assert.equal(await db.warehouse.count({ where: { id: d2.id } }), deleted.ok ? 0 : 1);
      }
    });

    await t.test("1b) la FK es RESTRICT: ni un DELETE directo deja la unidad huérfana", async () => {
      const org = await newOrg();
      const d1 = await addWarehouse(org, "D1", true);
      const d2 = await addWarehouse(org, "D2");
      const item = await addItem(org, "Copa", "Vajilla");
      const unit = await addUnit(org, item.id, "C-FK", d2.id);
      await assert.rejects(db.warehouse.delete({ where: { id: d2.id } }), (error: { code?: string }) => error.code === "P2003");
      assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).warehouseId, d2.id);
      void d1;
    });

    await t.test("2) mover devuelve las unidades realmente movidas y dos movimientos a la vez no se pisan", async () => {
      const org = await newOrg();
      const d1 = await addWarehouse(org, "D1", true);
      const d2 = await addWarehouse(org, "D2");
      const d3 = await addWarehouse(org, "D3");
      const item = await addItem(org, "Silla", "Sillas");
      await addUnit(org, item.id, "S-1", d1.id);
      await addUnit(org, item.id, "S-2", d1.id, "MAINTENANCE");
      const attempt = (to: string) =>
        db.$transaction((tx) => warehouses.moveUnitsBetweenWarehouses(tx, { organizationId: org, inventoryId: item.id, fromWarehouseId: d1.id, toWarehouseId: to, quantity: 1 }));
      const results = await Promise.all([attempt(d2.id), attempt(d3.id)]);
      const wins = results.filter((r) => r.ok);
      assert.equal(wins.length, 1, "hay una sola unidad disponible: gana un solo movimiento");
      assert.equal(wins[0]?.ok && wins[0].moved, 1);
      assert.equal(results.find((r) => !r.ok)?.ok, false);
      // La unidad en mantenimiento no se movió.
      assert.equal((await db.inventoryUnit.findFirstOrThrow({ where: { organizationId: org, code: "S-2" } })).warehouseId, d1.id);
      assert.equal(await db.inventoryUnit.count({ where: { organizationId: org, warehouseId: { in: [d2.id, d3.id] } } }), 1);
    });
    await t.test("3) la key del backfill SQL coincide con categoryKey del runtime en una lista de casos y el texto queda «Padre › Hija»", async () => {
      const org = await newOrg();
      const cases = [
        "Vajilla", "  vajilla  fina ", "Ñandú", "Cañón", "Pão de Açúcar", "Ação", "Über Café", "Crème Brûlée", "Żółć", "Žluťoučký kůň",
        "Ǻrhus", "Ấ Ế Ố", "Ớ Ừ Ữ", "Đà Nẵng", "Łódź", "Straße", "Ørsted", "Æon", "Çedilha", "Ĉapelo", "ÀÉÎÕÜ", "Cafe\u0301 nuevo",
      ];
      for (const [index, name] of cases.entries()) await addItem(org, `Prod ${index}`, name);
      await addItem(org, "Hija", "Música / Sonído");
      await addItem(org, "Hija 2", "Música > sonido");
      psql(migration);
      const rows = await db.inventoryCategory.findMany({ where: { organizationId: org }, include: { parent: true } });
      assert.ok(rows.length >= cases.length);
      for (const row of rows) {
        const expected = row.parent ? categoryPathKey(row.parent.name, row.name) : categoryKey(row.name);
        assert.equal(row.key, expected, `key de «${row.name}»`);
      }
      for (const name of cases) {
        const key = categoryKey(name.replace(/\s+/g, " ").trim());
        assert.ok(rows.some((row) => !row.parentId && row.key === key), `existe la categoría con key «${key}» (de «${name}»)`);
      }
      const musica = rows.filter((row) => row.parent?.key === "musica");
      assert.equal(musica.length, 1, "«Sonído» y «sonido» caen en la misma subcategoría");
      const texts = await db.inventoryItem.findMany({ where: { organizationId: org, name: { in: ["Hija", "Hija 2"] } }, select: { category: true } });
      assert.ok(texts.every((i) => i.category === "Música › Sonído" || i.category === "Música › sonido"), "espejo «Padre › Hija»");
      assert.equal(new Set(texts.map((i) => i.category)).size, 1, "los dos productos muestran el mismo texto");
      const before = await db.inventoryItem.findMany({ where: { organizationId: org }, select: { id: true, category: true }, orderBy: { id: "asc" } });
      psql(migration);
      assert.deepEqual(await db.inventoryItem.findMany({ where: { organizationId: org }, select: { id: true, category: true }, orderBy: { id: "asc" } }), before, "correrla de nuevo no cambia nada");
    });

    await t.test("4) asignar una categoría archivada la reactiva (por texto, por subcategoría y por id) y nunca queda un producto en una archivada", async () => {
      const org = await newOrg();
      const first = await db.$transaction((tx) => categories.resolveInventoryCategory(tx, org, { category: "Mobiliario", subcategory: "Sofás" }));
      assert.ok(first);
      const leaf = await db.inventoryCategory.findUniqueOrThrow({ where: { id: first.categoryId } });
      const archive = () => db.$transaction((tx) => categories.archiveInventoryCategory(tx, org, leaf.parentId!, true));
      await archive();
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org, archivedAt: { not: null } } }), 2, "padre e hija quedan archivadas");
      // Por texto: misma categoría (misma id, sin gemela) y activa.
      const again = await db.$transaction((tx) => categories.resolveInventoryCategory(tx, org, { category: "mobiliario ", subcategory: "SOFÁS" }));
      assert.equal(again?.categoryId, first.categoryId);
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org } }), 2, "no se crea una gemela");
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org, archivedAt: { not: null } } }), 0);
      // Por id.
      await archive();
      await db.$transaction((tx) => categories.resolveInventoryCategory(tx, org, { categoryId: first.categoryId }));
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org, archivedAt: { not: null } } }), 0, "elegir por id también la reactiva, con su padre");
      // Solo el padre archivado (hija activa): asignar la hija repara al padre.
      await db.inventoryCategory.update({ where: { id: leaf.parentId! }, data: { archivedAt: new Date() } });
      await db.$transaction((tx) => categories.resolveInventoryCategory(tx, org, { category: "Mobiliario / Sofás" }));
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org, archivedAt: { not: null } } }), 0);
    });

  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  }
  void categories;
});
