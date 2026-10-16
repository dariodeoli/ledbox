import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Presupuestos en la auditoría UX (issue #143): filtros/pestañas de estado
 * encima del Kanban (y tarjetas en ancho compacto, sin tablero horizontal),
 * prioridad visual a monto, vencimiento, cliente y próximo paso, impresión,
 * firma y portal unificados en un menú, y solicitudes del portal como
 * conversación comparativa original vs propuesta. Si alguna vuelve atrás, estos
 * tests fallan.
 */
const root = process.cwd();
const module = readFileSync(join(root, "components/admin/modules/PresupuestosModule.tsx"), "utf8");
const ui = readFileSync(join(root, "components/admin/AdminUI.tsx"), "utf8");
const css = readFileSync(join(root, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("el kit expone el menú de acciones de fila", () => {
  assert.match(ui, /export function AdminActionsMenu/);
  assert.match(ui, /export type AdminMenuItem/);
  assert.match(css, /\.admin-menu-pop \{ position: fixed/, "el panel del menú escapa del scroll de la tabla");
  assert.match(css, /\.admin-menu-item:hover/, "los ítems del menú tienen estado");
});

test("Presupuestos usa el ancho compacto sin tablero en móvil", () => {
  assert.match(module, /const narrow = useAdminNarrowViewport\(\)/);
  assert.match(module, /narrow \? null : <AdminViewSwitch/, "el conmutador no aporta nada en ancho compacto");
  assert.match(module, /<AdminCardGrid label="Presupuestos" cards=\{budgetCards\}/, "faltan las tarjetas del ancho compacto");
  // El tablero (kanban) solo se dibuja fuera del ancho compacto.
  assert.match(module, /\) : view === "board" \? \(/);
});

test("los KPIs por etapa filtran la lista y van encima del tablero y de la lista", () => {
  const kpis = module.indexOf('label="Etapas de los presupuestos');
  const dataState = module.indexOf("<AdminDataState", kpis);
  assert.ok(kpis > 0, "faltan los KPIs por etapa");
  assert.ok(dataState > kpis, "los KPIs tienen que ir antes de la lista y del tablero");
  assert.match(module, /onSelect=\{\(\) => setStageFilter/, "cada KPI filtra al tocarlo");
  assert.match(module, /STAGE_KPIS/, "los KPIs salen de las etapas");
  assert.match(module, /useAdminBoardMove\(\{ rows: boardRows/, "el tablero no usa el filtro de etapa");
  assert.match(module, /const boardRows = rows/, "el tablero respeta el mismo filtro que la lista");
  assert.match(module, /Quitar filtro/, "el filtro vigente se puede quitar");
});

test("prioridad visual: número, cliente, evento, monto, seña o saldo, etapa y vencimiento", () => {
  assert.match(module, /budgetPrimaryAction\(pipelineInput\(budget\)/, "falta la acción principal por etapa");
  const table = module.slice(module.indexOf('view="presupuestos"'), module.indexOf("</AdminTable>", module.indexOf('view="presupuestos"')));
  const order = ["N°", "Cliente", "Evento o título", "Monto", "Seña / saldo", "Etapa", "Vence", "Acción"];
  let last = -1;
  for (const label of order) {
    const index = table.indexOf(`label: "${label}"`);
    assert.ok(index > last, `${label} fuera de orden en las columnas`);
    last = index;
  }
  assert.match(table, /\{rowActions\(budget\)\}/, "la fila muestra una acción y el menú");
});

test("acciones compactas: documentos y compartir en iconos; gestión completa en la ficha", () => {
  const shortcuts = module.slice(module.indexOf("function budgetShortcuts"), module.indexOf("function budgetMenuItems"));
  const menu = module.slice(module.indexOf("function budgetMenuItems"), module.indexOf("/** Tarjetas del ancho compacto"));
  assert.match(module, /shortcuts=\{budgetShortcuts\(budget\)\}/);
  for (const label of ["Imprimir / PDF", "Enviar por correo", "WhatsApp con plantilla", "Copiar enlace del cliente", "Ver como cliente"]) {
    assert.ok(shortcuts.includes(`label: "${label}"`), label);
    assert.ok(!menu.includes(`label: "${label}"`), `acceso duplicado: ${label}`);
  }
  assert.match(menu, /menuOnly && primary/, "el siguiente paso del tablero sigue accesible sin duplicar la fila");
  for (const binding of ["onPlan", "onDeposit", "onInventory", "onEventName", "onSignature", "onProofs", "onApprove", "onRequestChanges"]) {
    assert.ok(module.includes(`${binding}:`), `se perdió el acceso de la ficha ${binding}`);
  }
  assert.match(ui, /role="group" aria-label="Accesos rápidos"/);
  assert.match(ui, /aria-label=\{item.label\}/, "los iconos tienen nombre para lectores de pantalla");
  assert.match(ui, /querySelectorAll<HTMLElement>\('\[role="menuitem"\]/, "los iconos usan el mismo recorrido de teclado");
});

test("el detalle es un panel lateral con todo y ?detalle=<id> lo abre", () => {
  const detail = readFileSync(join(root, "components/admin/modules/BudgetDetailDialog.tsx"), "utf8");
  assert.match(detail, /size="ficha"/);
  for (const title of ["Cliente y evento", "Condiciones", "Portal y firma", "Historial"]) assert.ok(detail.includes(`title="${title}"`), title);
  assert.match(detail, /Ítems \(/);
  assert.match(module, /searchParams\.get\("detalle"\)/, "falta el parámetro ?detalle=");
  assert.match(module, /url\.searchParams\.delete\("detalle"\)/, "cerrar el panel quita el parámetro");
});

test("solicitudes del portal como conversación comparativa", () => {
  assert.match(module, /function RequestComparison/, "falta la comparación actual vs propuesta");
  assert.match(module, /Comparación: presupuesto actual y propuesta del cliente/);
  assert.match(module, /<span role="columnheader">Presupuesto actual<\/span>/, "falta la columna del presupuesto actual");
  assert.match(module, /<span role="columnheader">Propuesta del cliente<\/span>/, "falta la columna propuesta");
  assert.match(module, /setTalkRequest\(request\)/, "las solicitudes no abren la conversación");
  assert.match(module, /title=\{`Conversación · \$\{talkRequest\.budget\.title\}`\}/, "falta el diálogo de conversación");
  assert.match(module, /admin-request-message--team/, "la respuesta del equipo va en la conversación");
});
