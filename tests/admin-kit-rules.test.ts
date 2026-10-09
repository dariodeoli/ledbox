import assert from "node:assert/strict";
import { test } from "node:test";
import { limpiarPercent } from "owncoding-ui";
import { amountInput, FIELD_LIMITS, moneyInputDisplay, percentInput } from "../lib/field-rules";

test("la representación monetaria conserva dígitos fuera de Int y fuera de Number seguro", () => {
  assert.equal(FIELD_LIMITS.amountStorage, 2147483647);
  for (const value of ["2147483647", "2147483648", "900719925474099312345"]) {
    assert.equal(moneyInputDisplay(value).replace(/\D/g, ""), value);
    assert.equal(amountInput(moneyInputDisplay(value)), value);
  }
});

test("la regla pura de porcentaje mantiene equivalencia con el campo compartido", () => {
  for (const value of ["", "0", "100", "101", "0.2", "12,50", "12.567", "a12%,,3b", "123456789", ",5"]) {
    assert.equal(percentInput(value), limpiarPercent(value), value);
  }
});
