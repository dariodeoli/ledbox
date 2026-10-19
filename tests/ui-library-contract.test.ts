import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("la entrada pública expone una sola estructura para lista, cuadrícula y pipeline", () => {
  const entry = read("components", "ui", "index.ts");
  const board = read("components", "admin", "AdminBoard.tsx");
  const cards = read("components", "admin", "AdminCards.tsx");
  for (const name of ["AdminViewSwitch", "AdminBoard", "useAdminModuleView", "useAdminNarrowViewport", "useAdminBoardMove"])
    assert.match(entry, new RegExp(`\\b${name}\\b`), `${name} debe estar disponible desde components/ui`);
  assert.match(entry, /AdminCardGrid[\s\S]*?AdminCards/);
  assert.match(board, /export type AdminModuleView = "list" \| "board" \| "grid"/);
  assert.match(cards, /export function AdminCardGrid/);
});

test("Combobox filtra opciones entregadas por la pantalla y no persiste texto libre por defecto", () => {
  const fields = read("components", "admin", "AdminFields.tsx");
  const docs = read("docs", "UI-LIBRARY.md");
  assert.match(fields, /allowCustomValue = false/);
  assert.match(fields, /options: ComboboxOption\[\]/);
  assert.match(fields, /if \(allowCustomValue\) onChange\(next\)/);
  assert.match(docs, /empresa activa[\s\S]*categorías de esa empresa que tienen resultados visibles[\s\S]*taxonomía completa permitida/);
});

test("familias y variantes permiten preview/selección sin crear stock desde el componente", () => {
  const docs = read("docs", "UI-LIBRARY.md");
  assert.match(docs, /Familias, variantes y selección sin efectos laterales \(#317\)/);
  assert.match(docs, /identificador estable de variante/);
  assert.match(docs, /La vista previa es sólo lectura/);
  assert.match(docs, /nunca crea unidades ni\s+reservas desde un selector/);
});

test("contrato de avisos coincide con las variantes realmente soportadas", () => {
  const ui = read("components", "admin", "AdminUI.tsx");
  const docs = read("docs", "UI-LIBRARY.md");
  assert.match(ui, /tone\?: "ok" \| "warn" \| "error"/);
  assert.match(docs, /AdminNote`: aviso inline neutral \(sin `tone`\), `ok`, `warn` o `error`/);
  assert.match(docs, /toast genérico del panel/);
});
