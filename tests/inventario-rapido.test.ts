import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Inventario, etapa B: un clic abre la ficha, Ctrl/Cmd-clic selecciona, la vista se recuerda.
 * Pruebas de fuente (el comportamiento en pantalla se verificó a mano en localhost).
 */
const read = (file: string) => readFileSync(file, "utf8");

test("la lista abre la ficha con un clic en toda la fila y Ctrl/Cmd/Shift-clic selecciona sin abrir", () => {
  const list = read("components/admin/modules/InventoryList.tsx");
  assert.match(list, /<AdminRow key=\{item\.id\} selected=\{bulkIds\.includes\(item\.id\)\} onActivate=/);
  assert.match(list, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
  assert.match(list, /props\.onToggleBulk\(item\.id\)/);
  assert.match(list, /props\.onOpen\(item\.id\)/);
});

test("la fila de la tabla ignora el clic sobre sus propios controles y no se activa con el teclado por sí sola", () => {
  const ui = read("components/admin/AdminUI.tsx");
  assert.match(ui, /closest\("button, a, input, select, textarea, label/);
  assert.match(ui, /data-clickable=\{onActivate \? "true" : undefined\}/);
});

test("la tarjeta de la cuadrícula abre la ficha con un botón (Enter) y Ctrl/Cmd-clic selecciona", () => {
  const tiles = read("components/admin/modules/InventoryTiles.tsx");
  assert.match(tiles, /<button type="button" className="admin-inv-tile-open"/);
  assert.match(tiles, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
  assert.match(tiles, /onOpen\(selectedItem\.id\)/);
  assert.match(tiles, /variants=\{variants\}/, "la cuadrícula agrupa y permite abrir la variante seleccionada");
});

test("el inventario arranca en cuadrícula, recuerda la vista con try/catch y conserva ?producto=", () => {
  const module = read("components/admin/modules/InventarioModule.tsx");
  assert.match(module, /useAdminModuleView\("inventario", INVENTARIO_VIEWS, "grid"\)/);
  assert.match(module, /url\.searchParams\.set\("producto", id\)/);
  const board = read("components/admin/AdminBoard.tsx");
  assert.match(board, /try \{[\s\S]*localStorage\.getItem\(`ledbox-admin-view:\$\{module\}`\)[\s\S]*\} catch/);
});
