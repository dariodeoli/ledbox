import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountError,
  amountInput,
  amountValid,
  digitsOnly,
  emailError,
  emailValid,
  FIELD_LIMITS,
  FIELD_MESSAGES,
  formatPercent,
  normalizeEmail,
  normalizePhone,
  normalizeSerial,
  parseAmount,
  parsePercent,
  parsePhone,
  percentError,
  percentInput,
  percentValid,
  phoneError,
  phoneValid,
  requiredError,
  serialError,
  serialValid,
} from "../lib/field-rules";

test("digitsOnly limpia todo lo que no sea dígito", () => {
  assert.equal(digitsOnly("+595 981-000.000"), "595981000000");
  assert.equal(digitsOnly("abc"), "");
});

test("monto PYG: tolera pegado con símbolo y separadores y entrega entero limpio", () => {
  assert.equal(amountInput("Gs 1.500.000"), "1500000");
  assert.equal(amountInput(" 2 000 000 "), "2000000");
  assert.equal(amountInput("007"), "7");
  assert.equal(parseAmount("1.500.000"), 1500000);
  assert.equal(parseAmount(""), null);
  assert.equal(amountValid("1.500.000"), true);
  assert.equal(amountValid("10.000.000.001", FIELD_LIMITS.amountGeneral), false);
  assert.equal(amountValid("99.000.000.000", FIELD_LIMITS.amountSales), true);
  assert.equal(amountError("1.500.000"), null);
  assert.equal(amountError("no"), FIELD_MESSAGES.amount);
  assert.equal(amountError("20.000.000.000", FIELD_LIMITS.amountGeneral), FIELD_MESSAGES.amountLimit);
});

test("porcentaje: coma decimal, 0–100 y hasta 2 decimales", () => {
  assert.equal(percentInput("12,5"), "12.5");
  assert.equal(percentInput("12,345"), "12.34");
  assert.equal(percentInput("abc10%"), "10");
  assert.equal(percentInput("0,50"), "0.50");
  assert.equal(parsePercent("12,5"), 12.5);
  assert.equal(parsePercent("100"), 100);
  assert.equal(parsePercent("101"), null);
  assert.equal(parsePercent(""), null);
  assert.equal(percentValid("99,99"), true);
  assert.equal(percentError("120"), FIELD_MESSAGES.percent);
  assert.equal(formatPercent(12.5), "12,5");
  assert.equal(formatPercent(null), "—");
});

test("correo: se guarda en minúsculas y valida hasta 200 caracteres", () => {
  assert.equal(normalizeEmail("  Ana@LedBox.Online  "), "ana@ledbox.online");
  assert.equal(emailValid("ana@ledbox.online"), true);
  assert.equal(emailValid("ana@ledbox"), false);
  assert.equal(emailValid(`${"a".repeat(FIELD_LIMITS.email)}@ledbox.online`), false);
  assert.equal(emailError("no-es-correo"), FIELD_MESSAGES.email);
  assert.equal(emailError("ana@ledbox.online"), null);
});

test("serial: mayúsculas, sin espacios ni símbolos raros", () => {
  assert.equal(normalizeSerial("  sn-123 456  "), "SN-123456");
  assert.equal(normalizeSerial("a:b;c"), "ABC");
  assert.equal(serialValid("SN-123456"), true);
  assert.equal(serialValid("A"), false);
  assert.equal(serialError("··"), FIELD_MESSAGES.serial);
});

test("teléfono: default +595, se guarda normalizado y valida largo local", () => {
  assert.deepEqual(parsePhone("+595 981 000 000"), { countryCode: "595", national: "981000000" });
  assert.deepEqual(parsePhone("0981 000 000"), { countryCode: "595", national: "0981000000" });
  assert.equal(normalizePhone("+595 981 000 000"), "+595 981000000");
  assert.equal(normalizePhone("981-000-000"), "+595 981000000");
  assert.equal(normalizePhone("(021) 234-5678"), "+595 0212345678");
  assert.equal(normalizePhone("+54 9 11 1234 5678"), "+54 91112345678");
  assert.equal(normalizePhone(""), "");
  assert.equal(phoneValid("+595 981000000"), true);
  assert.equal(phoneValid("+595 0212345678"), true);
  assert.equal(phoneValid("+595 123"), false);
  assert.equal(phoneValid("+54 91112345678"), true);
  assert.equal(phoneError("+595 123"), FIELD_MESSAGES.phone);
  assert.equal(phoneError("+595 981000000"), null);
});

test("obligatorio: un solo mensaje", () => {
  assert.equal(requiredError(""), FIELD_MESSAGES.required);
  assert.equal(requiredError("  "), FIELD_MESSAGES.required);
  assert.equal(requiredError("ok"), null);
});
