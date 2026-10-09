import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Un componente por tipo (issue #101): cada tipo repetido del panel se dibuja
 * con **un** componente del kit y su regla vive en `lib/field-rules.ts`. El
 * caso nuevo de esta ronda es RUC/C.I. (`RucField`); la adopción de los
 * componentes de `owncoding-ui` (correo y porcentaje) queda frenada por un
 * asunto de plataforma —ver `nota-panel-101.md`— así que estas guardas cubren
 * lo entregado: el tipo nuevo no se duplica y las reglas se delegan.
 */
const root = process.cwd();
const fields = readFileSync(join(root, "components", "admin", "AdminFields.tsx"), "utf8");
const rules = readFileSync(join(root, "lib", "field-rules.ts"), "utf8");
const block = (name: string, next: string) => {
  const start = fields.indexOf(`export function ${name}`);
  const end = fields.indexOf(`export function ${next}`, start);
  assert.ok(start > 0 && end > start, `no se encontró el bloque ${name}`);
  return fields.slice(start, end);
};
const MODULES_DIR = join(root, "components", "admin", "modules");

test("RUC / C.I. tiene un solo componente en el kit", () => {
  const ruc = block("RucField", "SerialField");
  assert.match(ruc, /rucInput\(value, maxLength\)/, "la máscara sale de las reglas del panel");
  assert.match(ruc, /inputMode="numeric"/, "teclado numérico");
  assert.match(ruc, /maxLength = 20/, "largo por defecto del documento");
  assert.match(rules, /export function rucInput/, "la regla vive en lib/field-rules.ts");
  assert.match(rules, /limpiarTaxId/, "la limpieza delega en la librería");
});

test("los módulos usan RucField y no arman la máscara a mano", () => {
  const modules = readdirSync(MODULES_DIR).filter((file) => file.endsWith(".tsx"));
  const withRuc = modules.filter((file) => /label="RUC/.test(readFileSync(join(MODULES_DIR, file), "utf8")));
  assert.ok(withRuc.length >= 3, `se esperaban al menos 3 módulos con RUC (hay ${withRuc.length})`);
  for (const file of withRuc) {
    const source = readFileSync(join(MODULES_DIR, file), "utf8");
    assert.match(source, /<RucField/, `${file}: el RUC no usa RucField`);
    assert.doesNotMatch(source, /inputMode="numeric"/, `${file}: el RUC no arma la máscara a mano`);
  }
});

test("las reglas de porcentaje y correo siguen delegando en la librería", () => {
  assert.match(rules, /limpiarPercent/, "el porcentaje delega en limpiarPercent");
  assert.match(rules, /export function rucInput/, "el RUC tiene su regla propia sobre limpiarTaxId");
  assert.match(fields, /MoneyInput,[\s\S]*from "owncoding-ui"/, "el monto usa el componente de la librería (#99)");
});
