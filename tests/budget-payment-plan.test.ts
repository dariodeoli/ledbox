import assert from "node:assert/strict";
import { test } from "node:test";
import { BUDGET_INT_MAX, budgetPlanLedgerError, resolveBudgetPaymentPlan } from "../lib/budget-payment-plan";
import { budgetItemError, budgetUsesDays } from "../lib/budget-items";
const percent = (value: number) => ({ label: "Anticipo", type: "percent", value, moment: "Al confirmar" });
const fixed = (value: number) => ({ label: "Reserva", type: "fixed", value, dueAt: "2026-12-01" });
const remainder = { label: "Saldo", type: "remainder", moment: "Antes del montaje" };
test("percentage follows final discounted total while fixed payments remain fixed", () => {
  for (const total of [1000, 800, 1600]) {
    const result = resolveBudgetPaymentPlan([percent(25), fixed(100), remainder], total);
    assert.ok(result.ok);
    assert.deepEqual(result.rows.map((row) => row.amount), [total / 4, 100, total * .75 - 100]);
    assert.equal(result.assigned, total); assert.equal(result.remaining, 0);
  }
});
test("rounding closes percentage plans exactly across small and Int totals", () => {
  for (const total of [1, 2, 3, 7, 101, BUDGET_INT_MAX]) {
    const result = resolveBudgetPaymentPlan([percent(33.33), percent(33.33), percent(33.34)], total);
    assert.ok(result.ok);
    assert.equal(result.rows.reduce((sum, row) => sum + row.amount, 0), total);
    assert.equal(result.remaining, 0);
  }
});
test("legacy partial plan keeps unassigned balance and missing historical date", () => {
  const result = resolveBudgetPaymentPlan([{ label: "Cuota", amount: 20, dueAt: null }], 100, 10);
  assert.ok(result.ok); assert.equal(result.assigned, 30); assert.equal(result.remaining, 70);
  assert.equal(resolveBudgetPaymentPlan(result.rows, 100, 10).ok, true);
});
test("strict JSON validation rejects coercion, impossible dates, sums and limits", () => {
  const bad = [percent(101), percent(-1), percent(33.333), { ...fixed(10), value: true }, { ...fixed(10), value: "10" }, { ...fixed(10), dueAt: true }, { ...fixed(10), dueAt: "2026-02-30" }, { ...percent(10), moment: 123 }, fixed(BUDGET_INT_MAX + 1)];
  for (const row of bad) assert.equal(resolveBudgetPaymentPlan([row], 100).ok, false, JSON.stringify(row));
  assert.equal(resolveBudgetPaymentPlan([percent(60), percent(50)], 100).ok, false);
  assert.equal(resolveBudgetPaymentPlan([fixed(90), percent(20)], 100).ok, false);
  assert.equal(resolveBudgetPaymentPlan([remainder, remainder], 100).ok, false);
  assert.equal(resolveBudgetPaymentPlan([fixed(10)], BUDGET_INT_MAX + 1).ok, false);
});
test("paid/proof concepts cannot silently understate the revised pending balance", () => {
  for (const status of ["CONFIRMED", "PARTIAL", "PROOF"]) {
    const existing = [{ slot: "installment:1", amount: 50, paidAmount: status === "PARTIAL" ? 20 : 0, status }];
    assert.equal(budgetPlanLedgerError([{ slot: "installment:1", amount: 50 }, { slot: "installment:2", amount: 50 }], existing), null);
    assert.match(budgetPlanLedgerError([{ slot: "installment:1", amount: 70 }, { slot: "installment:2", amount: 30 }], existing)!, /cobros/);
    assert.ok(budgetPlanLedgerError([{ slot: "balance", amount: 100 }], existing));
    const plan = resolveBudgetPaymentPlan([fixed(50), remainder], 120);
    assert.ok(plan.ok); assert.equal(plan.rows[1].amount, 70);
    assert.equal(budgetPlanLedgerError(plan.rows.map((row, n) => ({ slot: `installment:${n + 1}`, amount: row.amount })), existing), null);
  }
});
test("services and existing rentals retain their arithmetic without inferred conversion", () => {
  assert.equal(budgetUsesDays({ days: 1 }), false);
  assert.equal(budgetUsesDays({ days: 3 }), true);
  assert.equal(budgetUsesDays({ days: 1, inventoryId: "rental" }), true);
  assert.equal(budgetItemError({ name: "Service", quantity: 2, days: 1, unitPrice: 100, costPrice: 0 }), null);
  assert.ok(budgetItemError({ name: "Service", quantity: 0, days: 1, unitPrice: 100, costPrice: 0 }));
  assert.ok(budgetItemError({ name: "Rental", quantity: 9999, days: 9999, unitPrice: 100, costPrice: 0 }));
});
test("split balances retain their aggregate without sync restoring the original part", () => {
  const split = [{ slot: "installment:1", amount: 20, paidAmount: 10, status: "PARTIAL", label: "Reserva · parte 1/2" }, { slot: "split:abc", amount: 30, status: "AWAITING", label: "Reserva · parte 2/2" }];
  assert.equal(budgetPlanLedgerError([{ slot: "installment:1", amount: 50 }], split), null);
  assert.ok(budgetPlanLedgerError([{ slot: "installment:1", amount: 70 }], split));
});
test("B1 provisional selection evaluates the canonical plan without changing the offer", () => {
  const raw = [percent(30), fixed(200000), remainder];
  const original = resolveBudgetPaymentPlan(raw, 1000001);
  assert.ok(original.ok); assert.deepEqual(original.rows.map((row) => row.amount), [300000, 200000, 500001]);
  const serialized = JSON.stringify(original.rows);
  const preview = resolveBudgetPaymentPlan(original.rows, 400001);
  assert.ok(preview.ok); assert.deepEqual(preview.rows.map((row) => row.amount), [120000, 200000, 80001]);
  assert.equal(preview.assigned, 400001); assert.equal(JSON.stringify(original.rows), serialized);
  const invalid = resolveBudgetPaymentPlan(original.rows, 100001);
  assert.equal(invalid.ok, false); assert.equal(JSON.stringify(original.rows), serialized);
});
