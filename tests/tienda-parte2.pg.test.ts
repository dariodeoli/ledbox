import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/tienda-parte2.pg.test.ts
test("tienda parte 2: fotos por producto, colecciones y orden del inicio, aislados por empresa (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const sharp = (await import("sharp")).default;
  const photos = await import("../lib/server/product-photos");
  const collections = await import("../lib/server/collections");
  const homePhotos = await import("../lib/server/home-photos");
  const { saveOrgAppearance } = await import("../lib/server/org-presentation");
  const { loadPublicCatalogItems, loadPublicCollections, loadStorefront, loadCollectionMeta, resolvePublicCatalog } = await import("../lib/server/catalog-public");
  const { GET: photoGet } = await import("../app/api/inventory-photos/[id]/route");
  const { GET: collectionImageGet } = await import("../app/api/collection-images/[id]/route");
  const { GET: homeGet } = await import("../app/api/catalog/[orgSlug]/home/[slot]/route");
  const { applyCatalog } = await import("../lib/server/import-catalog");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { readAppearance } = await import("../lib/appearance");

  const png = async (color: string, size = 48) => new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer());
  const jpg = async (color: string) => new Uint8Array(await sharp({ create: { width: 900, height: 1100, channels: 3, background: color } }).jpeg().toBuffer());
  const upload = (bytes: Uint8Array, name = "foto.png") => {
    const form = new FormData();
    form.append("file", new File([bytes as BlobPart], name, { type: "image/png" }));
    return new Request("http://x/upload", { method: "POST", body: form });
  };
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const json = async (response: Response) => (await response.json()) as Record<string, any>;

  const made: string[] = [];
  async function seed(label: string) {
    const org = randomUUID();
    made.push(org);
    const slug = `tp2-${label}-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Vajilla ${label}`, slug } });
    await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: true, publicShowPrices: true, depositPercent: 50, catalogAccessMode: "OPEN" } });
    const item = (name: string, extra: Record<string, unknown> = {}) =>
      db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category: "Vajilla", quantity: 10, visibleOnWeb: true, catalogAudience: "RETAIL", listPrice: 50_000, ...extra } });
    const plato = await item("Plato verde", { tags: ["Verde"], featured: true });
    const copa = await item("Copa", { sku: "C1" });
    const hidden = await item("Interno", { visibleOnWeb: false, catalogAudience: "HIDDEN" });
    const ctx = { organizationId: org, organization: { id: org, name: `Vajilla ${label}`, slug, planId: null }, user: { id: randomUUID(), name: "Dueña", email: "d@x.test", role: "OWNER" }, role: "OWNER", demo: false, sandbox: false } as never;
    return { org, slug, plato, copa, hidden, ctx };
  }

  try {
    const a = await seed("a");
    const b = await seed("b");

    await t.test("migración 202610310001: se puede volver a correr sin error ni cambios", async () => {
      // El archivo lleva varias sentencias (y bloques DO): se corre con psql, que es como lo aplica la base.
      const file = fileURLToPath(new URL("../prisma/migrations/202610310001_tienda_parte2/migration.sql", import.meta.url));
      const run = () => execFileSync("psql", ["-h", url.hostname, "-p", url.port || "5432", "-U", url.username || "postgres", "-d", url.pathname.slice(1), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" } });
      const before = await db.collection.count();
      run();
      run();
      assert.equal(await db.collection.count(), before);
    });

    await t.test("fotos del producto: subir, ordenar, quitar; tope de 8; todo acotado a la empresa", async () => {
      const added: string[] = [];
      for (const color of ["#c33", "#3c3", "#33c"]) {
        const response = await photos.addProductPhoto(a.ctx, a.plato.id, upload(await png(color)));
        assert.equal(response.status, 201, await response.clone().text());
        added.push((await json(response)).photo.id);
      }
      assert.deepEqual((await photos.listProductPhotos(a.org, a.plato.id)).map((p) => p.id), added);
      assert.deepEqual((await photos.listProductPhotos(a.org, a.plato.id)).map((p) => p.position), [1, 2, 3]);

      // Otra empresa no puede ver, sumar, ordenar ni quitar las fotos de este producto.
      assert.deepEqual(await photos.listProductPhotos(b.org, a.plato.id), []);
      assert.equal((await photos.addProductPhoto(b.ctx, a.plato.id, upload(await png("#000")))).status, 404);
      assert.equal((await photos.reorderProductPhotos(b.ctx, a.plato.id, added)).status, 404);
      assert.equal((await photos.removeProductPhoto(b.ctx, a.plato.id, added[0])).status, 404);
      assert.equal(await db.inventoryImage.count({ where: { itemId: a.plato.id } }), 3, "nada se tocó");

      // Un id de foto de A usado con un producto de B tampoco borra nada.
      assert.equal((await photos.removeProductPhoto(b.ctx, b.plato.id, added[0])).status, 404);
      assert.equal(await db.inventoryImage.count({ where: { itemId: a.plato.id } }), 3);

      // Una lista incompleta o ajena no reordena.
      assert.equal((await photos.reorderProductPhotos(a.ctx, a.plato.id, [added[0]])).status, 409);
      assert.equal((await photos.reorderProductPhotos(a.ctx, a.plato.id, [added[0], added[1], randomUUID()])).status, 409);
      const reordered = await photos.reorderProductPhotos(a.ctx, a.plato.id, [added[2], added[0], added[1]]);
      assert.equal(reordered.status, 200);
      assert.deepEqual((await photos.listProductPhotos(a.org, a.plato.id)).map((p) => p.id), [added[2], added[0], added[1]]);

      // Quitar compacta las posiciones.
      assert.equal((await photos.removeProductPhoto(a.ctx, a.plato.id, added[0])).status, 200);
      const rest = await photos.listProductPhotos(a.org, a.plato.id);
      assert.deepEqual(rest.map((p) => [p.id, p.position]), [[added[2], 1], [added[1], 2]]);

      // Un archivo renombrado (no es imagen) se rechaza por sus bytes.
      assert.equal((await photos.addProductPhoto(a.ctx, a.plato.id, upload(new TextEncoder().encode("MZ-ejecutable"), "foto.png"))).status, 400);

      // Tope: la principal más 8 extra.
      for (let i = 0; i < 6; i += 1) assert.equal((await photos.addProductPhoto(a.ctx, a.plato.id, upload(await png("#fa0", 40 + i)))).status, 201);
      assert.equal((await photos.addProductPhoto(a.ctx, a.plato.id, upload(await png("#0af")))).status, 409);
      assert.equal(await db.inventoryImage.count({ where: { itemId: a.plato.id } }), photos.MAX_EXTRA_PHOTOS);

      // Altas simultáneas: el candado del producto respeta el tope.
      const results = await Promise.all(Array.from({ length: 4 }, async () => (await photos.addProductPhoto(a.ctx, a.copa.id, upload(await png("#789", 52)))).status));
      assert.deepEqual(results, [201, 201, 201, 201]);
      const copaPositions = (await photos.listProductPhotos(a.org, a.copa.id)).map((p) => p.position);
      assert.equal(new Set(copaPositions).size, 4, "posiciones distintas aun con altas simultáneas");
    });

    await t.test("tienda pública: la galería trae las fotos en orden, solo de su empresa y sin los bytes; la foto se sirve por id", async () => {
      const context = await resolvePublicCatalog(a.slug);
      assert.ok(context);
      const items = await loadPublicCatalogItems(context, null);
      const plato = items.find((item) => item.id === a.plato.id)!;
      const stored = await photos.listProductPhotos(a.org, a.plato.id);
      assert.deepEqual(plato.gallery, stored.map((p) => p.url));
      assert.equal(plato.gallery.length, photos.MAX_EXTRA_PHOTOS);
      assert.deepEqual(plato.tags, ["Verde"]);
      assert.equal(plato.featured, true);
      assert.ok(items.every((item) => item.id !== a.hidden.id), "lo oculto no sale");
      const contextB = await resolvePublicCatalog(b.slug);
      const itemsB = await loadPublicCatalogItems(contextB!, null);
      assert.ok(itemsB.every((item) => item.gallery.every((url) => !stored.some((p) => url.includes(p.id)))), "la empresa B no ve fotos de A");
      const ok = await photoGet(new Request("http://x"), params({ id: stored[0].id }));
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get("content-type") ?? "", /^image\/(png|jpeg|webp)$/);
      assert.equal((await photoGet(new Request("http://x"), params({ id: randomUUID() }))).status, 404);
    });

    await t.test("colecciones: crear, editar y eliminar solo con productos y datos de la propia empresa", async () => {
      const made1 = await collections.createCollection(a.ctx, { name: "Verde Bosque", description: "Tonos de selva", sortOrder: 10, itemIds: [a.plato.id, a.copa.id] });
      assert.equal(made1.status, 201, await made1.clone().text());
      const verde = (await json(made1)).collection;
      assert.equal(verde.slug, "verde-bosque");
      assert.deepEqual(verde.itemIds, [a.plato.id, a.copa.id]);

      // Un producto de otra empresa no entra: ni al crear ni al editar.
      const foreign = await collections.createCollection(a.ctx, { name: "Ajena", itemIds: [b.plato.id] });
      assert.equal(foreign.status, 400);
      assert.equal((await collections.updateCollection(a.ctx, verde.id, { itemIds: [a.plato.id, b.copa.id] })).status, 400);
      assert.deepEqual((await collections.listCollections(a.org))[0].itemIds, [a.plato.id, a.copa.id], "no cambió");

      // La misma colección de A no se ve, edita, elimina ni recibe foto desde B.
      assert.deepEqual(await collections.listCollections(b.org), []);
      assert.equal((await collections.updateCollection(b.ctx, verde.id, { name: "Robada" })).status, 404);
      assert.equal((await collections.deleteCollection(b.ctx, verde.id)).status, 404);
      assert.equal((await collections.uploadCollectionImage(b.ctx, verde.id, upload(await png("#111")))).status, 404);
      assert.equal((await db.collection.findUniqueOrThrow({ where: { id: verde.id } })).name, "Verde Bosque");

      // El mismo nombre en otra empresa es otra colección (el slug es único por empresa).
      const sameName = await collections.createCollection(b.ctx, { name: "Verde Bosque", itemIds: [b.plato.id] });
      assert.equal(sameName.status, 201);
      assert.equal((await json(sameName)).collection.slug, "verde-bosque");
      const twice = await collections.createCollection(a.ctx, { name: "Verde  bosque" });
      assert.equal(twice.status, 201);
      assert.equal((await json(twice)).collection.slug, "verde-bosque-2", "dentro de la empresa, el slug no se repite");

      // Orden de productos y foto de ambientación.
      const reordered = await collections.updateCollection(a.ctx, verde.id, { itemIds: [a.copa.id, a.plato.id] });
      assert.deepEqual((await json(reordered)).collection.itemIds, [a.copa.id, a.plato.id]);
      assert.equal((await collections.uploadCollectionImage(a.ctx, verde.id, upload(await jpg("#285")))).status, 200);
      assert.equal((await collections.uploadCollectionImage(a.ctx, verde.id, upload(new TextEncoder().encode("no soy una imagen")))).status, 400);
    });

    await t.test("tienda pública: solo colecciones visibles de la empresa, con productos publicados; la landing responde por slug", async () => {
      const verde = (await collections.listCollections(a.org)).find((c) => c.slug === "verde-bosque")!;
      const secret = await json(await collections.createCollection(a.ctx, { name: "Con interno", itemIds: [a.hidden.id] }));
      const oculta = await json(await collections.createCollection(a.ctx, { name: "Oculta", visible: false, itemIds: [a.plato.id] }));
      const context = (await resolvePublicCatalog(a.slug))!;
      const items = await loadPublicCatalogItems(context, null);
      const visibleIds = new Set(items.map((item) => item.id));
      const list = await loadPublicCollections(a.org, visibleIds);
      assert.ok(list.some((c) => c.id === verde.id));
      assert.ok(!list.some((c) => c.id === secret.collection.id), "una colección con solo productos ocultos no se muestra");
      assert.ok(!list.some((c) => c.id === oculta.collection.id), "una colección oculta no se muestra");
      assert.deepEqual(list.find((c) => c.id === verde.id)!.itemIds, [a.copa.id, a.plato.id], "en el orden de la empresa");
      assert.ok(list.find((c) => c.id === verde.id)!.imageUrl?.startsWith("/api/collection-images/"));
      assert.ok(items.find((item) => item.id === a.plato.id)!.collections.includes("verde-bosque"));
      assert.ok(!items.find((item) => item.id === a.plato.id)!.collections.includes("oculta"));

      assert.deepEqual(await loadCollectionMeta(a.org, "verde-bosque"), { name: "Verde Bosque", description: "Tonos de selva" });
      assert.equal(await loadCollectionMeta(a.org, "oculta"), null);
      assert.equal(await loadCollectionMeta(b.org, "verde-bosque-2"), null, "el slug de A no existe en B");
      const listB = await loadPublicCollections(b.org, new Set((await loadPublicCatalogItems((await resolvePublicCatalog(b.slug))!, null)).map((item) => item.id)));
      assert.deepEqual(listB.map((c) => c.name), ["Verde Bosque"]);
      assert.deepEqual(listB[0].itemIds, [b.plato.id], "B ve solo sus productos");

      const image = await collectionImageGet(new Request("http://x"), params({ id: verde.id }));
      assert.equal(image.status, 200);
      assert.equal((await collectionImageGet(new Request("http://x"), params({ id: oculta.collection.id }))).status, 404, "la foto de una colección oculta no se sirve");
    });

    await t.test("orden del inicio: se guarda por empresa, el catálogo no se oculta y lo inválido responde 400", async () => {
      const order = ["contacto", "inspiracion", "hero", "catalogo", "categorias", "destacados", "colecciones", "como-funciona"];
      const saved = await saveOrgAppearance(a.ctx, { home: { order, hidden: ["categorias", "catalogo", "inspiracion"], editorial: { title: "Mesas que se sienten", text: "Texto", eyebrow: "Nueva", cta: "Ver todo" }, inspiration: { title: "Ideas", captions: ["Uno", "Dos", ""] } } });
      assert.equal(saved.status, 200, await saved.clone().text());
      const body = await json(saved);
      assert.deepEqual(body.appearance.home.order, order);
      assert.deepEqual(body.appearance.home.hidden, ["categorias", "inspiracion"], "el catálogo no se puede ocultar");

      const stored = readAppearance((await db.organization.findUniqueOrThrow({ where: { id: a.org } })).appearance);
      assert.deepEqual(stored.home.order, order);
      const other = readAppearance((await db.organization.findUniqueOrThrow({ where: { id: b.org } })).appearance);
      assert.equal(other.home.order[0], "hero", "la otra empresa conserva el orden de siempre");
      assert.deepEqual(other.home.hidden, []);

      const storefront = await loadStorefront((await resolvePublicCatalog(a.slug))!);
      assert.deepEqual(storefront.appearance.home.order, order);
      assert.equal(storefront.appearance.home.editorial.title, "Mesas que se sienten");

      assert.equal((await saveOrgAppearance(a.ctx, { home: { order: ["hero", "inventada"] } })).status, 400);
      assert.equal((await saveOrgAppearance(a.ctx, { home: { editorial: { title: "x".repeat(200) } } })).status, 400);
      assert.deepEqual(readAppearance((await db.organization.findUniqueOrThrow({ where: { id: a.org } })).appearance).home.order, order, "un pedido inválido no cambia nada");
      // Guardar otra cosa de la apariencia conserva el orden.
      const again = await saveOrgAppearance(a.ctx, { priceMode: "unit" });
      assert.equal(again.status, 200);
      assert.deepEqual((await json(again)).appearance.home.order, order);
    });

    await t.test("fotos del inicio (editorial e inspiración): una por ranura y empresa; públicas solo con la tienda encendida", async () => {
      assert.equal((await homePhotos.uploadHomePhoto(a.ctx, "editorial", upload(await jpg("#a52")))).status, 200);
      assert.equal((await homePhotos.uploadHomePhoto(a.ctx, "inspiracion-1", upload(await jpg("#25a")))).status, 200);
      assert.equal((await homePhotos.uploadHomePhoto(a.ctx, "inspiracion-1", upload(await jpg("#5a2")))).status, 200, "reemplaza");
      assert.equal((await homePhotos.uploadHomePhoto(a.ctx, "inspiracion-2", upload(new TextEncoder().encode("no")))).status, 400);
      const versionsA = await homePhotos.loadHomePhotoVersions(a.org);
      assert.ok(versionsA.editorial && versionsA["inspiracion-1"]);
      assert.equal(versionsA["inspiracion-2"], null);
      assert.equal(await db.organizationCover.count({ where: { organizationId: a.org, kind: "inspiracion-1" } }), 1);
      assert.deepEqual(Object.values(await homePhotos.loadHomePhotoVersions(b.org)), [null, null, null, null]);
      const storefront = await loadStorefront((await resolvePublicCatalog(a.slug))!);
      assert.ok(storefront.homePhotos.editorial?.startsWith(`/api/catalog/${a.slug}/home/editorial`));
      assert.equal(storefront.homePhotos["inspiracion-3"], null);

      assert.equal((await homeGet(new Request("http://x"), params({ orgSlug: a.slug, slot: "editorial" }))).status, 200);
      assert.equal((await homeGet(new Request("http://x"), params({ orgSlug: b.slug, slot: "editorial" }))).status, 404, "B no tiene esa foto y no hereda la de A");
      assert.equal((await homeGet(new Request("http://x"), params({ orgSlug: a.slug, slot: "desktop" }))).status, 404, "las portadas no se sirven por esta ruta");
      assert.equal((await homePhotos.deleteHomePhoto(b.ctx, "editorial")).status, 200);
      assert.ok((await homePhotos.loadHomePhotoVersions(a.org)).editorial, "borrar en B no toca A");
      await db.organizationRentalSettings.updateMany({ where: { organizationId: a.org }, data: { publicCatalogEnabled: false } });
      assert.equal((await homeGet(new Request("http://x"), params({ orgSlug: a.slug, slot: "editorial" }))).status, 404, "tienda apagada: 404");
      await db.organizationRentalSettings.updateMany({ where: { organizationId: a.org }, data: { publicCatalogEnabled: true } });
      assert.equal((await homePhotos.deleteHomePhoto(a.ctx, "editorial")).status, 200);
      assert.equal((await homePhotos.loadHomePhotoVersions(a.org)).editorial, null);
    });

    await t.test("importación: fotos extra, colecciones y estilo; idempotente y sin cruzar empresas", async () => {
      const c = await seed("c");
      const d = await seed("d");
      const parsed = normalizeCatalog({
        moneda: "PYG",
        productos: [
          { codigo: "527", nombre: "Lounge Oslo", categoria: "Living", tipo: "unidad", precio: 90_000, cantidad: 2, foto: "527.jpg", fotos: ["527.jpg", "527-2.jpg", "527-3.jpg"], colecciones: ["Verde Bosque"], estilo: ["Natural", "Rattan"] },
          { codigo: "528", nombre: "Puff", categoria: "Living", tipo: "unidad", precio: 40_000, cantidad: 1, colecciones: ["Verde Bosque", "Colección Rayas"] },
        ],
        colecciones: [{ nombre: "Verde Bosque", descripcion: "Selva", foto: "vb.jpg", orden: 3 }],
      });
      assert.ok(parsed.ok);
      const files = async () => new Map<string, Uint8Array>([["527.jpg", await jpg("#111")], ["527-2.jpg", await jpg("#222")], ["527-3.jpg", await jpg("#333")], ["vb.jpg", await jpg("#444")]]);
      const input = async () => ({ products: parsed.value.doc.productos, collections: parsed.value.doc.colecciones, parseProblems: parsed.value.problems, photos: await files(), photoProblems: [] });
      const first = await applyCatalog(c.ctx as never, { ...(await input()), lote: randomUUID() });
      assert.deepEqual(first.fallidos, []);
      assert.equal(first.fotosExtra, 2);
      assert.equal(first.colecciones, 2);
      assert.equal(first.fotosColeccion, 1);
      const lounge = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: c.org, sku: "527" } });
      assert.deepEqual(lounge.tags, ["Natural", "Rattan"]);
      assert.equal(await db.inventoryImage.count({ where: { itemId: lounge.id, organizationId: c.org } }), 2);
      assert.ok(lounge.imageData, "la principal quedó en el producto");
      const cols = await collections.listCollections(c.org);
      assert.deepEqual(cols.map((x) => x.slug).sort(), ["coleccion-rayas", "verde-bosque"]);
      const verde = cols.find((x) => x.slug === "verde-bosque")!;
      assert.equal(verde.sortOrder, 3);
      assert.equal(verde.description, "Selva");
      assert.ok(verde.imageVersion);
      assert.equal(verde.itemIds.length, 2);
      assert.deepEqual(await collections.listCollections(d.org), [], "otra empresa no recibió nada");
      assert.equal(await db.inventoryImage.count({ where: { organizationId: d.org } }), 0);

      // Reimportar es idempotente: no duplica fotos, colecciones ni productos dentro de ellas.
      const second = await applyCatalog(c.ctx as never, { ...(await input()), lote: randomUUID() });
      assert.deepEqual(second.fallidos, []);
      assert.equal(second.fotosExtra, 0, "las mismas fotos no se reescriben");
      assert.equal(await db.inventoryImage.count({ where: { itemId: lounge.id } }), 2);
      assert.equal((await collections.listCollections(c.org)).length, 2);
      assert.equal((await collections.listCollections(c.org)).find((x) => x.slug === "verde-bosque")!.itemIds.length, 2);

      // Si el archivo trae otra lista de fotos, la reemplaza; un estilo vacío lo limpia; sin el campo no toca nada.
      const changed = normalizeCatalog({ moneda: "PYG", productos: [{ codigo: "527", nombre: "Lounge Oslo", categoria: "Living", tipo: "unidad", precio: 90_000, cantidad: 2, foto: "527.jpg", fotos: ["527-3.jpg"], estilo: [] }, { codigo: "528", nombre: "Puff", categoria: "Living", tipo: "unidad", precio: 40_000, cantidad: 1 }] });
      assert.ok(changed.ok);
      const third = await applyCatalog(c.ctx as never, { products: changed.value.doc.productos, collections: [], parseProblems: changed.value.problems, photos: await files(), photoProblems: [], lote: randomUUID() });
      assert.deepEqual(third.fallidos, []);
      assert.equal(await db.inventoryImage.count({ where: { itemId: lounge.id } }), 1);
      assert.deepEqual((await db.inventoryItem.findUniqueOrThrow({ where: { id: lounge.id } })).tags, []);
      assert.equal((await collections.listCollections(c.org)).find((x) => x.slug === "verde-bosque")!.itemIds.length, 2, "sin el campo, las colecciones no se tocan");
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: made } } });
  }
});
