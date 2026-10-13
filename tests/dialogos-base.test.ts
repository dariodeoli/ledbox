import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Base común de los diálogos de edición (tanda 1, 13-10-2026): contrato de
 * `AdminDialog` y de sus primitivas, y adopción en Productos y Clientes.
 */
const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const css = read("app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const ui = read("components", "admin", "AdminUI.tsx");
const dialog = ui.slice(ui.indexOf("export function AdminDialog("), ui.indexOf("/** Pila de diálogos abiertos"));
const items = read("components", "admin", "modules", "InventoryItemDialogs.tsx");
const clientes = read("components", "admin", "modules", "ClientesModule.tsx");
const quick = read("components", "admin", "modules", "ClientQuickForm.tsx");

test("AdminDialog: tamaños sm / md / lg con alias y pie sticky con error arriba", () => {
  assert.match(dialog, /size\?: "sm" \| "md" \| "lg" \| "default" \| "wide" \| "ficha"/);
  assert.match(css, /\.admin-dialog--sm\s*\{\s*width:\s*min\(440px, 100%\)/);
  assert.match(css, /\.admin-dialog--lg\s*\{\s*width:\s*min\(720px, 100%\)/);
  assert.match(dialog, /<footer className="admin-dialog-footer">/);
  assert.match(css, /\.admin-dialog-footer, \.admin-dialog-body \.admin-dialog-foot\s*\{[^}]*background:\s*var\(--a-dialog-bg\)/);
  assert.match(css, /\.admin-dialog-body \.admin-dialog-foot\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/, "los pies armados en el cuerpo quedan pegados abajo");
  assert.match(css, /\.admin-dialog--sheet \.admin-dialog-head\s*\{[^}]*flex:\s*0 0 auto/, "el encabezado no se desplaza");
  assert.match(css, /\.admin-dialog-body\s*\{[^}]*overflow-y:\s*auto/, "el cuerpo tiene scroll propio");
  assert.match(dialog, /error\?: string \| null/);
  assert.match(dialog, /className="admin-dialog-status"/, "el error va entre el cuerpo y el pie");
  assert.ok(dialog.indexOf("admin-dialog-status") > dialog.indexOf("admin-dialog-body") && dialog.indexOf("admin-dialog-status") < dialog.indexOf('className="admin-dialog-footer"'));
});

test("AdminDialog: botón cerrar de 44 px y foco en el primer campo", () => {
  assert.match(css, /\.admin-dialog-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(dialog, /ownsFocus/, "se respeta el campo con autoFocus");
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key !== "Tab"/, "trampa de foco");
});

test("AdminDialog: en celular (0-767 px) es una hoja a pantalla completa sobre el teclado", () => {
  const start = css.search(/@media \(max-width: 767px\) \{\s*\.admin-dialog-overlay, \.admin-dialog-overlay--ficha/);
  assert.ok(start >= 0, "falta la hoja de celular");
  const block = css.slice(start, css.indexOf("\n}\n", start));
  assert.match(block, /height:\s*100dvh/);
  assert.match(block, /var\(--admin-dialog-vh, 100dvh\)/, "alto visible con el teclado abierto");
  assert.match(block, /env\(safe-area-inset-top\)/);
  assert.match(block, /env\(safe-area-inset-bottom\)/);
  assert.match(block, /grid-template-columns:\s*minmax\(0, 1fr\)/, "una columna");
  assert.match(block, /overflow-x:\s*hidden/, "sin scroll horizontal");
  assert.match(block, /min-height:\s*44px/, "botones del pie de 44 px");
  assert.match(dialog, /window\.visualViewport/);
  assert.match(dialog, /--admin-dialog-vh/);
});

test("AdminDialog: «Guardando…» desde el botón y cierre con confirmación propia", () => {
  assert.match(ui, /busyLabel\?: string/);
  assert.match(ui, /busy && busyLabel \? busyLabel : children/);
  assert.match(dialog, /¿Descartar los cambios\?/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.target === event\.currentTarget/, "clic afuera");
});

test("primitivas: sección con título, plegable «Más opciones», ayuda y error bajo el campo", () => {
  const section = ui.slice(ui.indexOf("export function AdminDialogSection("), ui.indexOf("export function AdminConfirmDialog("));
  assert.match(section, /collapsible/);
  assert.match(section, /AdminDisclosure/);
  assert.match(css, /\.admin-dialog-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.admin-field--wide\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.admin-field-error\s*\{/);
  assert.match(css, /\.admin-field-hint\s*\{/);
});

test("Productos: alta y edición usan secciones (Datos, Precios, Fotos, Más opciones), error arriba del pie y «Guardando…»", () => {
  const source = inventoryModuleSource();
  for (const title of ["Datos", "Precios", "Fotos", "Más opciones"]) {
    assert.ok(items.includes(`<AdminDialogSection title="${title}"`), `falta la sección ${title}`);
  }
  assert.match(items, /title="Más opciones" collapsible/);
  assert.match(items, /error=\{formError\}/);
  assert.match(items, /error=\{editError\}/);
  assert.equal((items.match(/busyLabel="Guardando…"/g) ?? []).length, 2);
  assert.doesNotMatch(items, /admin-dialog-footer-note/, "el error ya no viaja dentro del pie");
  assert.match(source, /dirty=\{/);
});

test("Clientes: el alta y la edición usan secciones y no cambian el payload", () => {
  for (const title of ["Datos", "Contacto", "Datos fiscales", "Ubicación", "Más opciones"]) {
    assert.ok(quick.includes(`<AdminDialogSection title="${title}"`), `falta la sección ${title}`);
  }
  assert.match(clientes, /layout="sections"/);
  assert.match(clientes, /<AdminDialogSection title="Notas y logo"/);
  assert.match(clientes, /error=\{formError\}/);
  assert.match(clientes, /busyLabel="Guardando…"/);
  assert.match(quick, /clientQuickPayload/, "el payload sigue saliendo de la función única");
});

test("no queda confirm() nativo en el panel", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(name)) files.push(full);
    }
  };
  walk(join(root, "components"));
  walk(join(root, "app"));
  for (const file of files) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /(?<![\w.])(?:window\.)?confirm\(/, `${file}: usa AdminConfirmDialog, no confirm()`);
  }
});
