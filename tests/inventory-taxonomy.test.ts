import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import {
  CATEGORY_SEPARATOR,
  buildCategoryTree,
  categoryKey,
  categoryLabel,
  categoryNameValid,
  categoryParts,
  categoryPathKey,
  parseCategoryInput,
} from "../lib/inventory-categories";
import {
  conditionLabel,
  formatInventoryLocation,
  normalizeWarehouseCode,
  readConditionScore,
  readInventoryLocation,
  warehouseCodeValid,
} from "../lib/field-rules";
import { readBulkChanges, ITEM_BULK_FIELDS, UNIT_BULK_FIELDS } from "../lib/inventory-bulk";
import { normalizeCatalog, planCatalog } from "../lib/import-catalog";
import { IMPORT_MODULES, importHeaders } from "../lib/import-modules";
import { roleCan } from "../lib/server/permissions";

const ROOT = new URL("..", import.meta.url).pathname;
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");

// ── Categorías: claves, rutas y espejo de texto ────────────────────────────

test("la clave ignora mayúsculas, tildes y espacios: «Vajilla» y «vajilla » son la misma categoría", () => {
  assert.equal(categoryKey("Vajilla"), categoryKey("  vajilla "));
  assert.equal(categoryKey("Sillería"), categoryKey("SILLERIA"));
  assert.equal(categoryKey("Mesas   altas"), "mesas altas");
  assert.equal(categoryPathKey("Vajilla", "Copas"), "vajilla/copas");
  assert.equal(categoryPathKey("Mobiliario", "Sofás"), "mobiliario/sofas");
});

test("«Categoría / Subcategoría», «>» y «›» en un solo texto crean padre e hija; sin dato es «General»", () => {
  for (const raw of ["Mobiliario / Sofás", "Mobiliario > Sofás", "Mobiliario › Sofás", "Mobiliario/Sofás"]) {
    assert.deepEqual(parseCategoryInput(raw), { parent: "Mobiliario", child: "Sofás" }, raw);
  }
  assert.deepEqual(parseCategoryInput("Vajilla", "Copas"), { parent: "Vajilla", child: "Copas" });
  assert.deepEqual(parseCategoryInput("Vajilla / Platos", "Copas"), { parent: "Vajilla", child: "Copas" }, "la subcategoría explícita manda");
  assert.deepEqual(parseCategoryInput("A / B / C"), { parent: "A", child: "B - C" }, "un solo nivel de hija: el resto se une");
  assert.deepEqual(parseCategoryInput(""), { parent: "General", child: null });
  assert.deepEqual(parseCategoryInput(undefined, "Copas"), { parent: "General", child: "Copas" });
  assert.equal(parseCategoryInput("x".repeat(100)).parent.length, 60);
});

test("el espejo de texto es «Categoría › Subcategoría» y los nombres no admiten separadores", () => {
  assert.equal(CATEGORY_SEPARATOR, " › ");
  assert.equal(categoryLabel("Vajilla", "Copas"), "Vajilla › Copas");
  assert.equal(categoryLabel("Vajilla"), "Vajilla");
  assert.equal(categoryNameValid("Copas"), true);
  for (const bad of ["", "   ", "A/B", "A>B", "A›B", "x".repeat(61)]) assert.equal(categoryNameValid(bad), false, bad);
});

test("el árbol tiene un nivel, ordenado por orden y nombre, y se resuelve el padre y la hija de un id", () => {
  const row = (id: string, name: string, parentId: string | null, sortOrder = 0) => ({ id, name, parentId, key: name.toLowerCase(), sortOrder, color: null, icon: null, archivedAt: null, itemCount: 1 });
  const tree = buildCategoryTree([row("c2", "Copas", "v"), row("v", "Vajilla", null, 1), row("s", "Sillas", null, 0), row("c1", "Platos", "v")]);
  assert.deepEqual(tree.map((n) => n.name), ["Sillas", "Vajilla"]);
  assert.deepEqual(tree[1].children.map((n) => n.name), ["Copas", "Platos"]);
  assert.deepEqual(categoryParts(tree, "c2"), { parent: "Vajilla", child: "Copas" });
  assert.deepEqual(categoryParts(tree, "s"), { parent: "Sillas", child: "" });
  assert.equal(categoryParts(tree, "nope"), null);
});

// ── Depósito, ubicación y condición ────────────────────────────────────────

