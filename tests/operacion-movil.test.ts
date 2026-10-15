import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Proveedores, Leads e Inventario en móvil (issue #151, críticos 3 y 6 de la
 * auditoría móvil v2.1.61): hasta 980 px —la regla compartida del panel— las
 * listas se leen como tarjetas con el menú «⋯» y los tableros de Proveedores y
 * Leads se reemplazan por pestañas de estado, así ninguna columna queda cortada.
 * Si una pantalla vuelve a la tabla con scroll horizontal, al tablero cortado o
 * pierde el menú de acciones, estos tests fallan.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("proveedores: trabajos y directorio como tarjetas en ancho compacto", () => {
  const module = repoFile("components/admin/modules/ProveedoresModule.tsx");
  assert.match(module, /const narrow = useAdminNarrowViewport\(\);/);
  // El conmutador no aporta nada en compacto: lista y cuadrícula son las mismas tarjetas.
  assert.match(module, /narrow \? null : <AdminViewSwitch view=\{jobsView\}/);
  assert.match(module, /narrow \? null : \(\n\s*<AdminViewSwitch view=\{suppliersView\}/);
  assert.match(module, /<AdminCardGrid label="Trabajos de proveedores" cards=\{jobCards\} \/>/);
  assert.match(module, /<AdminCardGrid label="Proveedores" cards=\{supplierCards\} \/>/);
  // Entidad, estado, fecha y montos de cada trabajo.
  for (const label of ["Vence", "Total", "Anticipo", "Saldo"]) {
    assert.ok(module.includes(`label: "${label}"`), `falta «${label}» en la tarjeta del trabajo`);
  }
  // Las acciones secundarias van al menú «⋯» (issue #151).
  assert.match(module, /<AdminActionsMenu label=\{`Acciones del trabajo \$\{job\.description\}`\} items=\{menuItems\} \/>/);
  assert.match(module, /<AdminActionsMenu label=\{`Acciones de \$\{supplier\.name\}`\} items=\{menuItems\} \/>/);
});

test("proveedores: pestañas de estado y tablero solo fuera de compacto", () => {
  const module = repoFile("components/admin/modules/ProveedoresModule.tsx");
  const tabs = module.indexOf('label="Filtrar trabajos por estado"');
  const dataState = module.indexOf("<AdminDataState", tabs);
  assert.ok(tabs > 0, "faltan las pestañas de estado de los trabajos");
  assert.ok(dataState > tabs, "las pestañas tienen que ir antes de la lista y del tablero");
  assert.match(module, /jobStatusCounts\.get\(value\)/, "las pestañas no muestran el conteo por estado");
  assert.match(module, /openJobsCount/, "falta el conteo de abiertos");
  // El Kanban queda detrás del ancho compacto; las tarjetas lo reemplazan.
  assert.match(module, /\{narrow \? \([\s\S]{0,500}\) : jobsView === "board" \? \(/);
  assert.match(module, /useAdminBoardMove\(\{ rows: filteredJobs/, "el tablero no usa el filtro compartido");
});

test("leads: tarjetas con pestañas y sin Kanban cortado en ancho compacto", () => {
  const module = repoFile("components/admin/modules/LeadsModule.tsx");
  assert.match(module, /const narrow = useAdminNarrowViewport\(\);/);
  assert.match(module, /narrow \? null : <AdminViewSwitch view=\{view\}/);
  assert.match(module, /<AdminCardGrid label="Leads" cards=\{leadCards\} \/>/);
  const tabs = module.indexOf('label="Filtrar leads por estado"');
  const dataState = module.indexOf("<AdminDataState", tabs);
  assert.ok(tabs > 0, "faltan las pestañas de estado de los leads");
  assert.ok(dataState > tabs, "las pestañas tienen que ir antes de la lista y del tablero");
  assert.match(module, /statusCounts\.get\(option\.value\)/, "las pestañas no muestran el conteo por estado");
  // El tablero respeta la búsqueda y la pestaña, y no se dibuja en compacto.
  assert.match(module, /useAdminBoardMove\(\{ rows, move: moveLead/, "el tablero no usa las filas filtradas");
  assert.match(module, /\{narrow \? \([\s\S]{0,500}\) : view === "board" \? \(/);
  // Entidad, estado, fecha del evento y monto estimado.
  for (const label of ["Ingreso", "Evento", "Cotización"]) {
    assert.ok(module.includes(`label: "${label}"`), `falta «${label}» en la tarjeta del lead`);
  }
  assert.match(module, /<AdminActionsMenu label=\{`Acciones del lead \$\{lead\.name\}`\} items=\{menuItems\} \/>/);
});

test("inventario: las tarjetas de la cuadrícula entran también en ancho compacto", () => {
  const module = inventoryModuleSource();
  assert.match(module, /const narrow = useAdminNarrowViewport\(\);/);
  // E2: el conmutador (Lista · Cuadrícula · Por categoría) se ve también en celular; la lista pasa a tarjetas.
  assert.match(module, /<AdminViewSwitch view=\{view\}/);
  assert.match(module, /cards=\{narrow\}/);
  assert.match(module, /<InventoryCompactGrid/);
  assert.match(module, /<AdminCardGrid\s+label="Inventario"/);
  assert.match(module, /<AdminActionsMenu label=\{`Más acciones de \$\{item\.name\}`\} items=\{items\} \/>/);
});

test("las pestañas de estado del panel envuelven en pantalla chica", () => {
  const css = repoFile("app/globals.css");
  const regla = /\.admin-subtabs \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(regla, /flex-wrap: wrap/, "las pestañas tienen que envolver, no cortarse");
});
