import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Facturación y Plantillas en mobile (issue #153, auditoría móvil crítica 3):
 * Facturación usa tarjetas (≤980 px, `useAdminNarrowViewport`), Mensajes
 * apila su biblioteca/editor/vista previa, y el cierre mensual es una
 * sola corriente —el flex viejo lo partía en columnas y palabras sueltas—. Si
 * una pantalla vuelve a la tabla con scroll horizontal o al texto en columnas,
 * estos tests fallan.
 */
const root = process.cwd();
const facturacion = readFileSync(join(root, "components/admin/modules/FacturacionModule.tsx"), "utf8");
const plantillas = readFileSync(join(root, "components/admin/modules/PlantillasModule.tsx"), "utf8");
const css = readFileSync(join(root, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("las listas de Facturación ofrecen tarjetas en pantalla chica", () => {
  assert.match(facturacion, /useAdminNarrowViewport\(\)/, "Facturación: falta la regla compacta del panel");
  assert.match(facturacion, /<AdminCardGrid/, "Facturación: falta la grilla de tarjetas");
});

test("Mensajes apila biblioteca, editor y vista previa sin tablas horizontales en móvil", () => {
  assert.match(plantillas, /className="admin-message-workspace"/);
  for (const column of ["library", "editor", "preview-column"]) assert.match(plantillas, new RegExp(`className="admin-message-${column}"`));
  assert.doesNotMatch(plantillas, /<AdminTable\b/, "la biblioteca debe seguir siendo una lista usable sin scroll horizontal");
  const workspace = css.slice(css.indexOf(".admin-message-workspace"));
  assert.match(workspace, /\.admin-message-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(190px, \.8fr\) minmax\(280px, 1\.4fr\) minmax\(230px, 1fr\)/, "tres columnas de escritorio");
  assert.match(workspace, /@media \(max-width: 767px\)\s*\{\s*\.admin-message-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/, "una columna en móvil");
  assert.match(workspace, /\.admin-message-workspace > div\s*\{[^}]*min-width:\s*0/, "el contenido puede compactarse sin desbordar");
  assert.match(workspace, /\.admin-message-template\s*\{[^}]*min-height:\s*44px/, "objetivos táctiles de 44 px");
  assert.match(workspace, /\.admin-message-list\s*\{[^}]*max-height:\s*260px/, "la biblioteca deja espacio para editar en móvil");
});

test("cada tabla de Facturación tiene su par en tarjetas", () => {
  const views = ["facturables", "facturas", "compras", "libro-ventas", "libro-compras", "cierres"];
  for (const view of views) {
    assert.match(facturacion, new RegExp(`view="${view}"`), `falta la tabla ${view}`);
  }
  assert.equal((facturacion.match(/compact \? \(/g) ?? []).length, views.length, "hay tablas sin su variante compacta");
  assert.equal((facturacion.match(/<AdminCardGrid/g) ?? []).length, views.length, "faltan grillas de tarjetas");
});

test("la nota explicativa del panel es una sola corriente de texto", () => {
  const rule = /\.admin-note\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(rule, "falta la regla .admin-note");
  assert.doesNotMatch(rule, /display:\s*flex/, "el flex vuelve a partir el texto en columnas");
  assert.match(rule, /overflow-wrap:\s*break-word/, "el texto largo tiene que poder cortar");
  assert.match(css, /\.admin-note > \.admin-icon\s*\{[^}]*vertical-align/, "el ícono de la nota queda en línea");
  // El cierre mensual usa la nota compartida con su <strong> inline.
  assert.match(facturacion, /Cerrar el mes congela el resumen y <strong>bloquea<\/strong>/, "el aviso del cierre no está en la nota");
});
