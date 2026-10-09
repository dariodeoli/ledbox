import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * KPI compacto (issue #113): el contenedor `.admin-kpi` mide lo mínimo (~48 px),
 * el label, el número y la nota comparten la línea en escritorio y la nota
 * trunca con `title` cuando no entra. En mobile el label usa su línea y el KPI
 * queda en dos. Estas guardas frenan la vuelta a la tarjeta alta.
 */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ui = readFileSync(join(process.cwd(), "components", "admin", "AdminUI.tsx"), "utf8");
const rule = (selector: string) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("el KPI entra en una línea alta (~48 px)", () => {
  const kpi = rule(".admin-kpi");
  assert.match(kpi, /display:\s*flex/, "label, número y nota comparten la línea");
  assert.match(kpi, /flex-wrap:\s*nowrap/, "sin envolver en escritorio: la nota trunca");
  assert.match(kpi, /min-height:\s*48px/, "alto mínimo del compacto (44–52)");
  assert.match(kpi, /padding:\s*8px 10px/, "padding chico");
});

test("la nota y el label truncan, con el texto completo en el title", () => {
  assert.match(rule(".admin-kpi-note"), /text-overflow:\s*ellipsis/, "la nota trunca");
  assert.match(rule(".admin-kpi-note"), /flex:\s*1 1000 0%/, "la nota cede primero: el label y el número no se recortan");
  assert.match(rule(".admin-kpi-label-text"), /text-overflow:\s*ellipsis/, "el label trunca solo si hace falta");
  assert.match(ui, /admin-kpi-note" title=\{note\}/, "la nota lleva el texto completo en el title");
  assert.match(ui, /admin-kpi-value" title=\{value\}/, "el valor también");
  assert.match(ui, /admin-kpi-label-text" title=\{label\}/, "y el label");
});

test("mobile: el label ocupa su línea y el KPI usa dos", () => {
  const mobile = [...css.matchAll(/@media \(max-width: 720px\) \{[\s\S]*?\n\}/g)].map((match) => match[0]).join("\n");
  assert.match(mobile, /\.admin-kpi\s*\{\s*flex-wrap:\s*wrap/, "en mobile envuelve");
  assert.match(mobile, /\.admin-kpi-label\s*\{\s*flex-basis:\s*100%/, "el label va arriba");
});
