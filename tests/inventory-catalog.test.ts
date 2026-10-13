import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { products } from "../lib/catalog";
import { LEDBOX_INVENTORY_CATALOG, ledboxInventoryItemId } from "../lib/server/inventory-catalog";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Inventario de arranque (issue #86): los 7 productos del catálogo de la landing
 * cargados como ítems de inventario de LedBox, con su imagen y sin costos
 * internos. La provisión vive en la migración
 * `202609300001_inventory_item_image` y en el seed: este test mantiene las tres
 * listas alineadas y deja la migración re-ejecutable (columna aditiva + ON
 * CONFLICT DO NOTHING).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("el inventario de arranque es el catálogo de la landing, sin costos internos", () => {
  assert.equal(LEDBOX_INVENTORY_CATALOG.length, products.length);
  for (const [index, item] of LEDBOX_INVENTORY_CATALOG.entries()) {
    const product = products[index];
    assert.equal(item.slug, product.id);
    assert.equal(item.sku, product.code);
    assert.equal(item.name, product.name);
    assert.equal(item.imageUrl, product.image);
    assert.match(item.imageUrl, /^\/assets\/products\/[a-z-]+\.png$/);
    assert.ok(item.category.trim().length > 0, `${item.slug}: sin categoría`);
    assert.equal(item.kind, "REUSABLE");
    assert.equal(item.quantity, 1);
    // El precio de alquiler de la landing no se copia: son costos internos.
    assert.equal(item.replacementCost, 0);
    assert.equal(item.dailyCost, 0);
    // Notas = descripción + specs de la ficha, sin importes.
    assert.equal(item.notes, `${product.description} ${product.specs}`);
    assert.equal(/Gs\.|\d{3}\.\d{3}/.test(item.notes), false, `${item.slug}: las notas no llevan precio`);
  }
});

test("la migración es aditiva e idempotente y provisiona cada ítem del catálogo", () => {
  const sql = repoFile("prisma/migrations/202609300001_inventory_item_image/migration.sql");
  assert.match(sql, /ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /WHERE o\."id" = 'org_ledbox'/);
  for (const item of LEDBOX_INVENTORY_CATALOG) {
    assert.ok(sql.includes(ledboxInventoryItemId("org_ledbox", item.slug)), `falta el id de ${item.slug}`);
    assert.ok(sql.includes(item.sku), `falta el código de ${item.slug}`);
    assert.ok(sql.includes(item.name), `falta el nombre de ${item.slug}`);
    assert.ok(sql.includes(item.category), `falta la categoría de ${item.slug}`);
    assert.ok(sql.includes(item.imageUrl), `falta la imagen de ${item.slug}`);
    assert.ok(sql.includes(item.notes), `faltan las notas de ${item.slug}`);
  }
});

test("el schema declara la imagen y la fila del panel la tipa", () => {
  const schema = repoFile("prisma/schema.prisma");
  assert.match(schema, /model InventoryItem \{[\s\S]*?imageUrl\s+String\?/);
  const types = repoFile("lib/admin-types.ts");
  assert.match(types, /export type AdminInventoryRow = \{[\s\S]*?imageUrl: string \| null;/);
});

test("la miniatura del inventario cae al ícono y nunca deja un cuadro roto", () => {
  const box = repoFile("components/admin/AdminImageBox.tsx");
  assert.match(box, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(box, /<AdminIcon name=\{icon\}/);
  const module = inventoryModuleSource();
  assert.match(module, /function InventoryThumb/);
  assert.match(module, /<AdminImageBox imageUrl=\{item\.imageUrl\} size=\{size\} \/>/);
  assert.match(module, /label="Imagen \(URL\)"/);
  assert.match(module, /inventoryImageError\(image\)/);
});
