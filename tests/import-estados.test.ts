import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCatalog, parseStateCount, planCatalog, planUnitStates, stateTargetsOf, type CatalogProduct, type ExistingItem } from "../lib/import-catalog";
import { importModule } from "../lib/import-modules";
import { readSheetFile } from "../lib/server/import-tabular";

const parse = (extra: Record<string, unknown>) => {
  const result = normalizeCatalog({ productos: [{ codigo: "S1", nombre: "Silla A", cantidad: 10, tipo: "unidad", ...extra }] });
  assert.ok(result.ok);
  return result.value;
};
const plan = (products: CatalogProduct[], existing: Array<[string, ExistingItem]> = []) =>
  planCatalog({ products, existing: new Map(existing), photoNames: null });
const counts = (a = 0, m = 0, d = 0, l = 0) => ({ AVAILABLE: a, MAINTENANCE: m, DAMAGED: d, LOST: l });

test("parseStateCount: ausente, cero, enteros y basura", () => {
  assert.equal(parseStateCount(undefined), null);
  assert.equal(parseStateCount(""), null);
  assert.equal(parseStateCount("null"), null);
  assert.equal(parseStateCount(0), 0);
  assert.equal(parseStateCount("3"), 3);
  assert.equal(parseStateCount(-1), false);
  assert.equal(parseStateCount(1.5), false);
  assert.equal(parseStateCount("dos"), false);
});

test("el parser lee en_mantenimiento, danadas (y «dañadas») y perdidas; ausente es null", () => {
  const { doc } = parse({ en_mantenimiento: 2, danadas: "1", perdidas: 0 });
  assert.deepEqual([doc.productos[0].enMantenimiento, doc.productos[0].danadas, doc.productos[0].perdidas], [2, 1, 0]);
  assert.equal(parse({ ["dañadas"]: 4 }).doc.productos[0].danadas, 4);
  const none = parse({}).doc.productos[0];
  assert.deepEqual([none.enMantenimiento, none.danadas, none.perdidas], [null, null, null]);
  assert.deepEqual(stateTargetsOf(none), {});
  assert.deepEqual(stateTargetsOf(doc.productos[0]), { MAINTENANCE: 2, DAMAGED: 1, LOST: 0 });
});

test("un estado negativo o no entero es error de la fila y se descarta", () => {
  const { doc, problems } = parse({ danadas: -1 });
  assert.equal(doc.productos.length, 0);
  assert.ok(problems.some((p) => p.nivel === "error" && p.tipo === "estado-invalido" && p.codigo === "S1"));
});

test("la suma de estados mayor que la cantidad es un error bloqueante con mensaje claro", () => {
  const { doc } = parse({ en_mantenimiento: 6, danadas: 3, perdidas: 2 });
  const result = plan(doc.productos);
  assert.equal(result.items[0].accion, "omitir");
  const error = result.problems.find((p) => p.tipo === "estado-excede");
  assert.equal(error?.nivel, "error");
  assert.match(error!.mensaje, /suman 11 y el producto tiene 10/);
});

test("alta: los estados pedidos entran en el resumen y el resto queda disponible", () => {
  const { doc } = parse({ en_mantenimiento: 2, danadas: 1, perdidas: 1 });
  const result = plan(doc.productos);
  assert.equal(result.items[0].accion, "crear");
  assert.deepEqual([result.summary.estadosMantenimiento, result.summary.estadosDanadas, result.summary.estadosPerdidas, result.summary.estadosDisponibles], [2, 1, 1, 0]);
});

test("planUnitStates: sube, baja, cero y campo ausente", () => {
  const up = planUnitStates({ counts: counts(8, 0, 0, 0), nuevas: 0, comprometidas: 0, targets: { MAINTENANCE: 2, DAMAGED: 1 } });
  assert.deepEqual([up.aEstado.MAINTENANCE, up.aEstado.DAMAGED, up.faltan], [2, 1, 0]);
  const down = planUnitStates({ counts: counts(5, 3, 2, 0), nuevas: 0, comprometidas: 0, targets: { MAINTENANCE: 1 } });
  assert.deepEqual([down.aDisponible.MAINTENANCE, down.aDisponible.DAMAGED], [2, 0]);
  const zero = planUnitStates({ counts: counts(5, 3, 2, 0), nuevas: 0, comprometidas: 0, targets: { DAMAGED: 0 } });
  assert.equal(zero.aDisponible.DAMAGED, 2);
  assert.equal(zero.aDisponible.MAINTENANCE, 0);
});

test("planUnitStates: las unidades comprometidas no se tocan y se informa cuántas faltaron", () => {
  const short = planUnitStates({ counts: counts(10, 0, 0, 0), nuevas: 0, comprometidas: 8, targets: { DAMAGED: 5 } });
  assert.deepEqual([short.aEstado.DAMAGED, short.faltan, short.pedidas], [2, 3, 5]);
  const result = plan(parse({ danadas: 5 }).doc.productos, [["S1", { id: "x", name: "Silla A", isCombo: false, inTrash: false, units: 10, estados: counts(10), comprometidas: 8 }]]);
  const warning = result.problems.find((p) => p.tipo === "estado-incompleto");
  assert.equal(warning?.nivel, "aviso");
  assert.match(warning!.mensaje, /5 unidades más.*solo se pudieron ajustar 2/);
  assert.equal(result.items[0].accion, "actualizar");
});

test("juegos: los campos de estado se ignoran con un aviso", () => {
  const { doc } = parse({ tipo: "juego", cantidad: null, en_mantenimiento: 1, componentes: [{ codigo: "S2", cantidad: 2 }] });
  const second = parse({ codigo: "S2", nombre: "Silla B" }).doc.productos;
  const result = plan([...doc.productos, ...second]);
  const aviso = result.problems.find((p) => p.tipo === "estado-ignorado");
  assert.equal(aviso?.nivel, "aviso");
  assert.equal(result.items[0].estados, null);
});

test("planilla: mapea «En mantenimiento», «Dañadas» y «Perdidas» y acepta planillas sin esas columnas", () => {
  const modulo = importModule("productos")!;
  const encode = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(",")).join("\n"));
  const fixed: Record<string, string> = { en_mantenimiento: "En mantenimiento", danadas: "Dañadas", perdidas: "Perdidas" };
  const values: Record<string, string> = { codigo: "S1", nombre: "Silla A", cantidad: "10", en_mantenimiento: "2", danadas: "1", perdidas: "0" };
  const withNew = readSheetFile(modulo, encode([modulo.columns.map((c) => fixed[c.key] ?? c.key), modulo.columns.map((c) => values[c.key] ?? "")]));
  assert.ok(withNew.ok);
  assert.deepEqual([withNew.rows[0].en_mantenimiento, withNew.rows[0].danadas, withNew.rows[0].perdidas], ["2", "1", "0"]);
  const parsed = normalizeCatalog({ productos: withNew.rows });
  assert.ok(parsed.ok);
  assert.deepEqual(stateTargetsOf(parsed.value.doc.productos[0]), { MAINTENANCE: 2, DAMAGED: 1, LOST: 0 });
  const legacyHeaders = modulo.columns.filter((c) => !c.optionalColumn).map((c) => c.key);
  const legacy = readSheetFile(modulo, encode([legacyHeaders, legacyHeaders.map((key) => (key === "codigo" ? "S1" : key === "nombre" ? "Silla A" : ""))]));
  assert.ok(legacy.ok, "una planilla anterior sin las columnas nuevas sigue valiendo");
});
