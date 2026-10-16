import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  FAMILY_MAX_AXES,
  commonNamePrefix,
  deriveFamilyCode,
  mergeAxisValues,
  normalizeAxisKey,
  readFamilyAxes,
  readFamilyCode,
  readSwatch,
  readVariantOptions,
  variantDisplayName,
  variantKey,
  variantNameFits,
  type FamilyAxis,
} from "../lib/inventory-variants";
import { roleCan } from "../lib/server/permissions";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function axesOrThrow(raw: unknown): FamilyAxis[] {
  const parsed = readFamilyAxes(raw);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return parsed.axes;
}

test("las claves de eje se normalizan: minúsculas, sin tildes", () => {
  assert.equal(normalizeAxisKey("Talle"), "talle");
  assert.equal(normalizeAxisKey(" Tamaño de mesa "), "tamano-de-mesa");
  assert.equal(normalizeAxisKey("COLOR"), "color");
});

test("ejes: hasta 2, hasta 30 valores de 40 caracteres, sin repetidos", () => {
  assert.equal(readFamilyAxes([]).ok, false);
  assert.equal(readFamilyAxes("x").ok, false);
  assert.equal(readFamilyAxes([{ label: "A" }, { label: "B" }, { label: "C" }]).ok, false, `más de ${FAMILY_MAX_AXES} ejes`);
  assert.equal(readFamilyAxes([{ label: "Color" }, { label: "color" }]).ok, false, "mismo eje dos veces");
  assert.equal(readFamilyAxes([{ label: "Talle", values: Array.from({ length: 31 }, (_, i) => String(i)) }]).ok, false, "31 valores");
  assert.equal(readFamilyAxes([{ label: "Talle", values: ["x".repeat(41)] }]).ok, false, "valor de 41 caracteres");
  assert.equal(readFamilyAxes([{ label: "Color", values: ["Verde", "verde"] }]).ok, false, "repetido ignorando mayúsculas");
  assert.equal(readFamilyAxes([{ label: "Color", values: ["Verde", "Véstida"] }]).ok, true);
  const ok = axesOrThrow([{ label: "Talle", values: ["35", { value: "36" }] }]);
  assert.deepEqual(ok[0].values, [{ value: "35" }, { value: "36" }]);
});

test("la muestra hex es opcional, solo del eje color y con formato #RRGGBB", () => {
  const axes = axesOrThrow([{ label: "Color", values: [{ value: "Verde", swatch: "#4b6b3a" }, { value: "Lila" }] }]);
  assert.deepEqual(axes[0].values, [{ value: "Verde", swatch: "#4B6B3A" }, { value: "Lila" }]);
  for (const bad of ["4B6B3A", "#4B6B3", "#GGGGGG", "verde", "#4B6B3A00"]) {
    assert.equal(readFamilyAxes([{ label: "Color", values: [{ value: "Verde", swatch: bad }] }]).ok, false, `rechaza ${bad}`);
  }
  assert.equal(readFamilyAxes([{ label: "Talle", values: [{ value: "35", swatch: "#4B6B3A" }] }]).ok, false, "un talle no lleva muestra");
  assert.equal(readSwatch("#abcdef"), "#ABCDEF");
  assert.equal(readSwatch("abc"), null);
});

test("opciones de una variante: exactamente los ejes de la familia", () => {
  const axes = axesOrThrow([{ label: "Color", values: ["Negro", "Blanco"] }, { label: "Talle", values: ["35", "36"] }]);
  const ok = readVariantOptions({ Color: "negro", talle: " 35 " }, axes);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.options, { color: "Negro", talle: "35" }, "usa la escritura canónica del eje");
  assert.equal(readVariantOptions({ color: "Negro" }, axes).ok, false, "falta un eje");
  assert.equal(readVariantOptions({ color: "Negro", talle: "35", largo: "x" }, axes).ok, false, "eje de más");
  assert.equal(readVariantOptions({ color: "Negro", talle: "" }, axes).ok, false, "valor vacío");
  assert.equal(readVariantOptions({ color: "Negro", talle: "9".repeat(41) }, axes).ok, false);
  const nuevo = readVariantOptions({ color: "Rojo", talle: "37" }, axes);
  assert.ok(nuevo.ok && nuevo.options.color === "Rojo", "un valor nuevo se acepta (el escritor lo suma al eje)");
});

test("clave de la combinación y nombre completo", () => {
  const axes = axesOrThrow([{ label: "Color", values: ["Negro"] }, { label: "Talle", values: ["35"] }]);
  assert.equal(variantKey({ color: "Negro", talle: "35" }, axes), "color=negro|talle=35");
  assert.equal(variantKey({ talle: "35", color: "NEGRO" }, axes), "color=negro|talle=35", "el orden lo dan los ejes, no las opciones");
  assert.equal(variantKey({ color: "Verde", talle: "Ñandú" }, axes), "color=verde|talle=nandu");
  assert.equal(variantDisplayName("Zapato Ola", { color: "Negro", talle: "35" }, axes), "Zapato Ola · Negro · 35");
  const color = axesOrThrow([{ label: "Color", values: ["Verde"] }]);
  assert.equal(variantDisplayName("Plato Arabesco", { color: "Verde" }, color), "Plato Arabesco · Verde");
  assert.equal(variantNameFits("x".repeat(115), { color: "Verde" }, color), false, "el nombre completo tiene que entrar en 120");
  assert.equal(variantNameFits("Plato", { color: "Verde" }, color), true);
});

