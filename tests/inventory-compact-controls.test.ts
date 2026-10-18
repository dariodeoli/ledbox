import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const moduleSource = readFileSync("components/admin/modules/InventarioModule.tsx", "utf8");
const tilesSource = readFileSync("components/admin/modules/InventoryTiles.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("inventario agrupa exportaciones y elimina la acción de escaneo aún no disponible", () => {
  assert.match(moduleSource, /label="Exportar inventario"[\s\S]*?Unidades por depósito[\s\S]*?Exportar inventario filtrado a CSV/);
  assert.doesNotMatch(moduleSource, /Escanear · próximamente/);
});

test("las variantes comparten una tarjeta y el selector es operable en pantallas táctiles", () => {
  assert.match(tilesSource, /groupInventoryCards\(rows\)/);
  assert.match(tilesSource, /<AdminSelect[\s\S]*?label=\{`Variante de/);
  assert.match(tilesSource, /onOpen\(selectedItem\.id\)/);
  assert.match(css, /\.admin-inv-family-picker \.admin-inv-variant-select \{ min-height: 44px; \}/);
});

test("la barra fija y encabezados de categoría usan fondo sólido y filtros accesibles en móvil", () => {
  assert.match(css, /\.admin-inv-bar \{[^}]*background: var\(--a-panel\);/);
  assert.match(css, /\.admin-inv-section-head \{[^}]*background: var\(--a-panel\);/);
  assert.match(css, /\.admin-inv-bar \.admin-toolbar > \.admin-combobox input \{ min-height: 44px; \}/);
  assert.match(css, /\.admin-inv-export-menu \{ flex: 1 0 100%; justify-content: flex-end;/);
});
