import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetCollectionStep } from "../lib/budget-collection-step";

test("EV-D03 received full amount takes precedence over stale open plan without changing money", () => {
  const expectedPayments = [{ status: "AWAITING", label: "Anticipo", concept: "advance", amount: 4000000, paidAmount: 0 }];
  const step = budgetCollectionStep({ total: 12500000, collected: 12500000, advanceAmount: 4000000, expectedPayments });
  assert.equal(step.label, "Cobro completo"); assert.equal(step.amount, 0); assert.equal(step.kind, "complete");
  assert.equal(expectedPayments[0].status, "AWAITING");
});
test("EV-D03 partial advance, subsequent installment, proof and absent plan use real remaining amounts", () => {
  const input = { total: 12500000, collected: 2000000, advanceAmount: 4000000 };
  assert.equal(budgetCollectionStep(input).amount, 2000000);
  assert.equal(budgetCollectionStep({ ...input, collected: 5000000 }).label, "Cobrar saldo");
  assert.equal(budgetCollectionStep({ ...input, collected: 0, advanceAmount: 0 }).label, "Cobrar pago");
  const expectedPayments = [{ status: "AWAITING", label: "Cuota 2", concept: "installment", amount: 5000000 }, { status: "PARTIAL", label: "Reserva", concept: "advance", amount: 4000000, paidAmount: 2000000 }];
  assert.equal(budgetCollectionStep({ ...input, expectedPayments }).amount, 2000000);
  assert.equal(budgetCollectionStep({ ...input, collected: 4000000, expectedPayments: expectedPayments.slice(0, 1) }).label, "Cobrar Cuota 2");
  assert.equal(budgetCollectionStep({ ...input, expectedPayments: [{ ...expectedPayments[0], status: "PROOF" }] }).label, "Revisar comprobante");
  assert.equal(budgetCollectionStep({ total: 0, collected: 0, advanceAmount: 0 }).label, "Sin saldo pendiente");
});