test("código de la familia: derivado del nombre y con las reglas del SKU", () => {
  assert.equal(deriveFamilyCode("Plato Arabesco"), "PLATO-ARABESCO");
  assert.equal(deriveFamilyCode("  Zapato  Ola!! "), "ZAPATO-OLA");
  assert.equal(deriveFamilyCode("¡¡"), "FAMILIA");
  assert.equal(readFamilyCode("PLATO-ARABESCO"), "PLATO-ARABESCO");
  assert.equal(readFamilyCode("con/barra"), null);
  assert.equal(readFamilyCode("x".repeat(61)), null);
  assert.equal(readFamilyCode(""), null);
});

test("valores nuevos se suman a los ejes sin duplicar ni perder muestras", () => {
  const axes = axesOrThrow([{ label: "Color", values: [{ value: "Verde", swatch: "#4B6B3A" }] }]);
  const merged = mergeAxisValues(axes, [{ color: "verde" }, { color: "Lila" }]);
  assert.deepEqual(merged[0].values, [{ value: "Verde", swatch: "#4B6B3A" }, { value: "Lila" }]);
});

test("nombre sugerido al agrupar: el prefijo común sin palabras cortadas", () => {
  assert.equal(commonNamePrefix(["Plato Arabesco Verde", "Plato Arabesco Lila"]), "Plato Arabesco");
  assert.equal(commonNamePrefix(["Plato Arabesco · Verde", "Plato Arabesco · Lila"]), "Plato Arabesco");
  assert.equal(commonNamePrefix(["Silla A", "Mesa B"]), "");
  assert.equal(commonNamePrefix(["Copa"]), "Copa");
});

test("permisos: solo quien tiene inventory.write muta; VIEWER y FINANCE no", () => {
  for (const role of ["OWNER", "ADMIN", "OPERATIONS"] as const) assert.equal(roleCan(role, "inventory.write"), true, role);
  for (const role of ["VIEWER", "FINANCE"] as const) assert.equal(roleCan(role, "inventory.write"), false, role);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((entry) => {
    const rel = path.join(dir, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    return statSync(path.join(root, rel)).isDirectory() ? sourceFiles(rel) : /\.(ts|tsx)$/.test(entry) ? [rel] : [];
  });
}

test("rutas de familias exigen inventory.write; recuperación y purga exigen trash.manage", () => {
  const routes = sourceFiles("app/api/admin/inventory/families");
  assert.ok(routes.length >= 4, "rutas de familias");
  for (const file of routes) {
    const source = read(file);
    for (const match of source.matchAll(/export async function (GET|POST|PATCH|DELETE)\(/g)) {
      const body = source.slice(match.index!, source.indexOf("\n}\n", match.index!));
      if (match[1] === "GET") assert.match(body, /requireAdminContext\(\)/, `${file} GET`);
      else if (file === "app/api/admin/inventory/families/[id]/[action]/route.ts") {
        assert.equal(match[1], "POST");
        assert.match(body, /requireAdminContext\("trash\.manage"\)/, `${file} recuperación restringida a OWNER/ADMIN`);
      } else assert.match(body, /requireAdminContext\("inventory\.write"\)/, `${file} ${match[1]}`);
    }
  }
});

test("un solo escritor: nadie más que el módulo de familias (y la demo) escribe las columnas de variante", () => {
  const writers = new Set(["lib/server/inventory-families.ts", "lib/server/demo-families.ts"]);
  const offenders = [...sourceFiles("lib"), ...sourceFiles("app"), ...sourceFiles("components")].filter((file) => {
    if (writers.has(file)) return false;
    return /\b(variantKey|variantOptions|variantOwnPrice|variantSortOrder)\s*:/.test(read(file)) && /data\s*:|\.update\(|\.create\(|updateMany\(|createMany\(/.test(read(file)) && !/^(lib\/inventory-variants|lib\/admin-types)/.test(file) && !file.endsWith(".d.ts");
  });
  assert.deepEqual(offenders, [], "las columnas de variante solo las escribe lib/server/inventory-families.ts");
});

test("el editor de productos no puede renombrar ni recategorizar una variante", () => {
  const route = read("app/api/admin/inventory/route.ts");
  assert.match(route, /existing\.familyId && update\.data\.name !== undefined/, "nombre");
  assert.match(route, /family-category/, "categoría");
  assert.match(route, /markOwnPrice\(tx, organizationId, \[existing\.id\]\)/, "el precio editado pasa a ser propio");
});

test("la migración es aditiva e idempotente", () => {
  const sql = read("prisma/migrations/202611010001_inventory_families/migration.sql");
  const lines = sql.split("\n").filter((line) => !line.trim().startsWith("--"));
  const text = lines.join("\n");
  assert.doesNotMatch(text, /\bDROP\b|\bDELETE FROM\b|\bTRUNCATE\b|\bRENAME\b/i, "nada destructivo");
  for (const statement of text.match(/CREATE (UNIQUE )?INDEX [^\n]*|CREATE TABLE [^\n]*|ADD COLUMN [^\n]*/g) ?? []) assert.match(statement, /IF NOT EXISTS/, statement);
  assert.match(text, /pg_constraint/, "las FKs con chequeo");
  assert.match(text, /WHERE "familyId" IS NOT NULL AND "deletedAt" IS NULL/, "índice único parcial de la combinación");
  assert.match(text, /"anyVariant" BOOLEAN NOT NULL DEFAULT false/, "anyVariant apagado");
});
