import assert from "node:assert/strict";
import { test } from "node:test";
import { adminNavGroups } from "../lib/admin-policy";
import { DEMO_STRONG_CASES, DEMO_TOUR_STEPS } from "../lib/demo-tour";

/**
 * Reglas de la demo pública (issue #58): el recorrido guiado y los accesos
 * rápidos a los casos fuertes llevan a módulos que la cuenta demo (VIEWER) sí
 * puede abrir, y cada paso/caso tiene su texto. Si una ruta se mueve o un
 * módulo deja de ser visible para VIEWER, estos tests fallan.
 */

const VIEWER_ROUTES = new Set(
  adminNavGroups("VIEWER").flatMap((group) => group.items.map((item) => item.href)),
);

test("el recorrido guiado tiene 4–6 pasos y todos llevan a módulos de la demo", () => {
  assert.ok(
    DEMO_TOUR_STEPS.length >= 4 && DEMO_TOUR_STEPS.length <= 6,
    `el recorrido tiene que ser corto (pasos: ${DEMO_TOUR_STEPS.length})`,
  );
  const ids = new Set<string>();
  for (const step of DEMO_TOUR_STEPS) {
    assert.ok(step.id.trim().length > 0 && !ids.has(step.id), `id repetido o vacío: ${step.id}`);
    ids.add(step.id);
    assert.ok(step.title.trim().length > 0, `${step.id}: sin título`);
    assert.ok(step.what.trim().length > 0, `${step.id}: sin qué mirar`);
    assert.ok(VIEWER_ROUTES.has(step.href), `${step.id}: ruta que la demo no puede abrir (${step.href})`);
  }
});

test("los casos fuertes llevan a módulos de la demo y tienen id, etiqueta y ayuda", () => {
  assert.ok(
    DEMO_STRONG_CASES.length >= 5 && DEMO_STRONG_CASES.length <= 12,
    `casos fuera de rango: ${DEMO_STRONG_CASES.length}`,
  );
  const ids = new Set<string>();
  for (const strongCase of DEMO_STRONG_CASES) {
    assert.ok(!ids.has(strongCase.id), `id repetido: ${strongCase.id}`);
    ids.add(strongCase.id);
    assert.ok(strongCase.label.trim().length > 0, `${strongCase.id}: sin etiqueta`);
    assert.ok(strongCase.hint.trim().length > 0, `${strongCase.id}: sin ayuda`);
    assert.ok(VIEWER_ROUTES.has(strongCase.href), `${strongCase.id}: ruta que la demo no puede abrir (${strongCase.href})`);
  }
});
