import assert from "node:assert/strict";
import { test } from "node:test";
import { collectedAmount, receivedAmount } from "../lib/admin-types";
import { countsTowardBudgetBalance, rentalBalancePaymentFilter } from "../lib/payment-origin";

test("la garantía retenida y los cargos extra no bajan el saldo; la de reserva y los cobros comunes sí", () => {
  assert.equal(countsTowardBudgetBalance({}), true);
  assert.equal(countsTowardBudgetBalance({ origin: null }), true);
  assert.equal(countsTowardBudgetBalance({ origin: "deposit_reserve" }), true);
  assert.equal(countsTowardBudgetBalance({ origin: "deposit_retained" }), false);
  assert.equal(countsTowardBudgetBalance({ origin: "rental_extra" }), false);
});

test("collectedAmount deja afuera lo que no es del alquiler y receivedAmount lo cuenta como ingreso", () => {
  const payments = [
    { amount: 500_000, status: "RECEIVED" },
    { amount: 300_000, status: "RECEIVED", origin: "deposit_reserve" },
    { amount: 200_000, status: "RECEIVED", origin: "deposit_retained" },
    { amount: 80_000, status: "RECEIVED", origin: "rental_extra" },
    { amount: 999, status: "PENDING" },
    { amount: 700_000, status: "CANCELLED" },
  ];
  assert.equal(collectedAmount(payments), 800_000);
  assert.equal(receivedAmount(payments), 1_080_000);
});

test("el filtro de Prisma conserva los cobros sin origen (NULL) explícitamente", () => {
  const [group] = rentalBalancePaymentFilter.AND;
  assert.deepEqual(group.OR[0], { origin: null });
  assert.deepEqual(group.OR[1], { origin: { notIn: ["deposit_retained", "rental_extra"] } });
});
