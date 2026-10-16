import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("applied photo destinations persist across reload, classify identical/no ZIP/invalid, and preserve CREATE_ONLY metadata", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { applyCatalog } = await import("../lib/server/import-catalog");
  const { portalAuditContext } = await import("../lib/server/audit");
  const sharp = (await import("sharp")).default;
  const org = randomUUID(), other = randomUUID();
  await db.organization.createMany({ data: [org, other].map(id => ({ id, name: "Photo outcome fixture", slug: `photo-${id}` })) });
  const context = portalAuditContext(org, "Photo outcome fixture");
  const raw = { productos: [{ codigo: "A", nombre: "Silla", categoria: "Sillas", cantidad: 0, foto: "a.webp", fotos: ["b.webp"], colecciones: ["Fiesta"] }], categorias: [{ nombre: "Sillas", foto: "a.webp" }], colecciones: [{ nombre: "Fiesta", foto: "a.webp" }] };
  const p = normalizeCatalog(raw); assert.ok(p.ok);
  const run = (photos: Map<string, Uint8Array> | null, importMode: "UPSERT" | "CREATE_ONLY" = "UPSERT") => applyCatalog(context, { products: p.value.doc.productos, categories: p.value.doc.categorias, collections: p.value.doc.colecciones, parseProblems: p.value.problems, photos, photoProblems: [], lote: randomUUID(), importMode });
  try {
    const foreign = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: other, sku: "A", name: "Foreign", category: "Sillas", quantity: 0, imageData: new Uint8Array([5]), imageMime: "image/webp" } });
    const a = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 3, background: "#abcdef" } }).webp().toBuffer());
    const b = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 3, background: "#123456" } }).webp().toBuffer());
    const first = await run(new Map([["a.webp", a], ["b.webp", b]])); assert.equal(first.resultadoFotos.resumen.modificadas, 4); assert.equal(first.resultadoFotos.resumen.fallidas, 0);
    const snapshots = async () => ({ item: await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku: "A" }, select: { imageData: true, imageMime: true } }), category: await db.inventoryCategory.findFirstOrThrow({ where: { organizationId: org, name: "Sillas" }, select: { imageData: true, imageUrl: true } }), collection: await db.collection.findFirstOrThrow({ where: { organizationId: org, name: "Fiesta" }, select: { imageData: true } }), extras: await db.inventoryImage.findMany({ where: { organizationId: org }, orderBy: { position: "asc" }, select: { id: true, data: true } }) });
    const saved = await snapshots(); assert.ok(saved.item.imageData?.byteLength); assert.equal(saved.extras.length, 1);
    const repeated = await run(new Map([["a.webp", a], ["b.webp", b]])); assert.equal(repeated.resultadoFotos.resumen.conservadas, 4); assert.equal(repeated.resultadoFotos.resumen.modificadas, 0); assert.equal(repeated.summary.fotos, 0); assert.equal(repeated.summary.fotosCategoria, 0); assert.equal(repeated.summary.fotosColeccion, 0); assert.deepEqual(await snapshots(), saved);
    const absent = await run(null); assert.equal(absent.resultadoFotos.resumen.sinArchivo, 4); assert.ok(absent.resultadoFotos.destinos.every(r => /Sin ZIP/.test(r.motivo))); assert.deepEqual(await snapshots(), saved);
    const malformed = new Map([["a.webp", new Uint8Array([1])], ["b.webp", new Uint8Array([2])]]);
    const ignored = await run(malformed, "CREATE_ONLY"); assert.equal(ignored.resultadoFotos.resumen.conservadas, 4); assert.equal(ignored.resultadoFotos.resumen.fallidas, 0); assert.deepEqual(await snapshots(), saved);
    const failed = await run(malformed); assert.equal(failed.resultadoFotos.resumen.fallidas, 4); assert.equal(failed.resultadoFotos.resumen.cambiosAplicados, 1, "existing behavior applies partial extras list, here empty");
    const after = await snapshots(); assert.deepEqual(after.item, saved.item); assert.deepEqual(after.category, saved.category); assert.deepEqual(after.collection, saved.collection); assert.equal(after.extras.length, 0);
    assert.deepEqual((await db.inventoryItem.findUniqueOrThrow({ where: { id: foreign.id } })).imageData, new Uint8Array([5]));
  } finally { await db.organization.deleteMany({ where: { id: { in: [org, other] } } }); await db.$disconnect(); }
});
