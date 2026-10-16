import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as results from "../lib/import-photo-results";
import { normalizeCatalog, planCatalog } from "../lib/import-catalog";
function actual(name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile("import.ts", readFileSync("lib/server/import-catalog.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  return runInNewContext(ts.transpileModule(fn.getText(source).replace(/^export /, "") + `;${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}
async function run(rows: any[], photos: Map<string, Uint8Array> | null, mode = "UPSERT", existing = new Map(), invalid = false) {
  const parsed = normalizeCatalog({ productos: rows }); assert.ok(parsed.ok);
  const plan = planCatalog({ products: parsed.value.doc.productos, existing, photoNames: photos ? new Set(photos.keys()) : null, importMode: mode as any });
  const saved = new Map<string, Uint8Array>(); let galleryWrites = 0;
  const apply = actual("applyCatalog", {
    ...results, previewCatalog: async () => plan, BLOCK_SIZE: 50, ADJUSTABLE_STATES: ["MAINTENANCE", "DAMAGED", "LOST"],
    db: { $transaction: async (cb: any) => cb({}) }, recordAudit: async () => {},
    photoFor: async (item: any, _photos: any, failures: any[]) => { if (invalid) { failures.push({ codigo: item.product.codigo, mensaje: "foto inválida" }); return null; } return { data: photos!.get(item.foto) }; },
    writeUnitItem: async (_tx: any, _ctx: any, item: any, photo: any) => {
      const changed = Boolean(photo) && !item.existingId;
      if (changed) saved.set(item.product.codigo, photo.data);
      return { id: item.product.codigo, created: !item.existingId, photo: changed };
    },
    writeExtraPhotos: async () => { galleryWrites++; return true; }, console: { error() {} },
  });
  const out = await apply({ organizationId: "tenant" }, { lote: "test", photos, importMode: mode });
  return { out, saved, galleryWrites };
}
const row = { codigo: "A", nombre: "Silla", tipo: "unidad", cantidad: 0, foto: "a.webp" };
const existing = new Map([["A", { id: "existing", sku: "A", name: "Silla", units: 0, quantity: 0, components: [], isCombo: false } as any]]);
test("actual apply reports new and identical primary destinations separately from absent/no ZIP", async () => {
  const photos = new Map([["a.webp", new Uint8Array([1])]]);
  const fresh = await run([row], photos); assert.equal(fresh.out.resultadoFotos.resumen.modificadas, 1); assert.equal(fresh.saved.size, 1);
  const identical = await run([row], photos, "UPSERT", existing); assert.equal(identical.out.resultadoFotos.resumen.conservadas, 1); assert.equal(identical.out.fotos, 0); assert.equal(identical.out.summary.fotos, 0);
  for (const zip of [null, new Map()]) {
    const absent = await run([row], zip, "UPSERT", existing); assert.equal(absent.out.resultadoFotos.resumen.sinArchivo, 1);
    assert.match(absent.out.resultadoFotos.destinos[0].motivo, zip ? /ausente/ : /Sin ZIP/); assert.equal(absent.saved.size, 0);
  }
});
test("a shared invalid photo reports every destination failed, not only the first cached request", async () => {
  const { out } = await run([row, { ...row, codigo: "B" }], new Map([["a.webp", new Uint8Array([0])]]), "UPSERT", new Map(), true);
  assert.equal(out.resultadoFotos.resumen.fallidas, 2); assert.equal(out.resultadoFotos.resumen.modificadas, 0);
});
test("CREATE_ONLY keeps existing photo destinations without processing an invalid file", async () => {
  const { out, saved } = await run([row], new Map([["a.webp", new Uint8Array([0])]]), "CREATE_ONLY", existing, true);
  assert.equal(out.resultadoFotos.resumen.conservadas, 1); assert.match(out.resultadoFotos.destinos[0].motivo, /Crear sólo nuevos/); assert.equal(saved.size, 0);
});
test("empty gallery preserves no ZIP semantics and records an applied clear as a destination change", async () => {
  const noZip = await run([{ ...row, foto: null, fotos: [] }], null); assert.equal(noZip.galleryWrites, 0);
  const zip = await run([{ ...row, foto: null, fotos: [] }], new Map()); assert.equal(zip.galleryWrites, 1);
  const result = zip.out.resultadoFotos.destinos.find((r: any) => r.alcance === "adicionales"); assert.equal(result.estado, "modificada"); assert.equal(result.cambioAplicado, true); assert.equal(zip.out.fotosExtra, 0);
});
test("summary partitions destinations and exposes partial gallery changes without claiming full success", () => {
  const failed = results.photoResult(results.initialPhotoResult("adicionales", "A", true, true, true), true, "Un archivo inválido");
  const sum = results.summarizePhotoResults([failed]); assert.equal(sum.fallidas, 1); assert.equal(sum.modificadas, 0); assert.equal(sum.cambiosAplicados, 1);
});
test("category and collection classification reads actual scoped bytes and counts only committed image changes", async () => {
  const sourceBytes = new Uint8Array([7, 8]);
  const images: Record<string, Uint8Array | null> = { category: null, collection: null }; let writes = 0; let failCommit = false;
  const delegate = (key: string) => ({
    findFirst: async ({ where }: any) => { assert.equal(where.organizationId, "tenant"); return { imageData: images[key] }; },
    updateMany: async ({ where, data }: any) => { assert.equal(where.organizationId, "tenant"); images[key] = data.imageData; writes++; return { count: 1 }; },
  });
  const tx = { inventoryCategory: delegate("category"), collection: delegate("collection") };
  const plan = { items: [], categories: [{ category: { categoria: "Sillas", subcategoria: null, foto: "a.webp", orden: null }, foto: "a.webp" }], collections: [{ nombre: "Fiestas", foto: "a.webp" }], summary: { omitidos: 0 }, problems: [] };
  const sameBytes = actual("sameBytes", { Buffer });
  const apply = actual("applyCatalog", {
    ...results, sameBytes, previewCatalog: async () => plan, db: { $transaction: async (cb: any) => {
      const before = { ...images }; const out = await cb(tx);
      if (failCommit) { Object.assign(images, before); throw new Error("commit failed"); }
      return out;
    } }, console: { error() {} },
    resolveInventoryCategory: async () => ({ categoryId: "category" }), setCategoryImage: async (_tx: any, org: string, _id: string, photo: any) => { assert.equal(org, "tenant"); images.category = photo.data; writes++; return true; },
    prepareCategoryPhoto: async () => ({ ok: true, photo: { data: sourceBytes } }), prepareImage: async () => ({ ok: true, data: sourceBytes }),
    upsertCollectionByName: async () => ({ id: "collection" }), addItemsToCollection: async () => 0,
    collectionSlug: (s: string) => s.toLowerCase(), COLLECTION_PHOTO_WIDTH: 400,
    recordAudit: async () => {}, ADJUSTABLE_STATES: [],
  });
  const input = { lote: "meta", photos: new Map([["a.webp", sourceBytes]]), collections: [{ nombre: "Fiestas", foto: "a.webp" }] };
  const first = await apply({ organizationId: "tenant" }, input); assert.equal(first.resultadoFotos.resumen.modificadas, 2); assert.equal(writes, 2);
  const repeated = await apply({ organizationId: "tenant" }, input); assert.equal(repeated.resultadoFotos.resumen.conservadas, 2); assert.equal(repeated.fotosCategoria, 0); assert.equal(repeated.fotosColeccion, 0); assert.equal(writes, 2);
  images.category = null; images.collection = null; failCommit = true;
  const rolledBack = await apply({ organizationId: "tenant" }, input);
  assert.equal(rolledBack.resultadoFotos.resumen.fallidas, 2); assert.equal(rolledBack.resultadoFotos.resumen.cambiosAplicados, 0);
  assert.equal(rolledBack.fotosCategoria, 0); assert.equal(rolledBack.fotosColeccion, 0); assert.equal(images.category, null); assert.equal(images.collection, null);
});