test("«d1 e3 b2» se guarda E3-B2 y se ve D1-E3-B2; los tramos inválidos se rechazan", () => {
  assert.equal(readInventoryLocation("d1 e3 b2", "D1"), "E3-B2");
  assert.equal(formatInventoryLocation("D1", "E3-B2"), "D1-E3-B2");
  assert.equal(readInventoryLocation("e3-b2", "D1"), "E3-B2");
  assert.equal(readInventoryLocation("D2 E3 B2", "D1"), "D2-E3-B2", "otro código no se descarta: es un tramo más");
  assert.equal(readInventoryLocation("  ", "D1"), null);
  assert.equal(readInventoryLocation(null), null);
  assert.equal(readInventoryLocation("ESTANTE1"), false, "más de 4 caracteres por tramo");
  assert.equal(readInventoryLocation("A B C D E"), false, "más de 4 tramos");
  assert.equal(readInventoryLocation("E3#B2"), false);
  assert.equal(readInventoryLocation(12), false);
  assert.equal(formatInventoryLocation("D1", null), "D1");
  assert.equal(formatInventoryLocation(null, null), null);
});

test("la condición va de 1 a 10: 0 y 11 se rechazan y se muestra «8/10 · 80 %»", () => {
  for (const bad of [0, 11, -1, 1.5, "0", "11", "x", true]) assert.equal(readConditionScore(bad), false, String(bad));
  for (const [raw, value] of [[1, 1], [10, 10], ["8", 8], [8, 8]] as const) assert.equal(readConditionScore(raw), value);
  for (const empty of [null, undefined, ""]) assert.equal(readConditionScore(empty), null);
  assert.equal(conditionLabel(8), "8/10 · 80 %");
  assert.equal(conditionLabel(null), "Sin evaluar");
});

test("el código de depósito: una letra y hasta cinco letras o números en mayúsculas", () => {
  assert.equal(normalizeWarehouseCode(" d-1 "), "D1");
  assert.equal(warehouseCodeValid("D1"), true);
  assert.equal(warehouseCodeValid("DEP123"), true);
  for (const bad of ["", "1D", "DEPOSITO", "!!"]) assert.equal(warehouseCodeValid(bad), false, bad);
});

// ── Edición masiva ─────────────────────────────────────────────────────────

test("edición masiva: Subcategoría solo viaja con su Categoría y las unidades suman depósito, ubicación, condición y compra", () => {
  assert.ok(ITEM_BULK_FIELDS.some((field) => field.key === "subcategory"));
  for (const key of ["warehouseId", "location", "conditionScore", "supplierId", "purchasedAt", "warrantyUntil"]) assert.ok(UNIT_BULK_FIELDS.some((field) => field.key === key), key);
  assert.equal(readBulkChanges("items", { subcategory: "Copas" }), null);
  assert.deepEqual(readBulkChanges("items", { category: "Vajilla", subcategory: "Copas" }), { category: "Vajilla", subcategory: "Copas" });
  assert.equal(readBulkChanges("items", { category: "Vajilla", subcategory: "x".repeat(61) }), null);
  assert.deepEqual(readBulkChanges("units", { warehouseId: "wh_1", location: "E3-B2", conditionScore: 7, purchasedAt: "2026-10-01" }), { warehouseId: "wh_1", location: "E3-B2", conditionScore: 7, purchasedAt: "2026-10-01" });
  assert.deepEqual(readBulkChanges("units", { conditionScore: null, supplierId: null, location: null }), { conditionScore: "", supplierId: "", location: "" });
  for (const bad of [{ conditionScore: 0 }, { conditionScore: 11 }, { conditionScore: "8" }, { purchasedAt: "01/10/2026" }, { warehouseId: null }, { warehouseId: "" }]) assert.equal(readBulkChanges("units", bad), null, JSON.stringify(bad));
});

// ── Importar productos ─────────────────────────────────────────────────────

const parse = (productos: Array<Record<string, unknown>>) => {
  const parsed = normalizeCatalog({ productos });
  assert.ok(parsed.ok);
  return parsed.value;
};

test("importar: categoria + subcategoria, «Categoría / Subcategoría» y el valor por defecto", () => {
  const { doc } = parse([
    { codigo: "1", nombre: "Copa de vino", categoria: "Vajilla", subcategoria: "Copas" },
    { codigo: "2", nombre: "Sillón chesterfield", categoria: "Mobiliario / Sofás" },
    { codigo: "3", nombre: "Plato playo", categoria: "Vajilla > Platos" },
    { codigo: "4", nombre: "Cubierto", categoria: null },
    { codigo: "5", nombre: "Mantel", categoria: "Textil", subcategoria: "" },
  ]);
  const by = (code: string) => doc.productos.find((p) => p.codigo === code)!;
  assert.deepEqual([by("1").categoria, by("1").subcategoria], ["Vajilla", "Copas"]);
  assert.deepEqual([by("2").categoria, by("2").subcategoria], ["Mobiliario", "Sofás"]);
  assert.deepEqual([by("3").categoria, by("3").subcategoria], ["Vajilla", "Platos"]);
  assert.deepEqual([by("4").categoria, by("4").subcategoria], ["General", null]);
  assert.deepEqual([by("5").categoria, by("5").subcategoria], ["Textil", null]);
});

