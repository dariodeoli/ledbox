import assert from "node:assert/strict";
import { test } from "node:test";
import { closureBlockMessage, dispatchedQuantity, pendingReturnQuantity } from "../lib/server/inventory-operations";
import { inventoryAssignmentState } from "../lib/admin-format";

const base = { quantity: 10, checkedOut: false, checkedOutAt: null, checkedIn: false, checkedInAt: null, checkoutQuantity: 0, returnedQuantity: 0, missingQuantity: 0 };

test("pendientes de devolución: parcial, faltantes y filas viejas", () => {
  assert.equal(pendingReturnQuantity(base), 0, "nada salió");
  assert.equal(pendingReturnQuantity({ ...base, checkedOut: true }), 10, "fila vieja: salió toda la asignación");
  assert.equal(pendingReturnQuantity({ ...base, checkedOut: true, checkoutQuantity: 6, returnedQuantity: 2, missingQuantity: 1 }), 3);
  assert.equal(pendingReturnQuantity({ ...base, checkedOut: true, checkedIn: true }), 0, "cerrada");
  assert.equal(dispatchedQuantity({ ...base, checkoutQuantity: 4, checkedOut: true }), 4);
});

test("mensaje de cierre del evento", () => {
  assert.equal(closureBlockMessage({ pendingReturns: [], openMissing: [] }), null);
  const message = closureBlockMessage({
    pendingReturns: [{ assignmentId: "a", inventoryId: "i", name: "Silla", pending: 3 }],
    openMissing: [{ incidentId: "m", inventoryId: "j", name: "Mesa", quantity: 1 }],
  });
  assert.match(message!, /faltan devolver 3 de «Silla»/);
  assert.match(message!, /1 de «Mesa»/);
});

test("estado de la asignación: devolución parcial visible", () => {
  assert.deepEqual(inventoryAssignmentState({ checkedOut: true, checkedIn: false, quantity: 10, checkoutQuantity: 10, returnedQuantity: 7 }), { label: "Faltan 3 por devolver", tone: "warn" });
  assert.equal(inventoryAssignmentState({ checkedOut: true, checkedIn: false }).label, "Afuera");
  assert.equal(inventoryAssignmentState({ checkedOut: true, checkedIn: false, quantity: 10, checkoutQuantity: 6 }).label, "Salida parcial (6 de 10)");
  assert.equal(inventoryAssignmentState({ checkedOut: true, checkedIn: true }).label, "Devuelto");
});
