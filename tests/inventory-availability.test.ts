import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentIsActiveNow, type AssignmentRecord } from "../lib/server/inventory-availability";

/**
 * Regla de la disponibilidad de hoy (issue #62): qué asignaciones comprometen
 * unidades ahora. La usan la lista de inventario y su selector, así que el
 * número de «Libres ahora» de la columna y del selector tiene que salir de acá.
 */

const now = new Date("2026-09-23T15:00:00.000Z");
const at = (iso: string) => new Date(iso);

const event = {
  id: "e1",
  name: "Expo",
  startsAt: at("2026-09-23T12:00:00.000Z"),
  endsAt: at("2026-09-25T12:00:00.000Z"),
  setupAt: null,
  strikeAt: null,
};

function row(overrides: Partial<AssignmentRecord> & { checkedIn?: boolean; checkedInAt?: Date | null } = {}) {
  return {
    id: "a1",
    inventoryId: "i1",
    quantity: 2,
    startsAt: null,
    endsAt: null,
    checkedIn: false,
    checkedInAt: null,
    event,
    ...overrides,
  };
}

test("compromete si el rango efectivo incluye ahora (propio o del evento)", () => {
  assert.equal(assignmentIsActiveNow(row(), now), true, "sin fechas propias: usa el rango del evento, en curso");
  assert.equal(
    assignmentIsActiveNow(row({ startsAt: at("2026-09-22T08:00:00.000Z"), endsAt: at("2026-09-24T08:00:00.000Z") }), now),
    true,
    "rango propio en curso",
  );
  assert.equal(
    assignmentIsActiveNow(row({ startsAt: null, endsAt: null, event: { ...event, startsAt: at("2026-09-20T12:00:00.000Z"), endsAt: at("2026-09-21T12:00:00.000Z") } }), now),
    false,
    "rango del evento ya pasado",
  );
  assert.equal(
    assignmentIsActiveNow(row({ event: { ...event, startsAt: at("2026-09-24T12:00:00.000Z"), endsAt: at("2026-09-26T12:00:00.000Z") } }), now),
    false,
    "rango del evento futuro",
  );
  assert.equal(
    assignmentIsActiveNow(row({ startsAt: at("2026-09-20T08:00:00.000Z"), endsAt: at("2026-09-21T08:00:00.000Z") }), now),
    false,
    "rango propio pasado: pisa al del evento",
  );
});

test("devuelta no compromete y sin fechas en ninguno de los dos ocupa siempre", () => {
  assert.equal(assignmentIsActiveNow(row({ checkedIn: true }), now), false, "devuelta");
  assert.equal(assignmentIsActiveNow(row({ checkedInAt: at("2026-09-23T10:00:00.000Z") }), now), false, "con fecha de devolución");
  assert.equal(
    assignmentIsActiveNow(
      row({ event: { ...event, startsAt: null, endsAt: null, setupAt: null, strikeAt: null } }),
      now,
    ),
    true,
    "sin fechas en ninguno: ocupa siempre",
  );
});