test("importar: depósito y ubicación opcionales; un valor mal escrito avisa y se ignora, uno inexistente avisa en la vista previa", () => {
  const { doc, problems } = parse([
    { codigo: "1", nombre: "Copa de vino", deposito: "d2", ubicacion: "d2 e3 b2" },
    { codigo: "2", nombre: "Plato playo", deposito: "DEPOSITO GRANDE 99", ubicacion: "ESTANTE9" },
    { codigo: "3", nombre: "Cubierto" },
  ]);
  assert.deepEqual([doc.productos[0].deposito, doc.productos[0].ubicacion], ["D2", "E3-B2"]);
  assert.deepEqual([doc.productos[1].deposito, doc.productos[1].ubicacion], [null, null]);
  assert.deepEqual([doc.productos[2].deposito, doc.productos[2].ubicacion], [null, null]);
  assert.ok(problems.some((p) => p.tipo === "deposito-invalido" && p.nivel === "aviso" && p.codigo === "2"));
  assert.ok(problems.some((p) => p.tipo === "ubicacion-invalida" && p.nivel === "aviso" && p.codigo === "2"));
  const plan = planCatalog({ products: doc.productos, existing: new Map(), photoNames: null, warehouseCodes: new Set(["D1"]) });
  assert.ok(plan.problems.some((p) => p.tipo === "deposito-inexistente" && p.codigo === "1"), "D2 no existe en la empresa");
  assert.equal(plan.problems.filter((p) => p.tipo === "deposito-inexistente").length, 1);
  assert.equal(plan.items.every((item) => item.accion === "crear"), true, "el depósito inexistente no frena la importación");
});

test("plantilla, prompt de ChatGPT e instrucciones de la IA hablan de categoría, subcategoría, depósito y ubicación", () => {
  const productos = IMPORT_MODULES.productos;
  const headers = importHeaders(productos);
  for (const key of ["categoria", "subcategoria", "deposito", "ubicacion"]) assert.ok(headers.includes(key), key);
  for (const text of [productos.chatgptPrompt, productos.iaInstructions]) {
    for (const word of ["subcategoria", "deposito", "ubicacion", "Vajilla / Copas"]) assert.ok(text.includes(word), `falta «${word}»`);
  }
  assert.ok(productos.instructions.some((line) => line.includes("Categoría y subcategoría")));
  // La numeración de las reglas del prompt es correlativa (sin saltos ni repetidos).
  const numbers = [...productos.chatgptPrompt.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, numbers.map((_, index) => index + 1));
});

// ── Permisos (servidor) ────────────────────────────────────────────────────

