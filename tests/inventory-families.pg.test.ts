import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/inventory-families.pg.test.ts
test("Familias de variantes en PostgreSQL: migración, agrupar, concurrencia, aislamiento, precios, presupuesto y papelera", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const families = await import("../lib/server/inventory-families");
  const { createInventoryUnits } = await import("../lib/server/inventory-units");
  const { replacePriceTiers } = await import("../lib/server/price-tier-store");
  const { checkStockBeforeApproval } = await import("../lib/server/approval-stock");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { findSubstitutes } = await import("../lib/server/inventory-availability");

  const orgs: string[] = [];
  const newOrg = async (label: string) => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: `Familias ${label}`, slug: `fam-${id}` } });
    return id;
  };
  const addItem = async (organizationId: string, name: string, units: number, extra: Record<string, unknown> = {}) => {
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name, category: "Vajilla", quantity: 0, ...extra } });
    if (units > 0) await db.$transaction((tx) => createInventoryUnits(tx, { organizationId, inventoryId: item.id, name: `${name.slice(0, 3)}${randomUUID().slice(0, 4)}`, quantity: units }));
    return db.inventoryItem.findFirstOrThrow({ where: { id: item.id } });
  };
  const run = <T>(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) => db.$transaction(fn, { timeout: 20_000 });
  const COLOR = [{ label: "Color", values: [{ value: "Verde", swatch: "#4B6B3A" }, { value: "Lila", swatch: "#9B7BB8" }] }];

  try {
    await t.test("1) la migración corre dos veces sobre una base con datos sin error y sin tocar nada", async () => {
      const org = await newOrg("mig");
      const copa = await addItem(org, "Copa vieja", 3, { listPrice: 5000 });
      const file = new URL("../prisma/migrations/202611010001_inventory_families/migration.sql", import.meta.url).pathname;
      for (let pass = 0; pass < 2; pass++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
      const after = await db.inventoryItem.findFirstOrThrow({ where: { id: copa.id } });
      assert.equal(after.quantity, 3);
      assert.equal(after.listPrice, 5000);
      assert.equal(after.familyId, null);
      assert.equal(after.variantOwnPrice, false);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: copa.id } }), 3);
    });

    await t.test("2) agrupar el plato verde y el lila: nombres «Plato Arabesco · Verde/Lila»; unidades, reservas y precios no cambian", async () => {
      const org = await newOrg("agrupar");
      const verde = await addItem(org, "Plato Arabesco Verde", 4, { sku: "PV", listPrice: 6000, wholesalePrice: 4500 });
      const lila = await addItem(org, "Plato Arabesco Lila", 5, { sku: "PL", listPrice: 6000, wholesalePrice: 4500 });
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda", setupAt: new Date(Date.UTC(2034, 0, 10)), startsAt: new Date(Date.UTC(2034, 0, 11)), endsAt: new Date(Date.UTC(2034, 0, 12)), strikeAt: new Date(Date.UTC(2034, 0, 13)), status: "CONFIRMED" } });
      await db.eventInventory.create({ data: { id: randomUUID(), eventId: event.id, inventoryId: verde.id, quantity: 2 } });
      await replacePriceTiers(db, org, verde.id, [{ audience: "RETAIL", fromDays: 3, mode: "TOTAL", price: 15000 }] as never);
      const snapshot = async () => ({
        units: await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { code: "asc" }, select: { code: true, inventoryId: true, status: true } }),
        reservas: await db.eventInventory.findMany({ where: { event: { organizationId: org } }, select: { inventoryId: true, quantity: true } }),
        precios: (await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" }, select: { sku: true, listPrice: true, wholesalePrice: true, quantity: true } })),
        escalones: await db.inventoryPriceTier.findMany({ where: { organizationId: org }, select: { inventoryId: true, price: true, fromDays: true } }),
      });
      const before = await snapshot();
      const created = await run((tx) =>
        families.createFamily(tx, org, { name: "Plato Arabesco", axes: COLOR, members: [{ itemId: verde.id, options: { color: "Verde" } }, { itemId: lila.id, options: { color: "Lila" } }] }),
      );
      assert.ok(created.ok, created.ok ? "" : created.error);
      assert.equal(created.renamed.length, 2);
      const names = (await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" } })).map((i) => i.name);
      assert.deepEqual(names, ["Plato Arabesco · Lila", "Plato Arabesco · Verde"]);
      const family = await db.inventoryFamily.findFirstOrThrow({ where: { organizationId: org } });
      assert.equal(family.code, "PLATO-ARABESCO");
      assert.deepEqual(await snapshot(), before, "unidades, reservas, precios y escalones idénticos antes y después");
      const rows = await db.inventoryItem.findMany({ where: { organizationId: org }, select: { variantKey: true, variantOwnPrice: true } });
      assert.deepEqual(rows.map((r) => r.variantKey).sort(), ["color=lila", "color=verde"]);
      assert.deepEqual(rows.map((r) => r.variantOwnPrice), [false, false], "mismo precio: ninguno tiene precio propio");
    });

    await t.test("3) dos altas simultáneas de «Verde»: una gana (201) y la otra recibe 409; lo mismo con dos familias de igual código", async () => {
      const org = await newOrg("carrera");
      const lila = await addItem(org, "Taza Lila", 1, { sku: "T-LIL" });
      const created: Awaited<ReturnType<typeof families.createFamily>> = await run((tx) => families.createFamily(tx, org, { name: "Taza", axes: [{ label: "Color", values: ["Lila"] }], members: [{ itemId: lila.id, options: { color: "Lila" } }] }));
      assert.ok(created.ok);
      const familyId: string = created.familyId;
      for (let round = 0; round < 3; round++) {
        const color = `Verde${round}`;
        const results: Array<{ ok: boolean; status?: number }> = await Promise.all(
          [1, 2].map((n): Promise<{ ok: boolean; status?: number }> => run((tx) => families.addNewVariant(tx, org, familyId, { options: { color }, sku: `T-V${round}-${n}`, quantity: 1 }))),
        );
        assert.deepEqual(results.map((r: { ok: boolean; status?: number }) => (r.ok ? 201 : r.status)).sort(), [201, 409], `ronda ${round}: ${JSON.stringify(results)}`);
        assert.equal(await db.inventoryItem.count({ where: { organizationId: org, familyId, variantKey: `color=${color.toLowerCase()}` } }), 1);
      }
      const a = await addItem(org, "Jarra A", 1);
      const b = await addItem(org, "Jarra B", 1);
      const dup = await Promise.all(
        [a, b].map((item) => run((tx) => families.createFamily(tx, org, { name: "Jarra", code: "JARRA", axes: [{ label: "Color", values: ["Rojo"] }], members: [{ itemId: item.id, options: { color: "Rojo" } }] }))),
      );
      assert.deepEqual(dup.map((r: { ok: boolean; status?: number }) => (r.ok ? 201 : r.status)).sort(), [201, 409]);
    });

    await t.test("un producto no puede agruparse simultáneamente en dos familias distintas", async () => {
      const org = await newOrg("producto-dos-familias");
      const item = await addItem(org, "Silla suelta", 1, { sku: "SUELTA" });
      const results = await Promise.all(["FA", "FB"].map((code) => run((tx) => families.createFamily(tx, org, {
        name: `Familia ${code}`, code, axes: [{ label: "Color", values: ["Rojo"] }], members: [{ itemId: item.id, options: { color: "Rojo" } }],
      }))));
      assert.deepEqual(results.map((r) => r.ok ? 201 : r.status).sort(), [201, 409]);
      const winner = results.find((r) => r.ok)!;
      assert.ok(winner.ok);
      assert.equal(await db.inventoryFamily.count({ where: { organizationId: org } }), 1, "el perdedor no deja una familia vacía");
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: item.id } })).familyId, winner.familyId);
    });

    await t.test("agregar el mismo producto suelto a dos familias simultáneamente conserva un solo dueño", async () => {
      const org = await newOrg("agregar-dos-familias");
      const familyIds: string[] = [];
      for (const code of ["FA", "FB"]) {
        const seed = await addItem(org, `Silla base ${code}`, 1, { sku: `BASE-${code}` });
        const family = await run((tx) => families.createFamily(tx, org, { name: `Familia ${code}`, code, axes: [{ label: "Color", values: ["Rojo", "Azul"] }], members: [{ itemId: seed.id, options: { color: "Rojo" } }] }));
        assert.ok(family.ok);
        familyIds.push(family.familyId);
      }
      const item = await addItem(org, "Silla azul suelta", 1, { sku: "AZUL" });
      const results = await Promise.all(familyIds.map((familyId) => run((tx) => families.addExistingVariants(tx, org, familyId, [{ itemId: item.id, options: { color: "Azul" } }]))));
      assert.deepEqual(results.map((r) => r.ok ? 200 : r.status).sort(), [200, 409]);
      const winner = results.find((r) => r.ok)!;
      assert.ok(winner.ok);
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: item.id } })).familyId, winner.familyId);
      const counts = await db.inventoryFamily.findMany({ where: { organizationId: org }, select: { _count: { select: { items: true } } } });
      assert.deepEqual(counts.map((r) => r._count.items).sort(), [1, 2]);
    });

    await t.test("4) aislamiento: familia o ítem de la empresa B usados desde A responden 404 (y nunca se ven)", async () => {
      const a = await newOrg("aislamiento-a");
      const b = await newOrg("aislamiento-b");
      const itemB = await addItem(b, "Vaso B", 2, { sku: "VB" });
      const itemB2 = await addItem(b, "Vaso B2", 2, { sku: "VB2" });
      const famB = await run((tx) => families.createFamily(tx, b, { name: "Vaso", axes: [{ label: "Color", values: ["Azul"] }], members: [{ itemId: itemB.id, options: { color: "Azul" } }] }));
      assert.ok(famB.ok);
      const itemA = await addItem(a, "Vaso A", 1, { sku: "VA" });
      const failStatus = (result: { ok: boolean; status?: number }) => (result.ok ? 200 : result.status);

      assert.equal(await families.getFamilyView(db, a, famB.familyId), null, "no se lee");
      assert.equal(failStatus(await run((tx) => families.updateFamily(tx, a, famB.familyId, { name: "Hackeada" }))), 404);
      assert.equal(failStatus(await run((tx) => families.addNewVariant(tx, a, famB.familyId, { options: { color: "Rojo" }, sku: "X-1" }))), 404);
      assert.equal(failStatus(await run((tx) => families.addExistingVariants(tx, a, famB.familyId, [{ itemId: itemA.id, options: { color: "Rojo" } }]))), 404);
      assert.equal(failStatus(await run((tx) => families.unlinkVariant(tx, a, famB.familyId, itemB.id))), 404);
      assert.equal(failStatus(await run((tx) => families.applySamePrice(tx, a, famB.familyId, itemB.id))), 404);
      assert.equal(failStatus(await run((tx) => families.trashFamily(tx, a, famB.familyId, null, null))), 404);
      // Un ítem ajeno al agrupar o al sumar a una familia propia.
      assert.equal(failStatus(await run((tx) => families.createFamily(tx, a, { name: "Mezcla", axes: [{ label: "Color", values: ["Azul"] }], members: [{ itemId: itemB2.id, options: { color: "Azul" } }] }))), 404);
      const famA = await run((tx) => families.createFamily(tx, a, { name: "Vaso A", axes: [{ label: "Color", values: ["Azul"] }], members: [{ itemId: itemA.id, options: { color: "Azul" } }] }));
      assert.ok(famA.ok);
      assert.equal(failStatus(await run((tx) => families.addExistingVariants(tx, a, famA.familyId, [{ itemId: itemB2.id, options: { color: "Rojo" } }]))), 404);
      assert.equal(failStatus(await run((tx) => families.updateFamily(tx, a, famA.familyId, { coverItemId: itemB.id }))), 404, "portada ajena");
      assert.equal(failStatus(await run((tx) => families.addNewVariant(tx, a, famA.familyId, { options: { color: "Rojo" }, sku: "X-2", templateItemId: itemB.id }))), 404, "variante de referencia ajena");
      // Nada de B cambió.
      const b2 = await db.inventoryItem.findFirstOrThrow({ where: { id: itemB.id } });
      assert.equal(b2.name, "Vaso · Azul");
      assert.equal(b2.familyId, famB.familyId);
      assert.equal((await db.inventoryFamily.findFirstOrThrow({ where: { id: famB.familyId } })).name, "Vaso");
      assert.equal(await db.inventoryItem.count({ where: { organizationId: b, familyId: famB.familyId } }), 1);
      // El listado de A no trae familias de B.
      assert.deepEqual((await families.listFamilyViews(db, a)).map((f) => f.id), [famA.familyId]);
    });

    await t.test("5) «Mismo precio para todas» actualiza solo las variantes sin precio propio, escalones incluidos", async () => {
      const org = await newOrg("precio");
      const base = await addItem(org, "Silla Base", 2, { sku: "S-BASE", listPrice: 10000, wholesalePrice: 8000, minimumPrice: 7000, billingUnit: "EVENT" });
      await replacePriceTiers(db, org, base.id, [{ audience: "RETAIL", fromDays: 2, mode: "TOTAL", price: 18000 }] as never);
      const propia = await addItem(org, "Silla Propia", 2, { sku: "S-PROP", listPrice: 99000 });
      const sinPropio = await addItem(org, "Silla Otra", 2, { sku: "S-OTRA", listPrice: 1 });
      const created = await run((tx) =>
        families.createFamily(tx, org, { name: "Silla", axes: [{ label: "Color", values: ["Base", "Propia", "Otra"] }], members: [{ itemId: base.id, options: { color: "Base" } }, { itemId: propia.id, options: { color: "Propia" } }, { itemId: sinPropio.id, options: { color: "Otra" } }] }),
      );
      assert.ok(created.ok);
      // Al agrupar, los precios distintos al primero quedan como propios; la persona deja «Otra» sin precio propio.
      await db.inventoryItem.update({ where: { id: sinPropio.id }, data: { variantOwnPrice: false } });
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: propia.id } })).variantOwnPrice, true);
      const applied = await run((tx) => families.applySamePrice(tx, org, created.familyId, base.id));
      assert.ok(applied.ok);
      assert.deepEqual(applied.updatedIds, [sinPropio.id]);
      const otra = await db.inventoryItem.findFirstOrThrow({ where: { id: sinPropio.id } });
      assert.deepEqual([otra.listPrice, otra.wholesalePrice, otra.minimumPrice, otra.billingUnit], [10000, 8000, 7000, "EVENT"]);
      assert.deepEqual((await db.inventoryPriceTier.findMany({ where: { inventoryId: sinPropio.id } })).map((tier) => [tier.fromDays, tier.price]), [[2, 18000]], "escalones copiados");
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: propia.id } })).listPrice, 99000, "el de precio propio no se pisa");
      // La edición manual de precios marca el precio como propio.
      await run((tx) => families.markOwnPrice(tx, org, [sinPropio.id]));
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: sinPropio.id } })).variantOwnPrice, true);
    });

    await t.test("6) renombrar la familia cambia el nombre de las variantes; el presupuesto ya creado conserva el nombre viejo", async () => {
      const org = await newOrg("renombrar");
      const v = await addItem(org, "Mantel Verde", 2, { sku: "M-V" });
      const l = await addItem(org, "Mantel Lila", 2, { sku: "M-L" });
      const created = await run((tx) => families.createFamily(tx, org, { name: "Mantel", axes: COLOR, members: [{ itemId: v.id, options: { color: "Verde" } }, { itemId: l.id, options: { color: "Lila" } }] }));
      assert.ok(created.ok);
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "C" } });
      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "P", status: "DRAFT", subtotal: 1, total: 1 } });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Mantel · Verde", quantity: 1, days: 1, unitPrice: 1, subtotal: 1, inventoryId: v.id } });
      const updated = await run((tx) => families.updateFamily(tx, org, created.familyId, { name: "Mantel Premium" }));
      assert.ok(updated.ok);
      assert.deepEqual((await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" } })).map((i) => i.name), ["Mantel Premium · Lila", "Mantel Premium · Verde"]);
      assert.equal((await db.budgetItem.findFirstOrThrow({ where: { budgetId: budget.id } })).name, "Mantel · Verde", "snapshot del presupuesto");
      // Un valor nuevo de eje y la categoría también se propagan.
      const cat = await db.inventoryCategory.create({ data: { id: randomUUID(), organizationId: org, name: "Textil", key: "textil" } });
      const moved = await run((tx) => families.updateFamily(tx, org, created.familyId, { categoryId: cat.id }));
      assert.ok(moved.ok);
      for (const item of await db.inventoryItem.findMany({ where: { organizationId: org } })) {
        assert.equal(item.categoryId, cat.id);
        assert.equal(item.category, "Textil");
      }
      // No se puede quitar un valor que una variante usa.
      const removing = await run((tx) => families.updateFamily(tx, org, created.familyId, { axes: [{ label: "Color", values: ["Verde"] }] }));
      assert.equal(removing.ok, false);
    });

    await t.test("7) presupuesto con «Zapato Ola · Negro · 35» ×2 reserva solo esa variante; sin stock la aprobación frena y propone «Blanco · 35»", async () => {
      const org = await newOrg("presupuesto");
      const ctx = portalAuditContext(org, "Equipo");
      const mk = (name: string, units: number, sku: string) => addItem(org, name, units, { sku, category: "Calzado", listPrice: 70000 });
      const n35 = await mk("Zapato Ola Negro 35", 2, "Z-N35");
      const n36 = await mk("Zapato Ola Negro 36", 2, "Z-N36");
      const b35 = await mk("Zapato Ola Blanco 35", 3, "Z-B35");
      const created = await run((tx) =>
        families.createFamily(tx, org, {
          name: "Zapato Ola",
          axes: [{ label: "Color", values: ["Negro", "Blanco"] }, { label: "Talle", values: ["35", "36"] }],
          members: [{ itemId: n35.id, options: { color: "Negro", talle: "35" } }, { itemId: n36.id, options: { color: "Negro", talle: "36" } }, { itemId: b35.id, options: { color: "Blanco", talle: "35" } }],
        }),
      );
      assert.ok(created.ok);
      assert.equal((await db.inventoryItem.findFirstOrThrow({ where: { id: n35.id } })).name, "Zapato Ola · Negro · 35");
      const day = (n: number) => new Date(Date.UTC(2035, 0, n, 12));
      const scenario = async (label: string) => {
        const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: `Cliente ${label}` } });
        const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: `Evento ${label}`, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), status: "CONFIRMED" } });
        const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: `P ${label}`, status: "SENT", subtotal: 1, total: 1 } });
        await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Zapato Ola · Negro · 35", quantity: 2, days: 1, unitPrice: 70000, subtotal: 140000, inventoryId: n35.id } });
        return { budget, event };
      };
      const first = await scenario("A");
      const gate = await checkStockBeforeApproval({ organizationId: org, budgetId: first.budget.id, context: ctx });
      assert.equal(gate.ok, true);
      const reserved = await db.eventInventory.findMany({ where: { eventId: first.event.id } });
      assert.deepEqual(reserved.map((r) => [r.inventoryId, r.quantity]), [[n35.id, 2]], "reserva solo la variante pedida");
      const second = await scenario("B");
      const blocked = await checkStockBeforeApproval({ organizationId: org, budgetId: second.budget.id, context: ctx });
      assert.equal(blocked.ok, false);
      const substitutes = !blocked.ok ? blocked.reservation.outcomes.flatMap((o) => o.substitutes) : [];
      assert.equal(substitutes[0]?.name, "Zapato Ola · Blanco · 35", "la hermana sale primero como reemplazo posible");
      assert.equal(substitutes[0]?.sibling, true);
      // findSubstitutes directo: las hermanas van antes que otros productos libres de la misma categoría.
      await addItem(org, "Zapato Sandalia", 10, { category: "Calzado" });
      const direct = await findSubstitutes({ organizationId: org, item: { id: n35.id, category: "Calzado", status: "AVAILABLE" }, startsAt: day(10), endsAt: day(13) });
      assert.equal(direct[0]?.sibling, true);
      assert.ok(direct.some((s) => s.name === "Zapato Sandalia" && !s.sibling));
    });

    await t.test("8) agregar variante copia cobro, precios y categoría; crea N unidades; mandar la familia a la papelera deja las variantes sueltas con el stock intacto", async () => {
      const org = await newOrg("papelera");
      const v = await addItem(org, "Vela Verde", 3, { sku: "V-V", listPrice: 2500, billingUnit: "EVENT", dimensions: "10 cm" });
      await replacePriceTiers(db, org, v.id, [{ audience: "RETAIL", fromDays: 2, mode: "TOTAL", price: 4000 }] as never);
      const created = await run((tx) => families.createFamily(tx, org, { name: "Vela", axes: [{ label: "Color", values: ["Verde"] }], members: [{ itemId: v.id, options: { color: "Verde" } }] }));
      assert.ok(created.ok);
      const added = await run((tx) => families.addNewVariant(tx, org, created.familyId, { options: { color: "Rosa" }, sku: "V-R", quantity: 4 }));
      assert.ok(added.ok, added.ok ? "" : added.error);
      const nueva = await db.inventoryItem.findFirstOrThrow({ where: { id: added.itemId } });
      assert.equal(nueva.name, "Vela · Rosa");
      assert.deepEqual([nueva.listPrice, nueva.billingUnit, nueva.dimensions, nueva.quantity, nueva.visibleOnWeb, nueva.catalogAudience], [2500, "EVENT", "10 cm", 4, false, "HIDDEN"]);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: nueva.id } }), 4);
      assert.equal((await db.inventoryPriceTier.findMany({ where: { inventoryId: nueva.id } })).length, 1, "escalones copiados");
      assert.equal(JSON.stringify((await db.inventoryFamily.findFirstOrThrow({ where: { id: created.familyId } })).axes).includes("Rosa"), true, "el valor nuevo se suma al eje");
      const cero = await run((tx) => families.addNewVariant(tx, org, created.familyId, { options: { color: "Azul" }, sku: "V-A" }));
      assert.ok(cero.ok);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: cero.itemId } }), 0, "0 unidades");
      assert.equal((await run((tx) => families.addNewVariant(tx, org, created.familyId, { options: { color: "Azul" }, sku: "V-A2" }))).ok, false, "combinación repetida");
      assert.equal((await run((tx) => families.addNewVariant(tx, org, created.familyId, { options: { color: "Gris" }, sku: "V-R" }))).ok, false, "SKU repetido");
      assert.equal((await run((tx) => families.addNewVariant(tx, org, created.familyId, { options: { color: "Gris" }, sku: "VELA" }))).ok, false, "el SKU no puede ser el código de la familia");
      assert.equal((await run((tx) => families.addNewVariant(tx, org, created.familyId, { options: { color: "Gris" }, sku: "V-G" }))).ok, true);

      const before = await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" }, select: { id: true, name: true, quantity: true, listPrice: true } });
      const unitsBefore = await db.inventoryUnit.count({ where: { organizationId: org } });
      const trashed = await run((tx) => families.trashFamily(tx, org, created.familyId, null, "prueba"));
      assert.ok(trashed.ok);
      assert.equal(trashed.unlinked, 4);
      assert.deepEqual(await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" }, select: { id: true, name: true, quantity: true, listPrice: true } }), before, "nombre, stock y precio intactos");
      assert.equal(await db.inventoryUnit.count({ where: { organizationId: org } }), unitsBefore);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: org, familyId: { not: null } } }), 0);
      assert.equal(await families.getFamilyView(db, org, created.familyId), null, "la familia sale de las listas");
      assert.equal((await dbWithDeleted.inventoryFamily.findFirstOrThrow({ where: { id: created.familyId } })).deletedAt instanceof Date, true);
      // Su código queda libre y la combinación también (índice parcial).
      const again = await run((tx) => families.createFamily(tx, org, { name: "Vela", axes: [{ label: "Color", values: ["Verde"] }], members: [{ itemId: v.id, options: { color: "Verde" } }] }));
      assert.ok(again.ok, again.ok ? "" : again.error);
    });

    await t.test("9) reglas: un combo no es variante, un ítem va en una sola familia, el código de la familia no choca con un SKU (en las dos direcciones)", async () => {
      const org = await newOrg("reglas");
      const a = await addItem(org, "Flor A", 1, { sku: "FLOR" });
      const b = await addItem(org, "Flor B", 1, { sku: "F-B" });
      const combo = await addItem(org, "Kit", 0);
      const part = await addItem(org, "Parte", 2);
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: org, parentId: combo.id, componentId: part.id, quantity: 1 } });
      const status = (r: { ok: boolean; status?: number }) => (r.ok ? 200 : r.status);
      assert.equal(status(await run((tx) => families.createFamily(tx, org, { name: "Combo", axes: [{ label: "Color", values: ["x"] }], members: [{ itemId: combo.id, options: { color: "x" } }] }))), 400, "combo");
      assert.equal(status(await run((tx) => families.createFamily(tx, org, { name: "Flor", code: "FLOR", axes: [{ label: "Color", values: ["Rojo"] }], members: [{ itemId: a.id, options: { color: "Rojo" } }] }))), 409, "el código FLOR es un SKU");
      const ok = await run((tx) => families.createFamily(tx, org, { name: "Flor", code: "FLORES", axes: [{ label: "Color", values: ["Rojo"] }], members: [{ itemId: a.id, options: { color: "Rojo" } }] }));
      assert.ok(ok.ok);
      assert.equal(status(await run((tx) => families.createFamily(tx, org, { name: "Otra", code: "FLORES-2", axes: [{ label: "Color", values: ["Rojo"] }], members: [{ itemId: a.id, options: { color: "Rojo" } }] }))), 409, "ya está en una familia");
      const c = await addItem(org, "Flor C", 1, { sku: "F-C" });
      const d = await addItem(org, "Flor D", 1, { sku: "F-D" });
      assert.equal(status(await run((tx) => families.createFamily(tx, org, { name: "Dos", axes: [{ label: "Color", values: ["R"] }], members: [{ itemId: c.id, options: { color: "R" } }, { itemId: d.id, options: { color: "r" } }] }))), 400, "misma combinación");
      assert.equal(await families.skuClashesWithFamilyCode(db, org, "flores"), true, "un SKU nuevo no puede ser el código de una familia");
      assert.equal(await families.skuClashesWithFamilyCode(db, org, "OTRO"), false);
      // El índice parcial impide la combinación repetida aun escribiendo por fuera del módulo.
      await assert.rejects(() => db.inventoryItem.update({ where: { id: b.id }, data: { familyId: ok.familyId, variantKey: "color=rojo", variantOptions: { color: "Rojo" } } }), /Unique|unique/);
    });

    await t.test("10) la demo carga cuatro familias completas y reponer no duplica", async () => {
      const { ensureDemoData, DEMO_ORGANIZATION_ID } = await import("../lib/server/demo-data");
      await ensureDemoData({ reset: true } as never);
      const views = await families.listFamilyViews(db, DEMO_ORGANIZATION_ID);
      const expectedFamilies = [["Mantel de lino", 3], ["Plato Arabesco", 2], ["Silla Cross", 3], ["Zapato Ola", 4]];
      assert.deepEqual(views.map((f) => [f.name, f.variants.length]).sort(), expectedFamilies);
      const plato = views.find((f) => f.name === "Plato Arabesco")!;
      assert.deepEqual(plato.variants.map((v) => v.name).sort(), ["Plato Arabesco · Lila", "Plato Arabesco · Verde"]);
      assert.ok(plato.categoryId, "la familia tiene la categoría de sus productos");
      const zapato = views.find((f) => f.name === "Zapato Ola")!;
      assert.deepEqual(zapato.variants.map((v) => v.name).sort(), ["Zapato Ola · Blanco · 35", "Zapato Ola · Blanco · 36", "Zapato Ola · Negro · 35", "Zapato Ola · Negro · 36"]);
      assert.equal(zapato.variants.find((v) => v.name.endsWith("Negro · 35"))!.quantity, 1);
      for (const variant of views.flatMap((f) => f.variants)) assert.equal(await db.inventoryUnit.count({ where: { inventoryId: variant.id } }), variant.quantity);
      await ensureDemoData({ reset: true } as never);
      assert.deepEqual((await families.listFamilyViews(db, DEMO_ORGANIZATION_ID)).map((f) => [f.name, f.variants.length]).sort(), expectedFamilies, "reponer no duplica");
    });
  } finally {
    // Se limpian las empresas de la prueba (la demo queda como estaba).
    for (const id of orgs) {
      await db.eventInventory.deleteMany({ where: { event: { organizationId: id } } }).catch(() => undefined);
      await dbWithDeleted.organization.delete({ where: { id } }).catch((error) => console.warn("[test] no se pudo borrar la empresa de prueba", id, String(error).slice(0, 120)));
    }
  }
});
