import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INVENTORY_MODULE_FILES, inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Rediseño del módulo Inventario: acciones del encabezado, indicadores que
 * filtran, pestañas, lista con una acción visible por fila, ficha lateral con
 * `?producto=` y la lectura de ocupación acotada por empresa. Fija el contrato
 * de la pantalla sin tocar el motor de disponibilidad ni los endpoints de escritura.
 */

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const moduleFile = (file: string) => read(`components/admin/modules/${file}`);

test("el encabezado ofrece Nuevo producto, Nuevo combo e Incidentes con su contador; las altas solo con permiso", () => {
  const module = moduleFile("InventarioModule.tsx");
  assert.match(module, /Nuevo producto/);
  assert.match(module, /Nuevo combo/);
  assert.match(module, /Incidentes\{incidentCount == null \? "" : ` \(\$\{formatNumber\(incidentCount\)\}\)`\}/, "el contador sale de los incidentes abiertos reales");
  assert.match(module, /\/api\/admin\/inventory\/incidents\?status=open/);
  // Nuevo producto y Nuevo combo van detrás de `writable`; Incidentes se ve siempre (la lista es de solo lectura sin permiso).
  assert.match(module, /\{writable \? \(\s*<AdminButton type="button" variant="primary" icon="plus"[\s\S]{0,120}Nuevo producto/);
  assert.match(module, /\{writable \? \(\s*<AdminButton icon="inventory" onClick=\{\(\) => setComboDialog\(\{ item: null \}\)\}/);
  assert.match(module, /<InventoryIncidentsDialog\s+writable=\{writable\}/);
});

test("los cinco indicadores filtran al tocarlos y las pestañas son las pedidas", () => {
  const module = moduleFile("InventarioModule.tsx");
  for (const label of ["Productos activos", "Unidades disponibles hoy", "En reparación / dañadas / perdidas", "Ocupación de esta semana", "Publicados en la tienda"]) {
    assert.ok(module.includes(`label="${label}"`), `falta el indicador «${label}»`);
  }
  assert.equal((module.match(/actionLabel="/g) ?? []).length, 5, "los cinco indicadores son botones que filtran");
  assert.equal((module.match(/<AdminKpi\b/g) ?? []).length, 5);
  assert.match(module, /INVENTORY_TABS\.map/);
  const ui = read("components/admin/AdminUI.tsx");
  assert.match(ui, /admin-kpi admin-kpi--filter/);
  assert.match(ui, /"aria-pressed": Boolean\(active\)/);
  assert.match(ui, /onSelect\?: \(\) => void/);
  assert.ok(!/admin-kpi--action/.test(ui));
});

test("la ocupación de la semana es una lectura acotada a la empresa activa y reutiliza el cálculo del Resumen", () => {
  const route = read("app/api/admin/inventory/occupancy/route.ts");
  assert.match(route, /requireAdminContext\(\)/, "exige sesión y membresía");
  assert.match(route, /getOccupancyWindow\(auth\.context\.organizationId,/, "siempre acotada por la empresa activa");
  assert.match(route, /weekWindow\(now\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/, "solo lectura");
  assert.doesNotMatch(route, /request\.url|searchParams/, "no acepta ids de empresa desde afuera");
});

test("la lista: una acción visible por fila («Ficha») y el resto en «•••»; sin permiso no hay menú", () => {
  const list = moduleFile("InventoryList.tsx");
  assert.match(list, /label: "Libres hoy"|"Libres hoy"/);
  for (const column of ["Producto", "Categoría", "Estado", "Lista", "Mayorista", "Tienda", "Acciones"]) {
    assert.ok(list.includes(`{ label: "${column}"`) || list.includes(`label: "${column}"`), `falta la columna «${column}»`);
  }
  assert.match(list, /Abrir la ficha de \$\{item\.name\}/);
  assert.match(list, /if \(!writable\) return \[\];/, "un VIEWER no recibe acciones que mutan");
  assert.match(list, /items\.length \? <AdminActionsMenu label=\{`Más acciones de \$\{item\.name\}`\} items=\{items\} \/> : null/);
  for (const action of ["Editar producto", "Editar combo y componentes", "Archivar producto"]) {
    assert.ok(list.includes(action), `el menú conserva «${action}»`);
  }
  // E2: el estado de la lista es el chip del mapa único (derivado, ícono + texto); el estado
  // manual del producto sigue editable, solo con permiso, desde la ficha.
  assert.match(list, /<StateChips visual=\{visual\} \/>/);
  assert.doesNotMatch(list, /<AdminSelect/, "la lista ya no edita el estado en línea");
  assert.match(moduleFile("InventoryFicha.tsx"), /writable \? \(\s*<AdminSelect/);
  assert.match(list, /<StockMeter summary=\{stockSummary\(item, rangeActive\)\}/);
  assert.match(list, /<AudienceChip item=\{item\} \/>/);
});

test("la ficha es un panel lateral (AdminDialog ficha) con todas las secciones y no pierde acciones", () => {
  const ficha = moduleFile("InventoryFicha.tsx");
  assert.match(ficha, /<AdminDialog[\s\S]{0,200}size="ficha"/);
  for (const title of ["Resumen", "Disponibilidad · próximas 4 semanas", "Precios", "Tienda web", "Incidentes", "Historial"]) {
    assert.ok(ficha.includes(`title="${title}"`), `falta la sección «${title}»`);
  }
  assert.ok(ficha.includes('"Combos donde se usa"') && ficha.includes('"Componentes"'), "combos donde se usa / componentes si es combo");
  assert.match(ficha, /Unidades · \$\{formatNumber\(item\.units\.length\)\}/);
  assert.match(ficha, /buildTimeline\(item\.assignments, new Date\(\), 4\)/, "la línea de tiempo sale de las asignaciones ya cargadas");
  assert.match(ficha, /<InventoryIncidentsPanel inventoryId=\{item\.id\} writable=\{writable\}/);
  // Auditoría solo para quien puede leerla (el API responde 403 al resto).
  assert.match(ficha, /enabled: canReadAudit/);
  // Acciones de la ficha: editar, archivar/restaurar, cambiar estado, unidades y lote.
  for (const action of ["Editar combo", "Editar producto", "Archivar", "Restaurar", "Agregar unidad", "Cancelar unidad", "Guardar unidad", "Cambiar estado de la unidad", "en lote"]) {
    assert.ok(ficha.includes(action), `la ficha conserva «${action}»`);
  }
  assert.match(ficha, /dirty=\{unitEditorOpen\}/, "cerrar con una unidad a medio editar pide confirmación");
});

test("`?producto=<id>` abre la ficha y un id ajeno no abre nada", () => {
  const module = moduleFile("InventarioModule.tsx");
  assert.match(module, /searchParams\.get\("producto"\)/);
  assert.match(module, /resources\.data\.some\(\(item\) => item\.id === productParam\)/, "solo abre productos de la lista de la empresa activa");
  assert.match(module, /No encontramos ese producto en esta empresa\./);
  assert.match(module, /url\.searchParams\.set\("producto", id\)/, "al abrir deja el link compartible");
});

test("el lote se edita en una ventana y las altas y ediciones van por los endpoints de siempre", () => {
  const bulk = moduleFile("InventoryBulkEditor.tsx");
  assert.match(bulk, /<AdminDialog[\s\S]{0,400}size="(wide|lg)"/);
  assert.match(bulk, /kind: target === "items" \? "bulk-items" : "bulk-units"/);
  const dialogs = moduleFile("InventoryItemDialogs.tsx");
  assert.match(dialogs, /"\/api\/admin\/resources"/);
  assert.match(dialogs, /kind: "prices"/);
  assert.match(dialogs, /kind: "item",/);
  const ficha = moduleFile("InventoryFicha.tsx");
  assert.match(ficha, /kind: "unit-update"/);
  assert.match(ficha, /kind: unitDialog \? "unit-update" : "unit"/);
  const module = moduleFile("InventarioModule.tsx");
  assert.match(module, /kind: restore \? "item-restore" : "item-archive"/);
  assert.match(module, /kind: "status"/);
});

test("ningún archivo nuevo del inventario dibuja campos sueltos: todo va por AdminFields", () => {
  for (const file of INVENTORY_MODULE_FILES) {
    assert.doesNotMatch(moduleFile(file), /<(input|select|textarea)\b/, `${file}: usar AdminFields (o AdminSelect)`);
  }
  assert.doesNotMatch(moduleFile("InventoryBulkEditor.tsx"), /<(input|textarea)\b/);
});

test("la cuadrícula móvil y la barra de selección no tapan la barra inferior", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.admin-bulkbar \{ bottom: calc\(var\(--a-bottomnav, 72px\) \+ 8px\); \}/);
  assert.match(css, /\.admin-cards \.admin-btn, \.admin-cards \.admin-iconbtn, \.admin-bulkbar \.admin-btn \{ min-height: 44px; \}/, "objetivos táctiles de 44 px");
  assert.match(css, /--inventario-cols: 2\.25rem /, "una sola plantilla de columnas para encabezado y filas");
  assert.equal((css.match(/\.admin-table--inventario \{/g) ?? []).length, 1);
});

test("el código del módulo no conserva piezas del diseño anterior", () => {
  const source = inventoryModuleSource();
  for (const dead of ["priceCellLines", "priceRuleChip", "admin-item-figure", "admin-item-identity", "selectInventory", "AdminPanel"]) {
    assert.ok(!source.includes(dead), `quedó código muerto: ${dead}`);
  }
  assert.doesNotMatch(read("app/globals.css"), /\.admin-item-figure|\.admin-item-identity|\.admin-unit-block/);
});

test("la ficha pide solo las reservas vivas y el tope de 1000 no deja afuera las próximas", () => {
  const route = read("app/api/admin/inventory/route.ts");
  assert.match(route, /searchParams\.get\("vivas"\) === "1"/);
  assert.match(route, /releasedAt: null,\s*OR: \[\s*\{ endsAt: \{ gte: startOfToday \} \}/);
  assert.match(route, /soloVivas \? \[\{ startsAt: \{ sort: "asc", nulls: "last" \} \}/);
  // Sin el parámetro el historial sigue igual: más recientes primero.
  assert.match(route, /\[\{ startsAt: "desc" \}, \{ id: "asc" \}\]/);
  // E2: la lista es liviana (sin asignaciones) y la ficha pide su detalle con las vivas del producto.
  assert.match(read("components/admin/modules/InventarioModule.tsx"), /new URLSearchParams\(\{ vivas: "1", itemId: selectedId \}\)/);
  assert.match(route, /searchParams\.get\("itemId"\)/);
});

test("el formulario de edición congela su línea base al montar", () => {
  const dialogs = read("components/admin/modules/InventoryItemDialogs.tsx");
  assert.match(dialogs, /const \[baseForm\] = useState<InventoryEditForm>\(\(\) => editFormFromItem\(item\)\)/);
  assert.equal((dialogs.match(/editFormFromItem\(item\)/g) ?? []).length, 2, "solo el estado inicial y la línea base leen el item");
});
