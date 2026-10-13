import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Subnavegación de Finanzas (issue #140, auditoría UX crítica 3): `/finanzas` se
 * divide en siete secciones con subtabs del panel, cada una con su ruta real
 * (deep-link), y en pantalla chica las listas cambian la tabla densa por
 * tarjetas (entidad, estado, fecha/monto y acción principal), sin scroll
 * horizontal. Si una sección queda sin ruta, sin subtab o sin tarjetas, falla.
 */
const root = process.cwd();
const moduleSource = readFileSync(join(root, "components/admin/modules/FinanzasModule.tsx"), "utf8");
const conciliacion = readFileSync(join(root, "components/admin/modules/ConciliacionBancaria.tsx"), "utf8");

/** Secciones y rutas tal como las publica el brief del issue #140. */
const SECTIONS = [
  { key: "resumen", href: "/finanzas", label: "Resumen" },
  { key: "por-confirmar", href: "/finanzas/por-confirmar", label: "Por confirmar" },
  { key: "por-cobrar", href: "/finanzas/por-cobrar", label: "Por cobrar" },
  { key: "proveedores", href: "/finanzas/proveedores", label: "Proveedores" },
  { key: "tesoreria", href: "/finanzas/tesoreria", label: "Tesorería" },
  { key: "conciliacion", href: "/finanzas/conciliacion", label: "Conciliación" },
  { key: "gastos", href: "/finanzas/gastos", label: "Gastos" },
] as const;

test("las siete secciones están declaradas en orden y con su ruta", () => {
  const list = /export const FINANZAS_SECTIONS[\s\S]*?\n\];/.exec(moduleSource)?.[0] ?? "";
  assert.ok(list, "falta FINANZAS_SECTIONS en FinanzasModule");
  let last = -1;
  for (const section of SECTIONS) {
    const index = list.indexOf(`key: "${section.key}"`);
    assert.ok(index > last, `${section.key}: ausente o fuera de orden`);
    last = index;
    assert.match(
      list,
      new RegExp(`key: "${section.key}"[^}]*href: "${section.href}"[^}]*label: "${section.label}"`),
      `${section.key}: href o label no coinciden con el contrato`,
    );
  }
});

test("cada sección tiene su página real y declara la sección", () => {
  for (const section of SECTIONS) {
    const page = join(root, "app", "(admin)", "(panel)", ...section.href.split("/").filter(Boolean), "page.tsx");
    assert.ok(existsSync(page), `falta la página de ${section.href}`);
    if (section.key === "resumen") continue; // el resumen es la entrada default del módulo
    assert.match(
      readFileSync(page, "utf8"),
      new RegExp(`<FinanzasModule section="${section.key}"`),
      `${section.href}: la página no abre su sección`,
    );
  }
});

test("la barra de subtabs sale de la lista única de secciones", () => {
  assert.match(moduleSource, /<AdminSubtabs[\s\S]*?items=\{FINANZAS_SECTIONS\.map/, "la barra no usa FINANZAS_SECTIONS");
  assert.match(moduleSource, /active: item\.key === section/, "la barra no marca la sección activa");
  for (const section of SECTIONS.filter((item) => item.key !== "resumen")) {
    assert.match(moduleSource, new RegExp(`section === "${section.key}"`), `${section.key}: el render no está condicionado por sección`);
  }
});

test("pantalla chica: las listas de Finanzas pasan a tarjetas", () => {
  // Regla compartida del panel (issues #139/#140): ≤980 px la lista va en
  // tarjetas, con el mismo corte con el que el shell pasa a drawer.
  const board = readFileSync(join(root, "components/admin/AdminBoard.tsx"), "utf8");
  assert.match(board, /export function useAdminNarrowViewport\(\): boolean/);
  assert.match(moduleSource, /useAdminNarrowViewport\(\)/, "Finanzas no usa la regla compacta");
  assert.match(conciliacion, /useAdminNarrowViewport\(\)/, "Conciliación no usa la regla compacta");
  assert.match(conciliacion, /<AdminCardGrid/, "Conciliación no dibuja tarjetas");
  // Cada tabla densa de las secciones tiene su par en tarjetas.
  const tables = (moduleSource.match(/<AdminTable\n\s+view="/g) ?? []).length;
  const compactSwitches = (moduleSource.match(/compact \? \(/g) ?? []).length;
  const grids = (moduleSource.match(/<AdminCardGrid/g) ?? []).length;
  assert.equal(tables, 7, `se esperaban 7 tablas en Finanzas, hay ${tables}`);
  assert.equal(compactSwitches, tables, "hay tablas sin su variante compacta");
  assert.ok(grids >= tables, `tablas sin tarjetas: ${tables} tablas, ${grids} grillas`);
});

test("Por cobrar acepta ?cliente=<id>, lo valida contra los cobros cargados y la ficha lo envía", () => {
  assert.match(moduleSource, /searchParams\.get\("cliente"\)/);
  assert.match(moduleSource, /payments\.find\(\(payment\) => payment\.client\.id === clienteParam\)/, "valida contra los datos de la empresa activa");
  assert.match(moduleSource, /next\.delete\("cliente"\)/, "un id desconocido se limpia de la URL");
  assert.match(moduleSource, /Filtrado por \{clienteFilter\.company \|\| clienteFilter\.name\} ·/);
  assert.match(moduleSource, /Quitar filtro/);
  const ficha = readFileSync(join(root, "components/admin/modules/ClienteFichaModule.tsx"), "utf8");
  assert.match(ficha, /`\/finanzas\/por-cobrar\?cliente=\$\{encodeURIComponent\(client\.id\)\}`/);
});
