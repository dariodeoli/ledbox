import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { config } from "../middleware";

// Fuente: el ZIP de 42 MB de «Importar catálogo» llega entero a la ruta porque el middleware
// (que bufferea el cuerpo con un tope de 10 MB) no corre en esa ruta, sin subir el tope global.
const matcherRegex = new RegExp(`^${config.matcher[0]}$`);

test("el middleware no corre en /api/admin/import (el ZIP grande llega entero) y sí en el resto", () => {
  for (const path of ["/api/admin/import/productos", "/api/admin/import/productos/", "/api/admin/import"]) {
    assert.equal(matcherRegex.test(path), false, `${path} debe quedar fuera del middleware`);
  }
  for (const path of ["/", "/inventario", "/api/admin/importar", "/api/admin/imports", "/api/admin/budgets", "/api/portal/budget/x/approve", "/api/catalog/org/preorder"]) {
    assert.equal(matcherRegex.test(path), true, `${path} sigue pasando por el middleware`);
  }
});

test("no se sube el tope de cuerpo del middleware globalmente", () => {
  const next = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(next.replace(/\/\/.*$/gm, ""), /middlewareClientMaxBodySize/);
});
