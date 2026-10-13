import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBusinessHours,
  availabilityHint,
  estimatedSubtotal,
  isQuoteRequestStatus,
  preorderWhatsappMessage,
  preorderWhatsappUrl,
  referenceDailyPrice,
  rentalDaysBetween,
} from "../lib/catalog-public";
import { depositPlan } from "../lib/server/catalog-convert";

test("la disponibilidad pública nunca es un número: solo tres pistas", () => {
  assert.equal(availabilityHint({ available: 10, total: 20, blocked: false }), "AVAILABLE");
  assert.equal(availabilityHint({ available: 2, total: 20, blocked: false }), "LOW");
  assert.equal(availabilityHint({ available: 5, total: 20, blocked: false }), "LOW");
  assert.equal(availabilityHint({ available: 0, total: 20, blocked: false }), "CONSULT");
  assert.equal(availabilityHint({ available: 9, total: 9, blocked: true }), "CONSULT");
  assert.equal(availabilityHint({ available: 3, total: 40, blocked: false, requested: 4 }), "CONSULT");
});

test("estados de pedido válidos", () => {
  for (const s of ["NEW", "REVIEWING", "QUOTED", "CONVERTED", "DECLINED", "EXPIRED"]) assert.ok(isQuoteRequestStatus(s));
  assert.equal(isQuoteRequestStatus("OPEN"), false);
});

test("24 h hábiles saltean el fin de semana", () => {
  // Viernes 2031-01-03 15:00 Asunción (UTC-3) = 18:00Z → vence el lunes 15:00 Asunción.
  const friday = new Date("2031-01-03T18:00:00Z");
  assert.equal(addBusinessHours(friday, 24).toISOString(), "2031-01-06T18:00:00.000Z");
  // Martes 10:00 → miércoles 10:00.
  assert.equal(addBusinessHours(new Date("2031-01-07T13:00:00Z"), 24).toISOString(), "2031-01-08T13:00:00.000Z");
});

test("días de alquiler inclusivos y precio de referencia sin inventar", () => {
  assert.equal(rentalDaysBetween("2031-01-10", "2031-01-10"), 1);
  assert.equal(rentalDaysBetween("2031-01-10", "2031-01-12"), 3);
  const item = { listPrice: 100_000, listFromDays: 3, listFromPrice: 80_000 };
  assert.equal(referenceDailyPrice(item, 2), 100_000);
  assert.equal(referenceDailyPrice(item, 3), 80_000);
  assert.equal(referenceDailyPrice({ listPrice: 0, listFromDays: 0, listFromPrice: 0 }, 1), 0);
  assert.equal(estimatedSubtotal([{ name: "A", quantity: 2, unitPrice: 100_000 }], 3), 600_000);
  assert.equal(estimatedSubtotal([{ name: "A", quantity: 2, unitPrice: 100_000 }, { name: "B", quantity: 1, unitPrice: null }], 3), null);
});

test("el resumen de WhatsApp lleva el pedido y usa el número de la empresa", () => {
  const message = preorderWhatsappMessage({ organizationName: "Acme", lines: [{ name: "Tótem", quantity: 2, unitPrice: 1 }], fromKey: "2031-01-10", toKey: "2031-01-11", location: "Asunción", name: "Ana", subtotal: 4_000_000, trackingUrl: "https://x.test/pedido/abc" });
  assert.match(message, /2 × Tótem/);
  assert.match(message, /4\.000\.000/);
  const url = preorderWhatsappUrl("+595 981 123 456", message);
  assert.ok(url?.startsWith("https://wa.me/595981123456?text="));
  assert.equal(preorderWhatsappUrl(null, message), null);
});

test("la seña sale del porcentaje de la empresa y sin política no hay seña", () => {
  const fifty = depositPlan(50, 1_000_001);
  assert.equal(fifty.amount, 500_001, "50 % redondea con el plan de pagos existente");
  assert.ok(Array.isArray(fifty.installments));
  const none = depositPlan(null, 1_000_000);
  assert.equal(none.amount, 0);
  assert.equal(none.advanceAmount, 0);
  assert.equal(depositPlan(0, 1_000_000).amount, 0);
});
