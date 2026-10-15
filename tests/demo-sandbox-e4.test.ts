import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** Demo interactiva E4 (docs/DEMO-INTERACTIVA.md §4, criterio 20): métricas de sandboxes en Tráfico → Demo. */

const root = process.cwd();
const src = (path: string) =>
  readFileSync(join(root, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("Tráfico → Demo: muestra creadas, activas, reinicios, % con escritura, acciones y entidades", () => {
  const page = src("app/(superadmin)/superadmin/trafico/page.tsx");
  for (const text of ["Sandboxes creadas", "Activas ahora", "Reinicios", "Con al menos una escritura", "Acciones promedio", "Entidades más tocadas"]) {
    assert.ok(page.includes(text), text);
  }
  assert.ok(page.includes("Ninguna cuenta como empresa real"));
  const query = src("lib/platform/queries/trafico.ts");
  assert.ok(query.includes("jsonb_each_text") && query.includes('"AuditLog"'), "purgadas desde DemoSession y vivas desde AuditLog");
});
