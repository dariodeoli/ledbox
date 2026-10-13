import assert from "node:assert/strict";
import { test } from "node:test";
import { plannedMovementVisible, truncateMovements } from "../lib/calendar-movements";

const now = new Date("2032-01-20T12:00:00Z");
const past = new Date("2032-01-10T12:00:00Z");
const future = new Date("2032-02-10T12:00:00Z");

test("un evento cancelado o completado no genera movimientos previstos vencidos", () => {
  assert.equal(plannedMovementVisible({ eventStatus: "CANCELLED", sent: 0, eventEnd: future, now }), false);
  assert.equal(plannedMovementVisible({ eventStatus: "COMPLETED", sent: 3, eventEnd: past, now }), false);
});

test("una asignación nunca despachada de un evento pasado no se muestra; la despachada sí", () => {
  assert.equal(plannedMovementVisible({ eventStatus: "CONFIRMED", sent: 0, eventEnd: past, now }), false);
  assert.equal(plannedMovementVisible({ eventStatus: "CONFIRMED", sent: 2, eventEnd: past, now }), true);
  assert.equal(plannedMovementVisible({ eventStatus: "CONFIRMED", sent: 0, eventEnd: future, now }), true);
});

test("truncateMovements avisa cuando el tope recorta", () => {
  assert.deepEqual(truncateMovements([1, 2, 3], 3), { rows: [1, 2, 3], truncated: false });
  assert.deepEqual(truncateMovements([1, 2, 3, 4], 3), { rows: [1, 2, 3], truncated: true });
});
