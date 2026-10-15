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
  const { categoryKey } = await import("../lib/inventory-categories");
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
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  }
  void categories; void categoryKey; void psql; void migration;
});
