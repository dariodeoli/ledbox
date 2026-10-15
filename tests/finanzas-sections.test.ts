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
  { key: "tesoreria", href: "/finanzas/tesoreria", label: "Bancos y cuentas" },
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
  assert.match(moduleSource, /<AdminTabs[\s\S]*?items=\{FINANZAS_SECTIONS\.map/, "la barra no usa FINANZAS_SECTIONS");
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

test("Por cobrar acepta ?cliente=<id>, lo valida en servidor aunque quede fuera de la página y la ficha lo envía", () => {
  assert.match(moduleSource, /searchParams\.get\("cliente"\)/);
  assert.match(moduleSource, /collectionParams\.set\("clientId", clienteParam\)/, "el filtro llega al servidor antes de paginar");
  assert.match(moduleSource, /filterClient: payload\.filterClient/, "la identidad validada viene del servidor");
  assert.doesNotMatch(moduleSource, /payments\.find\(\(payment\) => payment\.client\.id === clienteParam\)/, "no descarta clientes fuera de la página visible");
  const listing = readFileSync(join(root, "lib/server/finance-listing.ts"), "utf8");
  assert.match(listing, /FROM "Client" WHERE id = \$\{clientId\} AND "organizationId" = \$\{organizationId\}/, "la identidad del filtro se valida contra su empresa");
  assert.match(moduleSource, /Filtrado por \{clienteFilter\.company \|\| clienteFilter\.name\} ·/);
  assert.match(moduleSource, /Quitar filtro/);
  const ficha = readFileSync(join(root, "components/admin/modules/ClienteFichaModule.tsx"), "utf8");
  assert.match(ficha, /`\/finanzas\/por-cobrar\?cliente=\$\{encodeURIComponent\(client\.id\)\}`/);
});

test("Cobrar conserva el presupuesto y permite cobrar futuros o sin vencimiento", () => {
  const budgets = readFileSync(join(root, "components/admin/modules/PresupuestosModule.tsx"), "utf8");
  assert.match(budgets, /\/finanzas\/por-confirmar\?presupuesto=\$\{encodeURIComponent\(budget\.id\)\}/);
  assert.match(moduleSource, /searchParams\.get\("presupuesto"\)/);
  assert.match(moduleSource, /\?budgetId=\$\{encodeURIComponent\(presupuestoParam\)\}/);
  assert.match(moduleSource, /presupuestoParam\s*\? \["AWAITING", "PROOF", "PARTIAL"\]\.includes\(row\.status\)/);
  assert.match(moduleSource, /const overdue = row\.status !== "PROOF" && expectedPaymentNeedsAction\(row\)/);
});

test("confirmación parcial usa clave estable y la ruta comparte la transacción idempotente", () => {
  const route = readFileSync(join(root, "app/api/admin/finance/expected/route.ts"), "utf8");
  assert.match(moduleSource, /idempotencyKey: expectedAttempt\.current\.key/);
  assert.match(route, /scope: "finance:expected:confirm"/);
  assert.match(route, /confirmExpectedPayment\(\{[\s\S]*?\btx,[\s\S]*?\bafterCommit,/);
});

test("el CSV de la página conserva estados pero su total incluye sólo lo cobrado", () => {
  const csv = /function exportCollections\(\)[\s\S]*?function exportPendingCollections/.exec(moduleSource)?.[0] ?? "";
  assert.match(csv, /receivedAmount\(settledPayments\)/);
  assert.match(csv, /paymentStatusLabel\(payment\.status\)/);
  assert.match(csv, /Total cobrado de esta página/);
});
