import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in against a disposable local database migrated through stock origin (79).
test("JSON origin import validates tenant IDs and never invents externally rented stock", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
 const url = new URL(process.env.TEST_DATABASE_URL!); assert(["localhost", "127.0.0.1"].includes(url.hostname)); process.env.DATABASE_URL = url.toString();
 const { db } = await import("../lib/server/db");
 const { portalAuditContext } = await import("../lib/server/audit");
 const { applyCatalog, previewCatalog } = await import("../lib/server/import-catalog");
 const { normalizeCatalog, catalogProductForJson } = await import("../lib/import-catalog");
 const org = randomUUID(), foreign = randomUUID(), supplier = randomUUID(), foreignSupplier = randomUUID(), inactive = randomUUID();
 const ctx = portalAuditContext(org, "Origin import QA");
 const input = (rows: Record<string, unknown>[]) => { const parsed = normalizeCatalog({ productos: rows }); assert(parsed.ok); return { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [], importMode: "UPSERT" as const }; };
 const apply = (rows: Record<string, unknown>[]) => applyCatalog(ctx, { ...input(rows), lote: randomUUID() });
 const row = (codigo: string, extra: Record<string, unknown>) => ({ codigo, nombre: `Origin ${codigo}`, tipo: "unidad", precio: 1000, ...extra });
 const item = (sku: string) => db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku } });
 const units = (id: string) => db.inventoryUnit.findMany({ where: { organizationId: org, inventoryId: id }, orderBy: { id: "asc" } });
 try {
  for (const id of [org, foreign]) await db.organization.create({ data: { id, name: "Origin QA", slug: `origin-qa-${id}` } });
  for (const [id, organizationId, active] of [[supplier, org, true], [foreignSupplier, foreign, true], [inactive, org, false]] as const) await db.supplier.create({ data: { id, organizationId, active, name: "Identical supplier name" } });
  await t.test("new owned and consigned units copy item defaults without conflating purchase supplier", async () => {
   const result = await apply([row("OWN", { cantidad: 2, origen_stock: "propio" }), row("CON", { cantidad: 3, origen_stock: "consignado", tercero: { id: supplier, nombre: "Ignored name hint" } })]); assert.deepEqual(result.fallidos, []);
   const owned = await item("OWN"), consigned = await item("CON"); assert.equal(owned.defaultStockOrigin, "OWNED"); assert.equal(consigned.defaultStockOrigin, "CONSIGNED"); assert.equal(consigned.defaultSourceSupplierId, supplier);
   assert.equal((await units(owned.id)).length, 2); const physical = await units(consigned.id); assert.equal(physical.length, 3);
   assert(physical.every(unit => unit.stockOrigin === "CONSIGNED" && unit.ownerSupplierId === supplier && unit.supplierId === null));
  });
  await t.test("new external zero/null records have no physical units and no pending physical count", async () => {
   for (const cantidad of [0, null]) { const sku = cantidad === 0 ? "EXT0" : "EXTNULL"; const result = await apply([row(sku, { cantidad, origen_stock: "externo", tercero: { id: supplier } })]); assert.deepEqual(result.fallidos, []); const saved = await item(sku); assert.equal(saved.quantity, 0); assert.equal(saved.stockCountStatus, "CONFIRMED"); assert.equal(saved.defaultStockOrigin, "EXTERNAL_RENTAL"); assert.equal(saved.defaultSourceSupplierId, supplier); assert.equal((await units(saved.id)).length, 0); }
  });
  await t.test("foreign/inactive/missing supplier and external positive quantity are blocked before writes", async () => {
   for (const [sku, extra] of [["BADFOREIGN", { origen_stock: "consignado", tercero: { id: foreignSupplier } }], ["BADINACTIVE", { origen_stock: "externo", tercero: { id: inactive } }], ["BADMISSING", { origen_stock: "consignado", tercero: { id: randomUUID() } }], ["BADCOUNT", { origen_stock: "externo", tercero: { id: supplier }, cantidad: 1 }], ["BADNAME", { origen_stock: "consignado", tercero: { nombre: "Identical supplier name" } }]] as const) {
    const request = [row(sku, extra)]; const before = await db.inventoryItem.count({ where: { organizationId: org } }); const preview = await previewCatalog(org, input(request)); assert.equal(preview.items[0].accion, "omitir"); assert(preview.problems.some(problem => problem.tipo === "stock-origen-invalido" && problem.nivel === "error")); assert.equal(await db.inventoryItem.count({ where: { organizationId: org } }), before);
    await apply(request); assert.equal(await db.inventoryItem.count({ where: { organizationId: org, sku } }), 0);
   }
  });
  await t.test("absent origin retains defaults and unit history; explicit default replacement rejects atomically", async () => {
   const saved = await item("CON"), before = await units(saved.id);
   await apply([row("CON", { cantidad: null, nombre: "Metadata edited" })]); const reloaded = await item("CON"); assert.equal(reloaded.defaultStockOrigin, "CONSIGNED"); assert.equal(reloaded.defaultSourceSupplierId, supplier); assert.deepEqual(await units(saved.id), before);
   const request = [row("CON", { cantidad: 8, origen_stock: "propio", tercero: null, nombre: "Must not replace metadata" })]; assert.equal((await previewCatalog(org, input(request))).items[0].accion, "omitir"); await apply(request);
   const after = await item("CON"); assert.equal(after.name, "Metadata edited"); assert.equal(after.quantity, reloaded.quantity); assert.deepEqual(await units(saved.id), before);
  });
  await t.test("external default on an existing physical product never deletes units or invents increments", async () => {
   const saved = await item("OWN"), before = await units(saved.id);
   await db.inventoryItem.update({ where: { id: saved.id }, data: { defaultStockOrigin: "EXTERNAL_RENTAL", defaultSourceSupplierId: supplier } });
   await apply([row("OWN", { cantidad: 0 })]); assert.equal((await item("OWN")).quantity, 2); assert.deepEqual(await units(saved.id), before);
   const request = [row("OWN", { cantidad: 3 })]; assert.equal((await previewCatalog(org, input(request))).items[0].accion, "omitir"); await apply(request); assert.equal((await item("OWN")).quantity, 2); assert.deepEqual(await units(saved.id), before);
  });
  await t.test("combos reject their own origin and accept explicit null without creating own units", async () => {
   const bad = [row("BADCOMBO", { tipo: "juego", origen_stock: "propio", componentes: [{ codigo: "CON", cantidad: 1 }] })]; assert.equal((await previewCatalog(org, input(bad))).items[0].accion, "omitir"); await apply(bad); assert.equal(await db.inventoryItem.count({ where: { organizationId: org, sku: "BADCOMBO" } }), 0);
   const result = await apply([row("COMBO", { tipo: "juego", origen_stock: null, tercero: null, componentes: [{ codigo: "CON", cantidad: 1 }] })]); assert.deepEqual(result.fallidos, []); const combo = await item("COMBO"); assert.equal((await units(combo.id)).length, 0); assert.equal(combo.defaultStockOrigin, null);
  });
  await t.test("preview-shaped JSON applied again retains seven maintenance units, tiers and origin", async () => {
   const normalized = normalizeCatalog({ productos: [row("ROUND7", { cantidad: 10, en_mantenimiento: 7, origen_stock: "propio", precios_dias: [{ desde_dias: 5, modo: "total", precio: 300000 }] })] }); assert(normalized.ok);
   const previewCatalogJson = JSON.parse(JSON.stringify({ moneda: "PYG", productos: normalized.value.doc.productos.map(catalogProductForJson) }));
   const reparsed = normalizeCatalog(previewCatalogJson); assert(reparsed.ok);
   const result = await applyCatalog(ctx, { products: reparsed.value.doc.productos, parseProblems: reparsed.value.problems, photos: null, photoProblems: [], lote: randomUUID() }); assert.deepEqual(result.fallidos, []);
   const saved = await item("ROUND7"); const physical = await units(saved.id); assert.equal(physical.length, 10); assert.equal(physical.filter(unit => unit.status === "MAINTENANCE").length, 7); assert.equal(physical.filter(unit => unit.status === "AVAILABLE").length, 3); assert.equal(saved.defaultStockOrigin, "OWNED");
   const tiers = await db.inventoryPriceTier.findMany({ where: { organizationId: org, inventoryId: saved.id }, select: { audience: true, fromDays: true, mode: true, price: true } }); assert.deepEqual(tiers, [{ audience: "RETAIL", fromDays: 5, mode: "TOTAL", price: 300000 }]);
  });
 } finally { await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } }); await db.$disconnect(); }
});
