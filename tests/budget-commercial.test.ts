import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  budgetCommercialChanges,
  budgetCommercialGuard,
  mergeBudgetCommercial,
  touchesBudgetClientFields,
  type BudgetCommercialSnapshot,
} from "../lib/budget-commercial";

/**
 * PATCH comercial del presupuesto (issue #70): cambiar solo un campo del cliente
 * —notas, garantía, IVA, entrega o vigencia— tiene que guardarse y auditarse.
 * Antes el early-return solo miraba costos y descuento, así que esos cambios se
 * descartaban en silencio (`unchanged: true`). Estos tests fijan la comparación
 * completa, el congelamiento post-aprobación y que el endpoint use el módulo.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** Presupuesto canónico: con costos internos, entrega, IVA, garantía y notas. */
function current(): BudgetCommercialSnapshot {
  return {
    materialCost: 5_105_000,
    laborCost: 3_000_000,
    discount: 2_430_769,
    validUntil: "2026-10-01",
    deliveryAt: "2026-10-10",
    ivaType: "IVA10",
    warranty: "12 meses por defectos de fabricación.",
    notes: "Incluye montaje y desmontaje.",
  };
}

test("cambiar solo las notas se guarda y se audita (repro del issue)", () => {
  const changes = budgetCommercialChanges(current(), { notes: "Sumamos la operación técnica del segundo día." });
  assert.ok(changes, "el cambio de notas no puede salir como unchanged");
  assert.deepEqual(Object.keys(changes), ["notes"]);
  assert.equal(changes.notes.from, "Incluye montaje y desmontaje.");
  assert.equal(changes.notes.to, "Sumamos la operación técnica del segundo día.");
});

test("cambiar solo la garantía se guarda", () => {
  const changes = budgetCommercialChanges(current(), { warranty: "6 meses de garantía extendida." });
  assert.ok(changes);
  assert.deepEqual(Object.keys(changes), ["warranty"]);
});

test("cambiar solo el IVA, la entrega o la vigencia se guarda", () => {
  for (const [field, value] of [
    ["ivaType", "IVA5"],
    ["deliveryAt", "2026-10-20"],
    ["validUntil", "2026-11-01"],
  ] as const) {
    const changes = budgetCommercialChanges(current(), { [field]: value });
    assert.ok(changes, `${field} tiene que registrar el cambio`);
    assert.deepEqual(Object.keys(changes), [field]);
  }
});

test("un cambio combinado registra todos los campos que cambiaron", () => {
  const changes = budgetCommercialChanges(current(), {
    notes: "Nuevas notas",
    warranty: "Nueva garantía",
    ivaType: "EXEMPT",
    deliveryAt: "2026-11-15",
    materialCost: 5_500_000,
  });
  assert.ok(changes);
  assert.deepEqual(Object.keys(changes).sort(), ["deliveryAt", "ivaType", "materialCost", "notes", "warranty"]);
});

test("sin cambios reales el endpoint responde unchanged", () => {
  assert.equal(budgetCommercialChanges(current(), {}), null);
  assert.equal(budgetCommercialChanges(current(), { notes: current().notes }), null);
  assert.equal(budgetCommercialChanges(current(), { materialCost: current().materialCost, ivaType: "IVA10" }), null);
});

test("borrar un dato del cliente también es un cambio", () => {
  const changes = budgetCommercialChanges(current(), { warranty: null, deliveryAt: null });
  assert.ok(changes);
  assert.deepEqual(Object.keys(changes).sort(), ["deliveryAt", "warranty"]);
  assert.equal(changes.warranty.to, null);
});

test("el merge no inventa campos que no vinieron en el patch", () => {
  const merged = mergeBudgetCommercial(current(), { notes: "solo notas" });
  assert.equal(merged.notes, "solo notas");
  assert.equal(merged.ivaType, "IVA10");
  assert.equal(merged.materialCost, 5_105_000);
});

test("la versión del cliente queda congelada con la aprobación (los costos no)", () => {
  const aprobado = { approved: true, status: "APPROVED" };
  for (const body of [{ notes: "x" }, { warranty: "x" }, { ivaType: "IVA5" }, { deliveryAt: "2026-12-01" }, { validUntil: "2026-12-01" }, { discount: 1_000 }]) {
    const result = budgetCommercialGuard(aprobado, body);
    assert.equal(result.ok, false, `${Object.keys(body)[0]} no se puede tocar tras la aprobación`);
    if (!result.ok) assert.equal(result.status, 409);
  }
  // Los costos internos son del dueño: se corrigen siempre.
  assert.deepEqual(budgetCommercialGuard(aprobado, { materialCost: 5_200_000 }), { ok: true });
  assert.deepEqual(budgetCommercialGuard(aprobado, { laborCost: 3_100_000 }), { ok: true });
});

test("perdido o cancelado no se edita; en juego sin aprobar sí", () => {
  for (const status of ["LOST", "CANCELLED"]) {
    const result = budgetCommercialGuard({ approved: false, status }, { notes: "x" });
    assert.equal(result.ok, false);
  }
  assert.deepEqual(budgetCommercialGuard({ approved: false, status: "DRAFT" }, { notes: "x" }), { ok: true });
  assert.deepEqual(budgetCommercialGuard({ approved: false, status: "SENT" }, { discount: 0 }), { ok: true });
  assert.equal(touchesBudgetClientFields({ materialCost: 1 }), false);
  assert.equal(touchesBudgetClientFields({ notes: "" }), true);
});

test("el endpoint usa la comparación completa y la guarda del módulo", () => {
  const route = repoFile("app/api/admin/budgets/route.ts");
  assert.match(route, /budgetCommercialChanges\(/, "el PATCH comercial compara todos los campos");
  assert.match(route, /budgetCommercialGuard\(/, "el PATCH comercial respeta el congelamiento");
  // El early-return viejo (solo costos y descuento) no puede volver.
  assert.doesNotMatch(route, /if \(discount !== budget\.discount\) changes\.discount/);
  assert.doesNotMatch(route, /Object\.keys\(data\)\.length === 0 \|\| Object\.keys\(changes\)\.length === 0/);
});
