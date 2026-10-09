import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * `MoneyField` envuelve el `MoneyInput` de `owncoding-ui` (issue #99): el panel
 * ya no replica el input de dinero. Estas guardas frenan la vuelta a un `<input>`
 * propio y comprueban que el contrato del kit siga en pie: entero limpio,
 * tope del campo y `aria-invalid` marcado (error del campo y tope).
 */
const fields = readFileSync(join(process.cwd(), "components", "admin", "AdminFields.tsx"), "utf8");
const money = fields.slice(fields.indexOf("export function MoneyField"), fields.indexOf("export function PercentField"));
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("MoneyField usa el componente de la librería", () => {
  assert.match(fields, /MoneyInput,[\s\S]*from "owncoding-ui"/, "falta el import de la librería");
  assert.match(money, /<MoneyInput/, "el campo no usa el MoneyInput de la librería");
  assert.doesNotMatch(money, /<input\b/, "no puede dibujar el input a mano");
});

test("conserva el contrato del kit: entero limpio, tope y PYG", () => {
  assert.match(money, /onValueChange=/, "el valor entra por onValueChange");
  assert.match(money, /onChange\(amountInput\(wrapperRef/, "conserva el entero original sin redondear Number");
  assert.match(money, /max=\{effectiveLimit\}/, "el tope compatible con Int viaja al componente");
  assert.match(money, /integerOnly/, "PYG va entero");
  assert.match(money, /limit = FIELD_LIMITS\.amountGeneral/, "tope por defecto del kit");
});

test("el error del campo sigue marcando aria-invalid", () => {
  assert.match(money, /setAttribute\("aria-invalid", "true"\)/, "el error del campo no llega al input");
  assert.match(money, /amountExceeds\(amountInput\(value\), effectiveLimit\)/, "el tope se evalúa con las reglas del panel");
});

test("el prefijo de la moneda se dibuja dentro del campo", () => {
  assert.match(css, /\.admin-money\s*\{[^}]*position:\s*relative/, "el contenedor del MoneyInput es relativo");
  assert.match(css, /\.admin-money span\s*\{[^}]*position:\s*absolute/, "el prefijo «Gs» se posiciona dentro del campo");
  assert.match(css, /\.admin-money input\s*\{[^}]*padding-left/, "el input deja lugar al prefijo");
});
