import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/202611110001_sales_product_catalog/migration.sql", "utf8");

test("catálogo comercial persiste separado del inventario de alquiler", () => {
  const product = schema.match(/model SalesProduct \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(product);
  assert.match(product, /organizationId\s+String/);
  assert.match(product, /@@unique\(\[organizationId, sku\]\)/);
  assert.doesNotMatch(product, /InventoryItem|quantity|stock/i);
  assert.match(schema, /model SalesProductFamily \{/);
  assert.match(schema, /model SalesProductImage \{/);
});

test("costos y precios permiten desconocidos y las relaciones validan empresa", () => {
  assert.match(schema, /originCost\s+Json\?/);
  assert.match(schema, /landedCost\s+Json\?/);
  assert.match(schema, /amount\s+Decimal\? @db\.Decimal\(14, 2\)/);
  assert.match(schema, /references: \[id, organizationId\], onDelete: Cascade/);
  assert.match(migration, /FOREIGN KEY \("productId", "organizationId"\)/);
  assert.match(migration, /FOREIGN KEY \("familyId", "organizationId"\)/);
});

test("la migración es aditiva y no inserta ni migra productos reales", () => {
  assert.match(migration, /CREATE TABLE "SalesProduct"/);
  assert.doesNotMatch(migration, /INSERT INTO|UPDATE "InventoryItem"|DELETE FROM/i);
  assert.doesNotMatch(migration, /ALTER TABLE "InventoryItem"/);
});
