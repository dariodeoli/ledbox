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

test("eventos: tarjetas en ancho compacto con la fecha destacada, el estado, la preparación y la siguiente acción", () => {
  const module = repoFile("components/admin/modules/EventosModule.tsx");
  const cards = repoFile("components/admin/modules/EventoLista.tsx");
  assert.match(module, /const narrow = useAdminNarrowViewport\(\);/);
  assert.match(module, /const cardView = narrow \|\| activeView === "grid";/);
  assert.match(module, /cardView \? \(\n\s*<EventCards items=\{rows\} onOpen=\{\(item\) => openFicha\(item\.event\.id\)\} renderActions=\{rowActions\} \/>/);
  // La tarjeta arranca por la fecha destacada y el nombre, y suma cliente, lugar,
  // estado, preparación, lo que falta y la siguiente acción (el nombre era lo que
  // desaparecía en móvil).
  assert.match(cards, /admin-events-card-date[\s\S]{0,1200}admin-events-card-name/, "la fecha va destacada junto al nombre");
  assert.match(cards, /<ClientIdentityView client=\{event\.client\} \/>/, "la identidad canónica del cliente entra a la tarjeta");
  assert.match(cards, /<EventStateBadges item=\{item\} \/>/, "el estado va en la tarjeta");
  assert.match(cards, /<PrepChips item=\{item\} \/>/, "la preparación va en la tarjeta");
  assert.match(cards, /readiness\.gaps\[0\]/, "lo primero que falta se lee en la tarjeta");
  assert.match(cards, /renderActions\(item\)/, "el pie lleva la siguiente acción y «•••»");
  // El checklist y los equipos siguen en la tarjeta, ahora como chips de preparación
  // (checklist cumplido/total y equipos despachados/total), con su texto completo accesible.
  assert.match(cards, /export function PrepChips/, "los chips de preparación existen");
  assert.match(cards, /Checklist: \$\{tasks\.done\} de \$\{tasks\.total\} tareas cumplidas/, "el chip de checklist dice cuántas tareas se cumplieron");
  assert.match(cards, /Equipos despachados: \$\{equipment\.dispatched\} de \$\{equipment\.units\}/, "el chip de equipos dice cuántos salieron");
  assert.match(cards, /<AdminIcon name="audit" size=\{12\} \/>[\s\S]{0,320}<AdminIcon name="inventory" size=\{12\} \/>/, "checklist y equipos son chips distintos");
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
  const cards = module.slice(module.indexOf("const clientCards:"), module.indexOf("const totals =", module.indexOf("const clientCards:")));
  assert.match(cards, /<ClientIdentityView client=\{client\} \/>/, "responsable y segmento comparten la identidad canónica");
  assert.match(cards, /clientContactLine\(client\)/, "el teléfono o correo principal sigue visible en la tarjeta");
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
  // Tipo se integra en la identidad; empresa y contacto comercial comparten una celda y el representante legal tiene columna propia.
  assert.match(row, /<ClientIdentityView client=\{client\} \/>/, "la celda conserva responsable y segmento");
  assert.match(module, /Empresa \/ contacto comercial/);
  assert.match(module, /Representante legal/);
  assert.match(repoFile("components/admin/ClientIdentity.tsx"), /identity\.category/, "el tipo sigue visible dentro de la identidad");
  const css = repoFile("app/globals.css");
  const regla = /\.admin-table--clientes \{ --clientes-cols: ([^;]+); --admin-cols: var\(--clientes-cols\); --admin-table-min: ([\d.]+)rem; \}/.exec(css);
  assert.ok(regla, "falta la plantilla de columnas de clientes");
  assert.equal(regla[1].trim().split(/ (?![^(]*\))/).length, 8, "ocho columnas: empresa/contacto, representante legal y métricas alineadas");
  assert.equal(Number(regla[2]) <= 64, true, "el ancho mínimo no crece");
});
