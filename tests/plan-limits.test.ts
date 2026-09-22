import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PLAN_CODE,
  DEMO_PLAN_CODE,
  monthKeyOf,
  monthLabel,
  nextMonthStartKey,
  PLAN_CATALOG,
  planLimitLabel,
  planLimitMessage,
  planLimitReached,
  planUsageLevel,
  planUsagePercent,
} from "../lib/plan-rules";

/**
 * Reglas puras de los planes (issue #42): límites, consumo, mes calendario y
 * mensajes. Son la fuente que usa el API para el 403 explicado y la UI para el
 * consumo; si una regla se reimplementa suelta, estos tests fallan.
 */

test("el catálogo tiene códigos e ids únicos y el plan por defecto existe", () => {
  const codes = PLAN_CATALOG.map((plan) => plan.code);
  const ids = PLAN_CATALOG.map((plan) => plan.id);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(codes.includes(DEFAULT_PLAN_CODE), `falta el plan por defecto ${DEFAULT_PLAN_CODE}`);
  assert.ok(codes.includes(DEMO_PLAN_CODE), `falta el plan de la demo ${DEMO_PLAN_CODE}`);
});

test("el catálogo tiene precios PYG enteros y límites válidos", () => {
  for (const plan of PLAN_CATALOG) {
    assert.ok(Number.isInteger(plan.priceMonthly) && plan.priceMonthly >= 0, `${plan.code}: precio inválido`);
    for (const limit of [plan.maxUsers, plan.maxEventsPerMonth]) {
      assert.ok(limit === null || (Number.isInteger(limit) && limit > 0), `${plan.code}: límite inválido`);
    }
    assert.ok(plan.features.length > 0, `${plan.code}: sin capacidades listadas`);
    assert.equal(typeof plan.description, "string");
    assert.ok(plan.sortOrder > 0);
  }
});

test("planLimitReached deja pasar hasta el tope exacto", () => {
  assert.equal(planLimitReached(5, 4), false);
  assert.equal(planLimitReached(5, 5), true);
  assert.equal(planLimitReached(5, 4, 2), true);
  assert.equal(planLimitReached(null, 999), false);
  assert.equal(planLimitReached(undefined, 999), false);
});

test("el consumo nunca supera el 100 % y el semáforo avisa al 80 %", () => {
  assert.equal(planUsagePercent(0, 5), 0);
  assert.equal(planUsagePercent(2, 4), 50);
  assert.equal(planUsagePercent(10, 5), 100);
  assert.equal(planUsagePercent(3, null), null);
  assert.equal(planUsageLevel(0, 5), "ok");
  assert.equal(planUsageLevel(4, 5), "warn");
  assert.equal(planUsageLevel(5, 5), "warn");
  assert.equal(planUsageLevel(6, 5), "danger");
  assert.equal(planUsageLevel(6, null), "none");
});

test("el tope sin límite se dibuja «Sin tope»", () => {
  assert.equal(planLimitLabel(null), "Sin tope");
  assert.equal(planLimitLabel(undefined), "Sin tope");
  assert.equal(planLimitLabel(50), "50");
  assert.equal(planLimitLabel(1234), "1.234");
});

test("el mensaje del límite de usuarios nombra el plan, el tope y el consumo", () => {
  const message = planLimitMessage({ planName: "Inicial", resource: "users", limit: 5, used: 5 });
  assert.match(message, /Inicial/);
  assert.match(message, /5 usuarios/);
  assert.match(message, /ya tenés 5/);
  assert.match(message, /cambio de plan/);
});

test("el mensaje del límite de eventos nombra el mes", () => {
  const message = planLimitMessage({
    planName: "Inicial",
    resource: "events",
    limit: 50,
    used: 50,
    periodLabel: "septiembre de 2026",
  });
  assert.match(message, /50 eventos por mes/);
  assert.match(message, /septiembre de 2026/);
  const fallback = planLimitMessage({ planName: "Inicial", resource: "events", limit: 50, used: 50 });
  assert.match(fallback, /este mes/);
});

test("el mes calendario cierra en el primer día del mes siguiente", () => {
  assert.equal(monthKeyOf("2026-09-21"), "2026-09");
  assert.equal(nextMonthStartKey("2026-09-21"), "2026-10-01");
  assert.equal(nextMonthStartKey("2026-12-31"), "2027-01-01");
  assert.equal(nextMonthStartKey("2026-01-01"), "2026-02-01");
  assert.equal(monthLabel("2026-09"), "septiembre de 2026");
});
