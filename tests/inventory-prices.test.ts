import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Precios de venta del inventario (issues #90 y #110): cada frente tiene su
 * precio normal y su regla «desde X días», más el mínimo como piso. Las
 * migraciones son aditivas, idempotentes y re-ejecutables y no cargan valores
 * de arranque; el alta y la edición validan con las reglas puras de
 * `lib/field-rules.ts` y la UI los muestra en lista, tarjetas y detalle.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** Los siete campos del modelo de precios (issues #90 y #110). */
const PRICE_COLUMNS = [
  "listPrice",
  "listFromDays",
  "listFromPrice",
  "wholesalePrice",
  "wholesaleFromDays",
  "wholesaleFromPrice",
  "minimumPrice",
] as const;

test("las migraciones de precios son aditivas, re-ejecutables y sin valores de arranque", () => {
  const sale = repoFile("prisma/migrations/202609300002_inventory_sale_prices/migration.sql");
  for (const column of ["listPrice", "wholesalePrice", "minimumPrice", "wholesaleFromDays"]) {
    assert.match(
      sale,
      new RegExp(`ADD COLUMN IF NOT EXISTS "${column}" INTEGER NOT NULL DEFAULT 0`),
      `${column}: falta la columna idempotente con default 0 (issue #90)`,
    );
  }
  const fronts = repoFile("prisma/migrations/202610010002_inventory_price_fronts/migration.sql");
  for (const column of ["listFromDays", "listFromPrice", "wholesaleFromPrice"]) {
    assert.match(
      fronts,
      new RegExp(`ADD COLUMN IF NOT EXISTS "${column}" INTEGER NOT NULL DEFAULT 0`),
      `${column}: falta la columna idempotente con default 0 (issue #110)`,
    );
  }
  // Sin provisión ni backfill: los precios los carga el dueño.
  assert.equal(/\bINSERT\b/i.test(sale + fronts), false);
  assert.equal(/\bUPDATE\b/i.test(sale + fronts), false);
});

test("el schema define los siete precios con default 0", () => {
  const schema = repoFile("prisma/schema.prisma");
  const model = schema.match(/model InventoryItem \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(model.length > 0, "no se encontró el modelo InventoryItem");
  for (const column of PRICE_COLUMNS) {
    assert.match(model, new RegExp(`${column}\\s+Int\\s+@default\\(0\\)`), `${column}: falta el campo con default 0`);
  }
});

test("el contrato del panel tipa los precios y las rutas los validan de una vez", () => {
  const types = repoFile("lib/admin-types.ts");
  for (const column of PRICE_COLUMNS) {
    assert.match(types, new RegExp(`${column}: number`), `${column}: falta en AdminInventoryRow`);
  }
  for (const route of ["app/api/admin/resources/route.ts", "app/api/admin/inventory/route.ts"]) {
    assert.match(repoFile(route), /readInventoryPriceValues\(body\)|readInventoryPriceValues\(/, `${route}: falta la validación compartida`);
  }
  const create = repoFile("app/api/admin/resources/route.ts");
  assert.match(create, /inventoryPriceWarning\(/);
  const update = repoFile("app/api/admin/inventory/route.ts");
  assert.match(update, /kind === "prices"/);
  assert.match(update, /inventoryPriceWarning\(/);
});

test("el módulo Inventario muestra y edita los precios por frente", () => {
  const module = inventoryModuleSource();
  assert.match(module, /label: "Lista", end: true/, "la lista muestra el precio de lista");
  assert.match(module, /label: "Mayorista", end: true/, "y el mayorista, cada uno en su columna");
  // El bloque por frente lo comparten el alta y la edición.
  assert.match(module, /function PriceFrontFields/);
  for (const title of ["Precio cliente final", "Precio mayorista", "Precio mínimo"]) {
    assert.ok(
      module.includes(`title="${title}"`) || module.includes(`>${title}<`),
      `falta el bloque «${title}»`,
    );
  }
  for (const label of ["Precio normal", "Piso de venta"]) {
    assert.ok(module.includes(`label="${label}"`), `falta el campo «${label}»`);
  }
  // «Desde (días)» y «Precio desde esos días» son ahora las filas de la tabla «Precio por días» (escalones).
  assert.ok(module.includes("Desde (días)") && module.includes("Precio por días"), "falta la tabla «Precio por días»");
  assert.match(module, /Editar producto: \$\{item\.name\}/);
  assert.match(module, /submitEditItem/);
  // El resumen legible y el aviso de coherencia se ven en lista/tarjetas/detalle.
  assert.match(module, /priceFrontText\("Final"/);
  assert.match(module, /priceFrontText\("Mayorista"/);
  assert.match(module, /formPriceWarning/);
  assert.match(module, /const priceWarning = inventoryPriceWarning\(/, "la ficha avisa precios incoherentes");
});
