import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetPipelineStage, budgetPrimaryAction, matchesPipelineFilter, type BudgetPipelineInput } from "../lib/budget-pipeline";

const base: BudgetPipelineInput = { status: "DRAFT", total: 1_000_000, advanceAmount: 300_000, collected: 0, event: null };
const full = { write: true, createEvent: true };

test("cada estado cae en una sola etapa", () => {
  assert.equal(budgetPipelineStage({ status: "DRAFT" }), "draft");
  assert.equal(budgetPipelineStage({ status: "SENT" }), "sent");
  assert.equal(budgetPipelineStage({ status: "NEGOTIATING" }), "sent");
  assert.equal(budgetPipelineStage({ status: "APPROVED", event: null }), "approved_pending_event");
  assert.equal(budgetPipelineStage({ status: "APPROVED", event: { status: "CONFIRMED" } }), "approved");
  assert.equal(budgetPipelineStage({ status: "APPROVED", event: { status: "DRAFT" } }), "approved");
  assert.equal(budgetPipelineStage({ status: "LOST" }), "lost");
  assert.equal(budgetPipelineStage({ status: "CANCELLED" }), "lost");
});

test("el filtro de aprobados junta las dos etapas aprobadas", () => {
  assert.ok(matchesPipelineFilter("approved", "approved_any"));
  assert.ok(matchesPipelineFilter("approved_pending_event", "approved_any"));
  assert.ok(!matchesPipelineFilter("sent", "approved_any"));
  assert.ok(matchesPipelineFilter("lost", "all"));
  assert.ok(!matchesPipelineFilter("approved", "approved_pending_event"));
});

test("la acción principal sigue la etapa", () => {
  assert.equal(budgetPrimaryAction(base, full)?.kind, "send");
  assert.equal(budgetPrimaryAction({ ...base, status: "SENT" }, full)?.kind, "approve");
  assert.equal(budgetPrimaryAction({ ...base, status: "SENT", revisionRequested: true }, full)?.kind, "edit");
  assert.equal(budgetPrimaryAction({ ...base, status: "APPROVED" }, full)?.kind, "create_event");
  assert.equal(budgetPrimaryAction({ ...base, status: "APPROVED", event: { status: "DRAFT" } }, full)?.kind, "confirm_event");
  const collect = budgetPrimaryAction({ ...base, status: "APPROVED", event: { status: "CONFIRMED" } }, full);
  assert.equal(collect?.kind, "collect");
  assert.equal(collect?.label, "Cobrar seña");
  assert.equal(budgetPrimaryAction({ ...base, status: "APPROVED", event: { status: "CONFIRMED" }, collected: 1_000_000 }, full), null);
  assert.equal(budgetPrimaryAction({ ...base, status: "LOST" }, full), null);
});

test("sin permisos no hay acción: VIEWER no ve mutaciones", () => {
  const none = { write: false, createEvent: false };
  for (const status of ["DRAFT", "SENT", "APPROVED", "LOST"]) {
    assert.equal(budgetPrimaryAction({ ...base, status }, none), null, status);
  }
  // Sin permiso de eventos, un aprobado sin evento pasa a cobrar si puede escribir.
  assert.equal(budgetPrimaryAction({ ...base, status: "APPROVED" }, { write: true, createEvent: false })?.kind, "collect");
});
