import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/inventario-e1.pg.test.ts
test("Inventario E1 en PostgreSQL: categorías, depósitos, condición, compra, importación y demo", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const categories = await import("../lib/server/inventory-categories");
  const warehouses = await import("../lib/server/inventory-warehouses");
  const { createInventoryUnits, syncInventoryQuantity } = await import("../lib/server/inventory-units");
  const { readInventoryTrace } = await import("../lib/server/inventory-details");
  const { findSubstitutes } = await import("../lib/server/inventory-availability");
  const { applyCatalog, previewCatalog } = await import("../lib/server/import-catalog");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { resolvePublicCatalog, loadPublicCatalogItems } = await import("../lib/server/catalog-public");

  const orgs: string[] = [];
  const newOrg = async (label = "e1") => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: `Inventario E1 ${label}`, slug: `inv-e1-${id}` } });
    return id;
  };
  const addItem = (organizationId: string, name: string, category: string, extra: Record<string, unknown> = {}) =>
    db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name, category, quantity: 0, ...extra } });
  const resolve = (organizationId: string, input: Parameters<typeof categories.resolveInventoryCategory>[2]) =>
    db.$transaction((tx) => categories.resolveInventoryCategory(tx, organizationId, input));
  const psql = (file: string) => execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
  const migration = new URL("../prisma/migrations/202610240001_inventory_taxonomy_warehouses/migration.sql", import.meta.url).pathname;

  try {
    await t.test("1) backfill: «Vajilla», «vajilla » y «Sillas» dan 2 categorías por empresa, todo queda ligado y correrlo de nuevo no duplica", async () => {
      const a = await newOrg("a");
      const b = await newOrg("b");
      for (const org of [a, b]) {
        await addItem(org, "Copa", "Vajilla");
        await addItem(org, "Plato", "vajilla ");
        await addItem(org, "Silla", "Sillas");
      }
      await addItem(a, "Sofá", "Mobiliario / Sofás");
      await addItem(a, "Mesa", "Mobiliario > Mesas");
      await addItem(a, "Banqueta", "Mobiliario › Sofás");
      const sofa = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: a, name: "Sofá" } });
      // Unidades viejas, sin depósito (como estaban antes de la migración).
      await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: a, inventoryId: sofa.id, code: `SOF-${a.slice(0, 4)}`, status: "AVAILABLE" } });
      for (let pass = 0; pass < 2; pass++) {
        psql(migration);
        const counts = await db.inventoryCategory.groupBy({ by: ["organizationId"], where: { organizationId: { in: [a, b] } }, _count: { _all: true } });
        const byOrg = new Map(counts.map((c) => [c.organizationId, c._count._all]));
        assert.equal(byOrg.get(b), 2, `pasada ${pass + 1}: Vajilla y Sillas`);
        assert.equal(byOrg.get(a), 5, `pasada ${pass + 1}: Vajilla, Sillas, Mobiliario, Mobiliario/Sofás y Mobiliario/Mesas`);
        assert.equal(await db.inventoryItem.count({ where: { organizationId: { in: [a, b] }, categoryId: null } }), 0, "todos los productos quedan ligados");
      }
      const vajilla = await db.inventoryItem.findMany({ where: { organizationId: b, name: { in: ["Copa", "Plato"] } } });
      assert.equal(new Set(vajilla.map((i) => i.categoryId)).size, 1, "«Vajilla» y «vajilla » comparten categoría");
      const texts = await db.inventoryItem.findMany({ where: { organizationId: a }, select: { name: true, category: true } });
      assert.ok(!texts.some((i) => i.category === "vajilla " || i.category === "Mobiliario > Mesas"), "el texto se normaliza al espejo «Padre › Hija»");
      assert.ok(texts.some((i) => i.name === "Mesa" && i.category === "Mobiliario › Mesas"));
      const mesas = await db.inventoryCategory.findFirstOrThrow({ where: { organizationId: a, key: "mobiliario/mesas" }, include: { parent: true } });
      assert.equal(mesas.parent?.name, "Mobiliario");
      const sofas = await db.inventoryItem.findMany({ where: { organizationId: a, name: { in: ["Sofá", "Banqueta"] } } });
      assert.equal(new Set(sofas.map((i) => i.categoryId)).size, 1, "«/» y «›» caen en la misma subcategoría");
      // Depósitos: D1 solo donde hay unidades; la unidad vieja queda ahí.
      assert.equal(await db.warehouse.count({ where: { organizationId: a, code: "D1", isDefault: true } }), 1);
      assert.equal(await db.warehouse.count({ where: { organizationId: b } }), 0, "sin unidades no hay depósito");
      const unit = await db.inventoryUnit.findFirstOrThrow({ where: { organizationId: a }, include: { warehouse: true } });
      assert.equal(unit.warehouse?.code, "D1");
    });

    await t.test("resolver la misma categoría nueva en paralelo crea una sola fila (padre e hija)", async () => {
      const org = await newOrg("conc");
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => resolve(org, i % 2 ? { category: "Vajilla", subcategory: "Copas" } : { category: "vajilla ", subcategory: "copas" })));
      assert.equal(new Set(results.map((r) => r!.categoryId)).size, 1);
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org } }), 2, "Vajilla y Vajilla/Copas");
      assert.equal(results[0]!.text, "Vajilla › Copas".replace("Vajilla", results[0]!.parentName).replace("Copas", results[0]!.childName!));
    });

    await t.test("2) y 8) tenencia: ids de otra empresa son 404 en categorías, depósitos y proveedores", async () => {
      const a = await newOrg("tenA");
      const b = await newOrg("tenB");
      const catB = (await resolve(b, { category: "Vajilla" }))!;
      const supplierB = await db.supplier.create({ data: { id: randomUUID(), organizationId: b, name: "Proveedor B" } });
      const whB = await db.$transaction((tx) => warehouses.createWarehouse(tx, b, { name: "Depósito B", code: "DB" }));
      assert.ok(whB.ok);
      assert.equal(await resolve(a, { categoryId: catB.categoryId }), null, "categoría ajena");
      for (const op of [
        (tx: Parameters<typeof categories.renameInventoryCategory>[0]) => categories.renameInventoryCategory(tx, a, catB.categoryId, "Otro"),
        (tx: Parameters<typeof categories.renameInventoryCategory>[0]) => categories.moveInventoryCategory(tx, a, catB.categoryId, null),
        (tx: Parameters<typeof categories.renameInventoryCategory>[0]) => categories.archiveInventoryCategory(tx, a, catB.categoryId, true),
        (tx: Parameters<typeof categories.renameInventoryCategory>[0]) => categories.styleInventoryCategory(tx, a, catB.categoryId, { color: "ok" }),
      ]) {
        const result = await db.$transaction((tx) => op(tx));
        assert.deepEqual([result.ok, "status" in result ? result.status : 0], [false, 404]);
      }
      const own = (await resolve(a, { category: "Mesas" }))!;
      assert.deepEqual(await db.$transaction((tx) => categories.mergeInventoryCategories(tx, a, own.categoryId, catB.categoryId)).then((r) => [r.ok, "status" in r ? r.status : 0]), [false, 404]);
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: b } }), 1, "lo de B no se tocó");
      assert.equal(await warehouses.findUsableWarehouse(db, a, whB.ok ? whB.warehouse.id : ""), null, "depósito ajeno");
      for (const op of [
        (tx: Parameters<typeof warehouses.updateWarehouse>[0]) => warehouses.updateWarehouse(tx, a, whB.ok ? whB.warehouse.id : "", { name: "x" }),
        (tx: Parameters<typeof warehouses.updateWarehouse>[0]) => warehouses.setDefaultWarehouse(tx, a, whB.ok ? whB.warehouse.id : ""),
        (tx: Parameters<typeof warehouses.updateWarehouse>[0]) => warehouses.archiveWarehouse(tx, a, whB.ok ? whB.warehouse.id : "", true),
        (tx: Parameters<typeof warehouses.updateWarehouse>[0]) => warehouses.deleteWarehouse(tx, a, whB.ok ? whB.warehouse.id : ""),
      ]) {
        const result = await db.$transaction((tx) => op(tx));
        assert.deepEqual([result.ok, "status" in result ? result.status : 0], [false, 404]);
      }
      assert.equal(await db.warehouse.count({ where: { organizationId: b, code: "DB" } }), 1);
      // Proveedor y depósito ajenos en el alta/edición de producto o unidad.
      const supplier = await readInventoryTrace({ supplierId: supplierB.id }, { organizationId: a, allow: { warehouse: "unit", condition: true } });
      assert.deepEqual([supplier.ok, supplier.ok ? 0 : supplier.status], [false, 404]);
      const warehouse = await readInventoryTrace({ warehouseId: whB.ok ? whB.warehouse.id : "" }, { organizationId: a, allow: { warehouse: "unit" } });
      assert.deepEqual([warehouse.ok, warehouse.ok ? 0 : warehouse.status], [false, 404]);
      const mine = await readInventoryTrace({ supplierId: (await db.supplier.create({ data: { id: randomUUID(), organizationId: a, name: "Mío" } })).id }, { organizationId: a, allow: {} });
      assert.ok(mine.ok);
      // Listados acotados: B no ve nada de A.
      assert.deepEqual((await categories.listInventoryCategories(db, a)).map((c) => c.name), ["Mesas"]);
      assert.deepEqual((await warehouses.listWarehouses(db, a)).map((w) => w.code), []);
    });

    await t.test("3) renombrar «Sillas» → «Sillería» cambia el texto, la tienda y los sustitutos siguen por id", async () => {
      const org = await newOrg("rename");
      await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: true, publicShowPrices: true, depositPercent: 50 } });
      const cat = (await resolve(org, { category: "Sillas" }))!;
      const mk = async (name: string, quantity = 4) => {
        const item = await addItem(org, name, "Sillas", { catalogAudience: "RETAIL", visibleOnWeb: true, listPrice: 10_000 });
        await db.$transaction(async (tx) => {
          await tx.inventoryItem.update({ where: { id: item.id }, data: categories.categoryWriteData(cat) });
          await createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name, quantity });
        });
        return item;
      };
      const tiffany = await mk("Silla Tiffany");
      const crossback = await mk("Silla Crossback");
      const renamed = await db.$transaction((tx) => categories.renameInventoryCategory(tx, org, cat.categoryId, "Sillería"));
      assert.deepEqual(renamed, { ok: true, before: "Sillas", after: "Sillería" });
      const rows = await db.inventoryItem.findMany({ where: { organizationId: org }, select: { category: true, categoryId: true } });
      assert.deepEqual([...new Set(rows.map((r) => r.category))], ["Sillería"]);
      assert.equal(new Set(rows.map((r) => r.categoryId)).size, 1);
      const context = await resolvePublicCatalog(`inv-e1-${org}`);
      assert.ok(context);
      const shop = await loadPublicCatalogItems(context!, null);
      assert.deepEqual([...new Set(shop.map((i) => i.category))], ["Sillería"], "la tienda muestra el nombre nuevo");
      const current = await db.inventoryItem.findFirstOrThrow({ where: { id: tiffany.id } });
      const subs = await findSubstitutes({ organizationId: org, item: { id: current.id, category: current.category, categoryId: current.categoryId, status: current.status }, startsAt: new Date(Date.UTC(2032, 0, 10)), endsAt: new Date(Date.UTC(2032, 0, 11)) });
      assert.deepEqual(subs.map((s) => s.id), [crossback.id], "sustitutos por categoría, también tras renombrar");
      // Renombrar al nombre de otra categoría ya existente es un conflicto, no un duplicado.
      await resolve(org, { category: "Mesas" });
      const clash = await db.$transaction((tx) => categories.renameInventoryCategory(tx, org, cat.categoryId, "mesas"));
      assert.deepEqual([clash.ok, "status" in clash ? clash.status : 0], [false, 409]);
      // Mover una subcategoría reescribe el espejo; unir mueve los productos.
      const copas = (await resolve(org, { category: "Sillería", subcategory: "Plegables" }))!;
      await db.inventoryItem.update({ where: { id: crossback.id }, data: categories.categoryWriteData(copas) });
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: crossback.id } })).category, "Sillería › Plegables");
      const mesas = (await resolve(org, { category: "Mesas" }))!;
      const moved = await db.$transaction((tx) => categories.moveInventoryCategory(tx, org, copas.categoryId, mesas.categoryId));
      assert.ok(moved.ok);
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: crossback.id } })).category, "Mesas › Plegables");
      const merged = await db.$transaction((tx) => categories.mergeInventoryCategories(tx, org, copas.categoryId, cat.categoryId));
      assert.deepEqual(merged, { ok: true, moved: 1 });
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: crossback.id } })).category, "Sillería");
      assert.equal(await db.inventoryCategory.count({ where: { id: copas.categoryId } }), 0);
      const nested = await db.$transaction((tx) => categories.moveInventoryCategory(tx, org, mesas.categoryId, cat.categoryId));
      assert.ok(nested.ok, "una categoría sin hijas puede pasar a ser hija");
      const deep = (await resolve(org, { category: "Otra", subcategory: "Hija" }))!;
      const target = (await resolve(org, { category: "Sillería", subcategory: "Mesas" }))!;
      const tooDeep = await db.$transaction((tx) => categories.moveInventoryCategory(tx, org, deep.categoryId, target.categoryId));
      assert.deepEqual([tooDeep.ok, "status" in tooDeep ? tooDeep.status : 0], [false, 409], "un solo nivel de subcategoría");
    });

    await t.test("5) todas las unidades quedan en D1; «mover 120 a D2» deja 120 en D2 y la cantidad igual", async () => {
      const org = await newOrg("move");
      const item = await addItem(org, "Copa de agua", "Vajilla");
      await db.$transaction(async (tx) => {
        await createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 200 });
      });
      const d1 = await db.warehouse.findFirstOrThrow({ where: { organizationId: org, isDefault: true } });
      assert.equal(d1.code, "D1");
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id, warehouseId: d1.id } }), 200);
      const d2 = await db.$transaction((tx) => warehouses.createWarehouse(tx, org, { name: "Depósito Norte", code: "d2" }));
      assert.ok(d2.ok && d2.warehouse.code === "D2");
      const before = await db.inventoryItem.findFirstOrThrow({ where: { id: item.id } });
      assert.equal(before.quantity, 200);
      const moved = await db.$transaction(async (tx) => {
        const result = await warehouses.moveUnitsBetweenWarehouses(tx, { organizationId: org, inventoryId: item.id, fromWarehouseId: d1.id, toWarehouseId: d2.ok ? d2.warehouse.id : "", quantity: 120, location: "E3-B2" });
        await syncInventoryQuantity(tx, item.id);
        return result;
      });
      assert.deepEqual(moved, { ok: true, moved: 120 });
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id, warehouse: { code: "D2" }, location: "E3-B2" } }), 120);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id, warehouse: { code: "D1" } } }), 80);
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: item.id } })).quantity, 200, "`quantity` no cambia");
      // El stock por depósito es un groupBy de unidades: suma exactamente `quantity`.
      const grouped = await db.inventoryUnit.groupBy({ by: ["warehouseId"], where: { inventoryId: item.id, status: { not: "RETIRED" } }, _count: { _all: true } });
      assert.equal(grouped.reduce((sum, g) => sum + g._count._all, 0), 200);
      // No se puede mover lo que no está disponible, ni más de lo que hay.
      await db.inventoryUnit.updateMany({ where: { inventoryId: item.id, warehouseId: d1.id }, data: { status: "MAINTENANCE" } });
      const none = await db.$transaction((tx) => warehouses.moveUnitsBetweenWarehouses(tx, { organizationId: org, inventoryId: item.id, fromWarehouseId: d1.id, toWarehouseId: d2.ok ? d2.warehouse.id : "", quantity: 1 }));
      assert.deepEqual([none.ok, "status" in none ? none.status : 0], [false, 409]);
      // Archivar: el principal no se archiva; con unidades no se borra (409).
      const archiveMain = await db.$transaction((tx) => warehouses.archiveWarehouse(tx, org, d1.id, true));
      assert.deepEqual([archiveMain.ok, "status" in archiveMain ? archiveMain.status : 0], [false, 409]);
      const removeWithUnits = await db.$transaction((tx) => warehouses.deleteWarehouse(tx, org, d2.ok ? d2.warehouse.id : ""));
      assert.deepEqual([removeWithUnits.ok, "status" in removeWithUnits ? removeWithUnits.status : 0], [false, 409]);
      const dup = await db.$transaction((tx) => warehouses.createWarehouse(tx, org, { name: "Otro", code: "D2" }));
      assert.deepEqual([dup.ok, "status" in dup ? dup.status : 0], [false, 409]);
      const archived = await db.$transaction((tx) => warehouses.archiveWarehouse(tx, org, d2.ok ? d2.warehouse.id : "", true));
      assert.ok(archived.ok);
      assert.equal(await warehouses.findUsableWarehouse(db, org, d2.ok ? d2.warehouse.id : ""), null, "un depósito archivado no recibe unidades nuevas");
      const switched = await db.$transaction(async (tx) => {
        const created = await warehouses.createWarehouse(tx, org, { name: "Central", code: "C1" });
        return created.ok ? warehouses.setDefaultWarehouse(tx, org, created.warehouse.id) : created;
      });
      assert.ok(switched.ok);
      assert.equal(await db.warehouse.count({ where: { organizationId: org, isDefault: true } }), 1, "un solo principal");
    });

    await t.test("6) y 7) ubicación normalizada y condición 1–10 también en la base (CHECK)", async () => {
      const org = await newOrg("cond");
      const item = await addItem(org, "Mesa", "Mobiliario");
      await db.$transaction((tx) => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 2, location: "E3-B2", conditionScore: 8, purchaseCost: 150_000 }));
      const unit = await db.inventoryUnit.findFirstOrThrow({ where: { inventoryId: item.id }, include: { warehouse: true } });
      assert.equal(`${unit.warehouse!.code}-${unit.location}`, "D1-E3-B2");
      assert.equal(unit.conditionScore, 8);
      assert.equal(unit.purchaseCost, 150_000);
      for (const bad of [0, 11]) {
        await assert.rejects(() => db.inventoryUnit.update({ where: { id: unit.id }, data: { conditionScore: bad } }), /check constraint|conditionScore/i, `condición ${bad}`);
      }
      assert.equal((await db.inventoryUnit.findFirstOrThrow({ where: { id: unit.id } })).conditionScore, 8);
      await db.inventoryUnit.update({ where: { id: unit.id }, data: { conditionScore: null } });
    });

    await t.test("«Registrar compra»: unidades nuevas con proveedor, fecha, costo, garantía y depósito, sin tocar las existentes", async () => {
      const org = await newOrg("buy");
      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Vajillas SA" } });
      const item = await addItem(org, "Plato playo", "Vajilla");
      await db.$transaction((tx) => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 10 }));
      const d2 = await db.$transaction((tx) => warehouses.createWarehouse(tx, org, { name: "Norte", code: "D2" }));
      const purchasedAt = new Date("2026-10-01T03:00:00Z");
      const warrantyUntil = new Date("2027-10-01T03:00:00Z");
      await db.$transaction((tx) => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 5, purchaseCost: 4_500, supplierId: supplier.id, purchasedAt, warrantyUntil, warehouseId: d2.ok ? d2.warehouse.id : undefined, location: "A1", conditionScore: 10 }));
      const fresh = await db.inventoryUnit.findMany({ where: { inventoryId: item.id, supplierId: supplier.id } });
      assert.equal(fresh.length, 5);
      assert.ok(fresh.every((u) => u.purchaseCost === 4_500 && u.location === "A1" && u.conditionScore === 10 && u.warrantyUntil?.getTime() === warrantyUntil.getTime()));
      assert.equal(new Set(fresh.map((u) => u.code)).size, 5, "códigos únicos");
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: item.id } })).quantity, 15);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: item.id, supplierId: null, purchaseCost: 0 } }), 10, "las unidades anteriores no cambian");
    });

    await t.test("4) importar «Mobiliario / Sofás» y categoria «Vajilla» + subcategoria «Copas» asocia padre e hija sin duplicar, y respeta depósito y ubicación", async () => {
      const org = await newOrg("import");
      const ctx = portalAuditContext(org, "Importador QA");
      await db.$transaction((tx) => warehouses.ensureDefaultWarehouse(tx, org));
      const d2 = await db.$transaction((tx) => warehouses.createWarehouse(tx, org, { name: "Depósito Norte", code: "D2" }));
      assert.ok(d2.ok);
      const catalog = (extra: Array<Record<string, unknown>> = []) => {
        const parsed = normalizeCatalog({
          productos: [
            { codigo: "10", nombre: "Copa de vino", categoria: "Vajilla", subcategoria: "Copas", cantidad: 12, precio: 3000 },
            { codigo: "11", nombre: "Copa de agua", categoria: "vajilla ", subcategoria: "copas", cantidad: 6, precio: 2500, deposito: "d2", ubicacion: "d2 e3 b2" },
            { codigo: "20", nombre: "Sillón Oslo", categoria: "Mobiliario / Sofás", cantidad: 2, precio: 90000 },
            { codigo: "21", nombre: "Sofá Milán", categoria: "Mobiliario", subcategoria: "Sofás", cantidad: 1, precio: 120000 },
            { codigo: "30", nombre: "Mantel", categoria: "Textil", cantidad: 3, deposito: "ZZ9" },
            ...extra,
          ],
        });
        assert.ok(parsed.ok);
        return { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [] };
      };
      const preview = await previewCatalog(org, catalog());
      assert.ok(preview.problems.some((p) => p.tipo === "deposito-inexistente" && p.codigo === "30"));
      for (let pass = 0; pass < 2; pass++) {
        const result = await applyCatalog(ctx, { ...catalog(), lote: randomUUID() });
        assert.deepEqual(result.fallidos, [], `pasada ${pass + 1}`);
        const cats = await db.inventoryCategory.findMany({ where: { organizationId: org }, orderBy: { key: "asc" } });
        assert.deepEqual(cats.map((c) => c.key), ["mobiliario", "mobiliario/sofas", "textil", "vajilla", "vajilla/copas"], `pasada ${pass + 1}: sin duplicar`);
      }
      const items = await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" } });
      assert.deepEqual(items.map((i) => [i.sku, i.category]), [["10", "Vajilla › Copas"], ["11", "Vajilla › Copas"], ["20", "Mobiliario › Sofás"], ["21", "Mobiliario › Sofás"], ["30", "Textil"]]);
      assert.equal(new Set([items[0].categoryId, items[1].categoryId]).size, 1);
      assert.equal(new Set([items[2].categoryId, items[3].categoryId]).size, 1);
      const parent = await db.inventoryCategory.findFirstOrThrow({ where: { organizationId: org, key: "vajilla/copas" }, include: { parent: true } });
      assert.equal(parent.parent?.name, "Vajilla");
      assert.equal(items.every((i) => i.quantity > 0), true);
      const copa = await db.inventoryUnit.findMany({ where: { inventoryId: items[1].id }, include: { warehouse: true } });
      assert.equal(copa.length, 6);
      assert.ok(copa.every((u) => u.warehouse?.code === "D2" && u.location === "E3-B2"), "depósito D2 y ubicación normalizada");
      const manteles = await db.inventoryUnit.findMany({ where: { inventoryId: items[4].id }, include: { warehouse: true } });
      assert.ok(manteles.every((u) => u.warehouse?.code === "D1" && u.location === null), "un depósito que no existe cae en el principal");
      // Re-importar con más cantidad completa unidades en el depósito pedido y no duplica productos.
      const bigger = catalog();
      const again = await applyCatalog(ctx, { ...bigger, products: bigger.products.map((p) => (p.codigo === "11" ? { ...p, cantidad: 8 } : p)), lote: randomUUID() });
      assert.deepEqual(again.fallidos, []);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: org } }), 5);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: items[1].id, warehouse: { code: "D2" } } }), 8);
    });

    await t.test("10) la demo carga completa: categorías con subcategorías, dos depósitos, condición y compras", async () => {
      const { ensureDemoData } = await import("../lib/server/demo-data");
      const target = await ensureDemoData({ reset: true });
      const org = { id: target.organizationId };
      const items = await db.inventoryItem.findMany({ where: { organizationId: org.id }, include: { _count: { select: { components: true } } } });
      assert.ok(items.length > 20);
      assert.equal(items.filter((i) => !i.categoryId).length, 0, "todo producto ligado a una categoría");
      const cats = await db.inventoryCategory.findMany({ where: { organizationId: org.id } });
      assert.ok(cats.some((c) => c.parentId), "hay subcategorías");
      const sound = items.filter((i) => i.category.startsWith("Sonido"));
      assert.ok(sound.length >= 3 && sound.every((i) => i.category.includes(" › ") || i.category === "Sonido"));
      const whs = await db.warehouse.findMany({ where: { organizationId: org.id } });
      assert.deepEqual(whs.map((w) => w.code).sort(), ["D1", "D2"]);
      assert.equal(whs.filter((w) => w.isDefault).length, 1);
      const units = await db.inventoryUnit.findMany({ where: { organizationId: org.id } });
      assert.ok(units.length > 50);
      assert.equal(units.filter((u) => !u.warehouseId).length, 0, "toda unidad tiene depósito");
      assert.ok(units.every((u) => u.conditionScore === null || (u.conditionScore >= 1 && u.conditionScore <= 10)));
      assert.ok(units.some((u) => u.conditionScore !== null) && units.some((u) => u.location));
      assert.ok(items.some((i) => i.supplierId && i.warrantyUntil), "hay compras con garantía");
      // `quantity` = unidades activas, también con los depósitos.
      for (const item of items.filter((i) => i._count.components === 0)) {
        assert.equal(item.quantity, units.filter((u) => u.inventoryId === item.id && u.status !== "RETIRED").length, item.name);
      }
      // Cargarla de nuevo (reset) no deja huérfanos ni duplicados.
      await ensureDemoData({ reset: true });
      assert.equal(await db.warehouse.count({ where: { organizationId: org.id } }), 2);
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: org.id, key: "sonido" } }), 1);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch((error) => console.error("[inventario-e1] limpieza:", error instanceof Error ? error.message : error));
    await db.$disconnect();
  }
});