test("VIEWER no muta nada; OPERATIONS carga y cuenta pero no entra a Ajustes → Inventario", () => {
  assert.equal(roleCan("VIEWER", "inventory.write"), false);
  assert.equal(roleCan("VIEWER", "org.manage"), false);
  assert.equal(roleCan("FINANCE", "inventory.write"), false);
  assert.equal(roleCan("OPERATIONS", "inventory.write"), true);
  assert.equal(roleCan("OPERATIONS", "org.manage"), false);
  assert.equal(roleCan("ADMIN", "org.manage"), true);
  assert.equal(roleCan("OWNER", "org.manage"), true);
  const categories = source("app/api/admin/inventory/categories/route.ts");
  const warehouses = source("app/api/admin/inventory/warehouses/route.ts");
  assert.match(categories, /kind === "quick" \? "inventory\.write" : "org\.manage"/, "alta rápida con inventory.write; el resto con org.manage");
  assert.match(warehouses, /kind === "move-units" \? "inventory\.write" : "org\.manage"/);
  assert.match(categories, /export async function GET\(\) \{\s*const auth = await requireAdminContext\(\);/, "leer lo ve cualquier rol");
  assert.match(source("lib/admin-policy.ts"), /"\/ajustes\/inventario": \["OWNER", "ADMIN"\]/);
  assert.match(source("components/admin/modules/AjustesTabs.tsx"), /key: "inventario"[^}]*restricted: true/);
  assert.match(source("app/api/admin/inventory/route.ts"), /export async function POST\(request: Request\) \{\s*const auth = await requireAdminContext\("inventory\.write"\)/);
});

// ── Un solo escritor de `category` ─────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("nadie escribe InventoryItem.category sin pasar por el helper resolveInventoryCategory", () => {
  const writers: string[] = [];
  for (const file of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib")), ...walk(join(ROOT, "components"))]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/inventoryItem\.(?:create|createMany|update|updateMany|upsert)\(/g)) {
      // Argumentos de la llamada: hasta el paréntesis que la cierra.
      let depth = 0;
      let end = match.index! + match[0].length - 1;
      for (; end < text.length; end += 1) {
        if (text[end] === "(") depth += 1;
        if (text[end] === ")" && --depth === 0) break;
      }
      const window = text.slice(match.index!, end + 1);
      const writesCategory = /\bcategory\s*:/.test(window) || /\bcategory,/.test(window);
      // `inventory-categories.ts` ES el helper: renombrar/mover/unir reescriben el espejo de texto ahí y en ningún otro lado.
      if (writesCategory && !/categoryWriteData/.test(window) && !file.endsWith("lib/server/inventory-categories.ts")) writers.push(`${relative(ROOT, file)}: ${window.slice(0, 80).replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(writers, [], "un escritor de `category` sin el helper");
  // Los puntos de entrada usan el helper.
  for (const file of ["app/api/admin/resources/route.ts", "app/api/admin/inventory/route.ts", "lib/server/import-catalog.ts", "lib/server/inventory-combos.ts", "app/api/admin/inventory/categories/route.ts", "lib/server/demo-inventory-taxonomy.ts"]) {
    assert.match(source(file), /resolveInventoryCategory/, `${file} no usa resolveInventoryCategory`);
  }
  // La demo siembra el texto y después lo reescribe con el helper en la misma transacción.
  assert.match(source("lib/server/demo-data.ts"), /await seedDemoInventoryTaxonomy\(tx,/);
});

test("la migración es aditiva e idempotente: IF NOT EXISTS, guardas duplicate_object y backfill por clave", () => {
  const sql = source("prisma/migrations/202610240001_inventory_taxonomy_warehouses/migration.sql");
  assert.ok(!/DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN|TRUNCATE|DELETE\s+FROM/i.test(sql.replace(/DROP TABLE IF EXISTS _inv_cat_src/g, "")), "no destruye nada");
  for (const create of sql.matchAll(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) assert.fail(`índice sin IF NOT EXISTS: ${create[0]}`);
  for (const create of sql.matchAll(/CREATE TABLE (?!IF NOT EXISTS)/g)) assert.fail(`tabla sin IF NOT EXISTS: ${create[0]}`);
  for (const add of sql.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/g)) assert.fail(`columna sin IF NOT EXISTS: ${add[0]}`);
  assert.equal((sql.match(/ADD CONSTRAINT/g) ?? []).length, (sql.match(/EXCEPTION WHEN duplicate_object THEN NULL/g) ?? []).length, "cada constraint con su guarda");
  assert.match(sql, /"conditionScore" >= 1 AND "conditionScore" <= 10/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /"categoryId" IS NULL/, "el backfill solo toca lo que no está ligado");
  // El texto `category` solo se reescribe al espejo «Padre › Hija», y únicamente donde difiere (idempotente).
  const textUpdates = [...sql.matchAll(/UPDATE "InventoryItem"[^;]*SET "category"[^;]*;/g)].map((match) => match[0]);
  assert.equal(textUpdates.length, 1, "una sola normalización del texto");
  assert.match(textUpdates[0]!, /' › '/);
  assert.match(textUpdates[0]!, /"category" IS DISTINCT FROM/, "solo toca las filas que difieren");
  assert.match(textUpdates[0]!, /"categoryId" = c\."id"/, "solo productos ya ligados a una categoría");
});

test("la migración de categorías no depende de normalize(): con PostgreSQL < 13 o sin UTF8 usa translate", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = readdirSync("prisma/migrations").find((name) => name.startsWith("202610240001_"))!;
  const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, "utf8");
  assert.match(sql, /current_setting\('server_version_num'\)::int >= 130000 AND current_setting\('server_encoding'\) = 'UTF8'/);
  assert.match(sql, /ELSE[\s\S]*translate\(t,/);
  assert.doesNotMatch(sql, /\$b\$\$f\$/, "sin «$$» pegados que cierren el bloque DO");
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.equal((code.match(/normalize\(/g) ?? []).length, 1, "normalize( solo dentro de la función condicional");
});
