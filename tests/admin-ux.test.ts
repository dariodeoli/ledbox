import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_NAV } from "../lib/admin-policy";
import { ADMIN_ROUTES } from "../lib/admin-routes";
import { groupSearchResults, SEARCH_GROUP_ORDER, type AdminSearchResult } from "../lib/admin-search";
import { MODULE_HELP, moduleHelpFor } from "../lib/module-help";

/**
 * Reglas del UX del panel (22-09-2026): la ayuda contextual cubre todos los
 * módulos del nav con textos útiles y links internos reales, y el agrupado del
 * buscador global respeta el orden de los tipos. Si un módulo nuevo queda sin
 * ayuda o una ayuda se sale del contrato, estos tests fallan.
 */

test("todos los módulos del nav tienen ayuda contextual", () => {
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      assert.ok(MODULE_HELP[item.href], `falta la ayuda de ${item.href}`);
    }
  }
});

test("la ayuda tiene 3–5 bullets, 2–3 links internos y links a rutas reales", () => {
  for (const [href, help] of Object.entries(MODULE_HELP)) {
    assert.ok(help.title.trim().length > 0, `${href}: sin título`);
    assert.ok(help.summary.trim().length > 0, `${href}: sin resumen`);
    assert.ok(
      help.bullets.length >= 3 && help.bullets.length <= 5,
      `${href}: ${help.bullets.length} bullets (contrato: 3–5)`,
    );
    assert.ok(help.links.length >= 2 && help.links.length <= 3, `${href}: ${help.links.length} links (contrato: 2–3)`);
    for (const bullet of help.bullets) {
      assert.ok(bullet.trim().length > 0, `${href}: bullet vacío`);
    }
    for (const link of help.links) {
      assert.ok(link.label.trim().length > 0, `${href}: link sin etiqueta`);
      assert.ok((ADMIN_ROUTES as readonly string[]).includes(link.href), `${href}: link a una ruta que no es del panel (${link.href})`);
    }
  }
});

test("la ayuda se resuelve por ruta exacta y por prefijo, y no inventa rutas", () => {
  assert.equal(moduleHelpFor("/eventos")?.title, "Eventos");
  assert.equal(moduleHelpFor("/dashboard")?.title, "Resumen");
  assert.equal(moduleHelpFor("/configuracion/seguridad")?.title, "Configuración");
  assert.equal(moduleHelpFor("/demo"), null);
  assert.equal(moduleHelpFor("/ruta-inexistente"), null);
});

test("el agrupado del buscador respeta el orden de los tipos y descarta grupos vacíos", () => {
  const results: AdminSearchResult[] = [
    { type: "user", id: "u1", title: "Ana", subtitle: "", href: "/usuarios" },
    { type: "event", id: "e1", title: "Feria", subtitle: "", href: "/eventos" },
    { type: "client", id: "c1", title: "ACME", subtitle: "", href: "/clientes" },
    { type: "client", id: "c2", title: "Beta", subtitle: "", href: "/clientes" },
  ];
  const groups = groupSearchResults(results);
  assert.deepEqual(
    groups.map((group) => group.type),
    ["client", "event", "user"],
  );
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups.length, SEARCH_GROUP_ORDER.length - 1);
  assert.deepEqual(groupSearchResults([]), []);
});
