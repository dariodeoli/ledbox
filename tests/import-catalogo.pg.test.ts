import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/import-catalogo.pg.test.ts
test("importar catálogo en PostgreSQL: idempotente, juegos con el motor real, fotos, tenencia y auditoría", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const sharp = (await import("sharp")).default;
  const { applyCatalog, previewCatalog } = await import("../lib/server/import-catalog");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const { comboCapacitiesForRange } = await import("../lib/server/inventory-combos");
  const { portalAuditContext } = await import("../lib/server/audit");

  const day = (n: number, hour = 12) => new Date(Date.UTC(2031, 2, n, hour));
  const orgs: string[] = [];
  const newOrg = async () => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: "Importar QA", slug: `importar-qa-${id}` } });
    return id;
  };
  const photo = async (color: string) => new Uint8Array(await sharp({ create: { width: 2400, height: 1600, channels: 3, background: color } }).jpeg().toBuffer());
  const catalog = (extra: Record<string, unknown>[] = [], overrideJuego: Record<string, unknown> = {}) => {
    const parsed = normalizeCatalog({
      empresa: "La Vajilla Alquileres",
      moneda: "PYG",
      productos: [
        { codigo: "743", nombre: "Silla Tiffany", categoria: "Sillas", tipo: "unidad", precio: 15000, cantidad: 40, foto: "743.jpg" },
        { codigo: "811", nombre: "Mesa redonda", categoria: "Mesas", tipo: "unidad", precio: 60000, cantidad: 5, medidas: "1.50 m", capacidad: "10 personas" },
        { codigo: "527", nombre: "Mesa con 10 sillas", categoria: "Juegos", tipo: "juego", precio: 200000, cantidad: null, componentes: [{ codigo: "743", cantidad: 10 }, { codigo: "811", cantidad: 1 }], foto: "527.jpg", dudas: "Revisar precio", ...overrideJuego },
        ...extra,
      ],
    });
    assert.ok(parsed.ok);
    return parsed.value;
  };
  const inputOf = async (value: ReturnType<typeof catalog>, withPhotos = true) => ({
    products: value.doc.productos,
    parseProblems: value.problems,
    photos: withPhotos ? new Map([["743.jpg", await photo("#c33")], ["527.jpg", await photo("#33c")]]) : null,
    photoProblems: [],
  });

  try {
    const org = await newOrg();
    const ctx = portalAuditContext(org, "Importador QA");
    const lote1 = randomUUID();

    await t.test("la vista previa no escribe nada y cuenta lo que se va a hacer", async () => {
      const plan = await previewCatalog(org, await inputOf(catalog()));
      assert.deepEqual([plan.summary.crear, plan.summary.actualizar, plan.summary.juegos, plan.summary.fotos], [3, 0, 1, 2]);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: org } }), 0);
    });

    await t.test("primera importación: unidades, juego con componentes, precios, descripción, visibilidad y fotos", async () => {
      const result = await applyCatalog(ctx, { ...(await inputOf(catalog())), lote: lote1 });
      assert.equal(result.creados.length, 3, JSON.stringify(result.fallidos));
      assert.deepEqual(result.fallidos, []);
      assert.equal(result.juegos, 1);
      assert.equal(result.fotos, 3 - 1, "dos fotos: una de la silla y una del juego");
      const items = await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" } });
      assert.deepEqual(items.map((i) => i.sku), ["527", "743", "811"]);
      const [juego, silla, mesa] = items;
      assert.equal(silla.quantity, 40);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: silla.id } }), 40);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: mesa.id } }), 5);
      assert.equal(juego.quantity, 0, "el juego no tiene unidades propias");
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: juego.id } }), 0);
      assert.equal(silla.listPrice, 15000);
      assert.equal(mesa.dimensions, "1.50 m");
      assert.equal(mesa.capacity, 10);
      assert.equal(mesa.publicDescription, null);
      assert.ok(items.every((i) => i.visibleOnWeb && i.catalogAudience === "RETAIL"));
      assert.equal(silla.imageMime, "image/webp");
      assert.ok(silla.imageData && silla.imageData.byteLength > 0 && silla.imageData.byteLength <= 2 * 1024 * 1024);
      assert.equal(mesa.imageMime, null);
      const components = await db.inventoryComponent.findMany({ where: { parentId: juego.id } });
      assert.deepEqual(components.map((c) => [c.componentId === silla.id ? "silla" : "mesa", c.quantity]).sort(), [["mesa", 1], ["silla", 10]]);
    });

    await t.test("auditoría en lote: una fila IaCarga con los ids creados", async () => {
      const audit = await db.auditLog.findMany({ where: { organizationId: org, entity: "IaCarga", entityId: lote1 } });
      assert.equal(audit.length, 1);
      const fields = (audit[0].detail as { fields: { productos: string[]; origen: string } }).fields;
      assert.equal(fields.productos.length, 3);
      assert.equal(fields.origen, "importar-catalogo");
    });

    await t.test("reimportar el mismo archivo da el mismo resultado: actualiza, no duplica", async () => {
      const before = await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" }, select: { id: true, sku: true, quantity: true, listPrice: true } });
      const componentsBefore = await db.inventoryComponent.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true } });
      const unitsBefore = await db.inventoryUnit.count({ where: { organizationId: org } });
      const again = await applyCatalog(ctx, { ...(await inputOf(catalog())), lote: randomUUID() });
      assert.equal(again.creados.length, 0);
      assert.equal(again.actualizados, 3);
      assert.equal(again.fotos, 0, "las fotos iguales no se reescriben");
      assert.deepEqual(again.fallidos, []);
      const after = await db.inventoryItem.findMany({ where: { organizationId: org }, orderBy: { sku: "asc" }, select: { id: true, sku: true, quantity: true, listPrice: true } });
      assert.deepEqual(after, before);
      assert.equal(await db.inventoryUnit.count({ where: { organizationId: org } }), unitsBefore);
      assert.deepEqual(await db.inventoryComponent.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true } }), componentsBefore, "los componentes iguales no se recrean");
    });

    await t.test("el motor real de combos: capacidad desde los componentes y reservas sin sobreventa", async () => {
      const items = new Map((await db.inventoryItem.findMany({ where: { organizationId: org } })).map((i) => [i.sku!, i]));
      const combo = items.get("527")!;
      const capacity = async () => (await comboCapacitiesForRange({ organizationId: org, comboIds: [combo.id], startsAt: day(10), endsAt: day(13) })).get(combo.id)!;
      assert.equal((await capacity()).capacity, 4, "min(40 sillas / 10, 5 mesas / 1)");
      const client = randomUUID();
      await db.client.create({ data: { id: client, organizationId: org, name: "Cliente QA" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client, name: "Fiesta", setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13) } });
      const reserve = (quantity: number, inventoryId = combo.id) => commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId, quantity, startsAt: day(10), endsAt: day(13) });
      assert.ok((await reserve(3)).ok);
      assert.equal((await capacity()).capacity, 1);
      const over = await reserve(5);
      assert.equal(over.ok, false, "5 combos superan la capacidad de 4");
      const looseChairs = await reserve(11, items.get("743")!.id);
      assert.equal(looseChairs.ok, false, "30 sillas ya van en los combos: quedan 10 libres");
      assert.equal((await capacity()).capacity, 1, "los rechazos no consumen stock");
    });

    await t.test("con reservas activas, cambiar los componentes del juego se informa y no rompe el resto", async () => {
      const value = catalog([], { componentes: [{ codigo: "743", cantidad: 8 }, { codigo: "811", cantidad: 1 }] });
      const result = await applyCatalog(ctx, { ...(await inputOf(value)), lote: randomUUID() });
      assert.ok(result.fallidos.some((f) => f.codigo === "527" && /reservas activas/.test(f.mensaje)), JSON.stringify(result.fallidos));
      const combo = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku: "527" } });
      const quantities = (await db.inventoryComponent.findMany({ where: { parentId: combo.id } })).map((c) => c.quantity).sort((a, b) => a - b);
      assert.deepEqual(quantities, [1, 10], "los componentes quedaron como estaban");
    });

    await t.test("actualizar precio y completar unidades; nunca retirar", async () => {
      const value = catalog([], {});
      value.doc.productos[0] = { ...value.doc.productos[0], precio: 18000, cantidad: 45 };
      value.doc.productos[1] = { ...value.doc.productos[1], cantidad: 2, precio: 0 };
      const result = await applyCatalog(ctx, { ...(await inputOf(value, false)), lote: randomUUID() });
      assert.deepEqual(result.fallidos.filter((f) => f.codigo !== "527"), []);
      const silla = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku: "743" } });
      const mesa = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku: "811" } });
      assert.equal(silla.listPrice, 18000);
      assert.equal(silla.quantity, 45);
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: silla.id } }), 45);
      assert.equal(mesa.quantity, 5, "no se retiran unidades");
      assert.equal(mesa.listPrice, 60000, "precio 0 en el archivo conserva el actual");
      assert.equal(silla.imageMime, "image/webp", "sin ZIP no se borran las fotos");
    });

    await t.test("tenencia: la misma carga en otra empresa crea lo suyo y no toca la primera", async () => {
      const other = await newOrg();
      const before = await db.inventoryItem.count({ where: { organizationId: org } });
      const result = await applyCatalog(portalAuditContext(other, "Otra"), { ...(await inputOf(catalog())), lote: randomUUID() });
      assert.equal(result.creados.length, 3);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: org } }), before);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: other } }), 3);
      const foreign = await previewCatalog(other, await inputOf(catalog(), false));
      assert.equal(foreign.summary.actualizar, 3, "solo ve lo suyo");
    });

    await t.test("catálogo grande: 390 productos con fotos compartidas, por bloques y con progreso", async () => {
      const big = await newOrg();
      const productos = Array.from({ length: 390 }, (_, i) => ({ codigo: i % 50 === 0 ? `SC-${i}` : `${1000 + i}${i % 7 === 0 ? "-b" : ""}`, nombre: `Producto ${i}`, categoria: "Varios", tipo: "unidad", precio: i % 4 === 0 ? null : 1000 + i, cantidad: 1 + (i % 3), foto: i < 300 ? `${1000 + (i % 100)}.jpg` : null }));
      const parsed = normalizeCatalog({ moneda: "PYG", productos });
      assert.ok(parsed.ok);
      const shared = await photo("#393");
      const photos = new Map(Array.from({ length: 100 }, (_, i) => [`${1000 + i}.jpg`, shared] as const));
      const steps: number[] = [];
      const started = Date.now();
      const result = await applyCatalog(portalAuditContext(big, "Grande"), { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos, photoProblems: [], lote: randomUUID(), onProgress: (p) => steps.push(p.hecho) });
      assert.equal(result.creados.length, 390, JSON.stringify(result.fallidos.slice(0, 3)));
      assert.deepEqual(result.fallidos, []);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: big, imageMime: "image/webp" } }), result.fotos);
      assert.ok(result.fotos >= 300 - 1, "cada ficha guarda su copia de la foto compartida");
      assert.ok(steps.length >= 15 && steps.every((n, i) => i === 0 || n >= steps[i - 1]) && steps.at(-1) === 390, "progreso por bloques, creciente y completo");
      assert.ok(Date.now() - started < 120_000, "sin timeouts");
      const again = await applyCatalog(portalAuditContext(big, "Grande"), { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos, photoProblems: [], lote: randomUUID() });
      assert.equal(again.creados.length, 0);
      assert.equal(again.actualizados, 390);
      assert.equal(again.fotos, 0);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: big } }), 390);
    });

    await t.test("papelera y cambio de tipo: se omiten con su motivo", async () => {
      const trashOrg = await newOrg();
      await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: trashOrg, name: "Silla vieja", sku: "743", category: "Sillas", quantity: 0, deletedAt: new Date() } });
      const plan = await previewCatalog(trashOrg, await inputOf(catalog(), false));
      assert.ok(plan.problems.some((p) => p.tipo === "sku-papelera"));
      assert.equal(plan.items.find((i) => i.product.codigo === "743")!.accion, "omitir");
      assert.equal(plan.items.find((i) => i.product.codigo === "527")!.accion, "omitir", "su componente quedó afuera");
    });
  } finally {
    for (const id of orgs) await db.organization.delete({ where: { id } }).catch(() => undefined);
    await db.$disconnect();
  }
});
