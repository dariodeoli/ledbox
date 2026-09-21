#!/usr/bin/env node
/**
 * Aserción de fuente del kit de campos (docs/REGLAS-GENERALES.md):
 *
 * 1. En `components/admin` no puede quedar ningún `<input>`, `<select>` ni
 *    `<textarea>` suelto. Los campos se dibujan con el kit canónico
 *    (`components/admin/AdminFields.tsx`) y los primitivos compartidos viven en
 *    `components/admin/AdminUI.tsx` (filtro/select de celda); esos dos archivos
 *    son la única excepción.
 * 2. `type="number"` está prohibido en todo el panel (también dentro de los
 *    primitivos): los montos van con `MoneyField` y las cantidades con
 *    `NumberField`.
 *
 * Excepción documentada: los checkbox de fila (`<input type="checkbox">`, por
 * ejemplo el checklist operativo) son la primitiva de selección múltiple.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "components", "admin");
const PRIMITIVE_FILES = new Set([resolve(SCAN_DIR, "AdminFields.tsx"), resolve(SCAN_DIR, "AdminUI.tsx")]);
const TAG_PATTERN = /<(input|select|textarea)\b[\s\S]*?>/g;
const NUMBER_TYPE_PATTERN = /type=["']number["']/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Tapa comentarios conservando los saltos de línea (los números de línea no se mueven). */
function maskComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (comment) => " ".repeat(comment.length));
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

const violations = [];
for (const file of walk(SCAN_DIR)) {
  const path = relative(ROOT, file);
  const source = maskComments(readFileSync(file, "utf8"));
  const isPrimitive = PRIMITIVE_FILES.has(resolve(file));

  if (!isPrimitive) {
    for (const match of source.matchAll(TAG_PATTERN)) {
      const name = match[0].match(/^<(\w+)/)[1];
      if (name === "input" && /type="checkbox"/.test(match[0])) continue;
      violations.push({ path, line: lineOf(source, match.index), message: `campo suelto <${name}>: usá el kit canónico (components/admin/AdminFields.tsx)` });
    }
  }

  source.split("\n").forEach((text, position) => {
    if (!NUMBER_TYPE_PATTERN.test(text)) return;
    violations.push({ path, line: position + 1, message: 'type="number" prohibido: usá MoneyField o NumberField' });
  });
}

if (violations.length > 0) {
  console.error(`Chequeo de campos: ${violations.length} problema(s) de fuente.`);
  for (const violation of violations) {
    console.error(`  ${violation.path}:${violation.line}: ${violation.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("Chequeo de campos: sin inputs sueltos ni type=\"number\" en el panel.");
}
