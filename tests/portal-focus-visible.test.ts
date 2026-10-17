import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("los campos del portal conservan un anillo visible al navegar con teclado", () => {
  const rule = /\.portal \.portal-field :is\(input, textarea, select\):focus-visible \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /outline:\s*2px solid var\(--p-action\)/, "falta el anillo de foco con el color de acción del tema");
  assert.match(rule, /outline-offset:\s*2px/, "el anillo debe quedar separado del borde del campo");
});
