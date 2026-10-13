import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Listas de Eventos y Clientes en ancho compacto (issue #139, crítico 1 de la
 * auditoría UX de producción): hasta 980 px —el corte con el que el shell pasa
 * a la barra de íconos— las listas se leen como tarjetas con el nombre primero,
 * sin scroll horizontal. En escritorio la tabla de Clientes se simplifica: los
 * links de contacto (Instagram, web, correo y WhatsApp) salen de la grilla y
 * quedan en la ficha.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("el kit expone el ancho compacto con el corte del shell", () => {
  const board = repoFile("components/admin/AdminBoard.tsx");
  assert.match(board, /export function useAdminNarrowViewport\(\): boolean/);
  assert.match(board, /window\.matchMedia\("\(max-width: 980px\)"\)/, "el corte tiene que ser el del shell");
  assert.match(board, /media\.addEventListener\("change", update\)/, "el ancho se sigue en vivo");
});

test("eventos: tarjetas en ancho compacto con el nombre primero", () => {
  const module = repoFile("components/admin/modules/EventosModule.tsx");
  assert.match(module, /const narrow = useAdminNarrowViewport\(\);/);
  assert.match(module, /const cardView = narrow \|\| activeView === "grid";/);
  assert.match(module, /cardView \? \(\n\s*<AdminCardGrid label="Eventos" cards=\{eventCards\} \/>/);
  // La tarjeta arranca por el nombre y suma cliente, fecha/lugar, urgencia,
  // avance y equipos (el nombre era lo que desaparecía en móvil).
  assert.match(module, /const eventCards: AdminCardData\[\] = rows\.map\([\s\S]{0,700}title: event\.name/);
  assert.match(module, /subtitle: clientDisplayName\(event\.client\)/);
  for (const label of ["Fecha", "Falta", "Lugar", "Equipos", "Checklist"]) {
    assert.ok(module.includes(`label: "${label}"`), `falta «${label}» en la tarjeta del evento`);
  }
  // El conmutador no se dibuja en ancho compacto (lista y cuadrícula serían iguales).
  assert.match(module, /<div className="admin-cal-view-switch">\s*<AdminViewSwitch/, "el calendario se alcanza también desde el selector móvil");
});

test("clientes: tarjetas en ancho compacto con contacto, deuda, última actividad y estado", () => {
  const module = repoFile("components/admin/modules/ClientesModule.tsx");
  assert.match(module, /const narrow = useAdminNarrowViewport\(\);/);
  assert.match(module, /const cardView = narrow \|\| view === "grid";/);
  assert.match(module, /cardView \? \(\n\s*<AdminCardGrid label="Clientes" cards=\{clientCards\} \/>/);
  for (const label of ["Contratado", "Saldo", "Última actividad"]) {
    assert.ok(module.includes(`label: "${label}"`), `falta «${label}» en la tarjeta del cliente`);
  }
  assert.match(module, /const primaryContact = clientContactLine\(client\)/, "el contacto principal entra a la tarjeta");
  assert.match(module, /client\.active \? \[\] : \[\{ label: "Inactivo"/, "el estado inactivo va en la tarjeta");
  assert.match(module, /footer: rowActions\(client\)/, "la tarjeta comparte las acciones de la fila");
  assert.match(module, /narrow \? null : \(\n\s*<AdminViewSwitch/);
});

test("las tarjetas dejan el nombre en su propia línea en ancho compacto", () => {
  // El encabezado de la tarjeta envuelve en ≤980: los chips bajan debajo y el
  // nombre no queda aplastado (Clientes llega a tres chips; sin esto el título
  // se recortaba a un hilo y el dato no se veía).
  const css = repoFile("app/globals.css");
  assert.match(css, /\.admin-cards-head \{ flex-wrap: wrap; \}/, "el encabezado tiene que envolver");
  assert.match(css, /\.admin-cards-title \{ flex: 1 1 100%; \}/, "el nombre ocupa su línea completa");
  assert.match(css, /\.admin-cards-badges \{ flex-wrap: wrap; \}/, "los chips envuelven");
});

test("clientes escritorio: sin links de contacto en la grilla y con la tabla más corta", () => {
  const module = repoFile("components/admin/modules/ClientesModule.tsx");
  const table = module.slice(module.indexOf('view="clientes"'));
  const row = table.slice(0, table.indexOf("</AdminTable>"));
  assert.equal(row.includes("ClientLinks"), false, "los links salen de la grilla");
  assert.equal(row.includes("AdminWhatsappTemplateButton"), false, "WhatsApp sale de la grilla");
  assert.equal(/mailto:/.test(row), false, "el correo sale de la grilla");
  assert.match(row, /<Link className="admin-row-link" href=\{`\/clientes\/\$\{client\.id\}`\}/, "la fila entera navega a la ficha como página propia");
  assert.match(row, /\{rowActions\(client\)\}/, "una acción visible y el resto en «•••»");
  // La celda de contacto muestra al encargado y su teléfono; el título trae el correo.
  assert.match(module, /const contact = clientContactLine\(client\);/);
  // La ficha los conserva: es el reemplazo real, no una pérdida.
  const detail = repoFile("components/admin/modules/ClienteFichaModule.tsx");
  assert.match(detail, /<ClientLinks client=\{client\} name=\{name\}/, "la ficha mantiene los links");
  assert.match(detail, /mailto:/, "la ficha mantiene el correo");
  // La plantilla de columnas queda en ocho: cliente, tipo, contacto, eventos, contratado, saldo, actividad y acciones.
  const css = repoFile("app/globals.css");
  const regla = /\.admin-table--clientes \{ --clientes-cols: ([^;]+); --admin-cols: var\(--clientes-cols\); --admin-table-min: ([\d.]+)rem; \}/.exec(css);
  assert.ok(regla, "falta la plantilla de columnas de clientes");
  assert.equal(regla[1].trim().split(/ (?![^(]*\))/).length, 8, "ocho columnas, sin estado ni presupuestos sueltos");
  assert.equal(Number(regla[2]) <= 64, true, "el ancho mínimo no crece");
});
