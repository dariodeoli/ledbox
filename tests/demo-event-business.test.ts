import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDemoEventBusiness } from "../lib/server/demo-event-business";
import { buildDemoFamilies } from "../lib/server/demo-families";
import { makeSeedIds } from "../lib/server/demo-ns";
const base = new Date("2026-10-15T03:00:00Z");

test("demo alquileres: familias, combos, trazabilidad y estados físicos coherentes", () => {
  const data = buildDemoEventBusiness("org-test", base);
  const families = buildDemoFamilies("org-test", base);
  const items = [...data.inventoryItems, ...families.items];
  const units = [...data.inventoryUnits, ...families.units];
  assert.equal(data.inventoryItems.length, 14);
  assert.equal(data.clients.length, 6);
  assert.equal(data.events.length, 4);
  assert.equal(data.tasks.length, 12);
  assert.ok(data.tasks.some((task) => task.completedAt));
  assert.ok(data.tasks.some((task) => !task.completedAt));
  assert.equal(families.families.length, 4);
  assert.equal(families.items.length, 12);
  const ids = new Set(items.map((item) => item.id));
  assert.equal(ids.size, items.length);
  for (const item of items) {
    const components = data.inventoryComponents.filter((row) => row.parentId === item.id);
    const physical = units.filter((unit) => unit.inventoryId === item.id);
    if (components.length) {
      assert.equal(physical.length, 0, "el combo no inventa unidades propias");
      assert.ok(Number(item.dailyCost) > 0, "el combo incluye el costo de sus piezas");
      for (const component of components) assert.ok(ids.has(component.componentId));
    } else assert.equal(item.quantity, physical.filter((row) => row.status !== "RETIRED").length);
  }
  for (const unit of units.filter((row) => ["MAINTENANCE", "DAMAGED"].includes(String(row.status)))) {
    assert.ok(data.incidents.some((incident) => incident.unitId === unit.id && ["OPEN", "IN_REPAIR"].includes(String(incident.status))));
  }
  assert.ok(data.inventoryItems.some((item) => item.listPrice === 0 && item.visibleOnWeb));
  assert.ok(data.assignments.some((row) => row.checkedOut && !row.checkedIn));
  assert.ok(data.assignments.some((row) => row.checkedIn && row.damagedQuantity === 1));
});

test("demo alquileres: planes completos, seña real, saldo pendiente y presupuesto de revisión", () => {
  const data = buildDemoEventBusiness("org-test", base);
  for (const budget of data.budgetSeeds) {
    const total = budget.items.reduce((sum, item) => sum + item.quantity * item.days * item.unitPrice, 0) - budget.discount;
    assert.equal(budget.plan!.advance + budget.plan!.installments.reduce((sum, row) => sum + row.amount, 0), total);
    if (budget.status !== "APPROVED") {
      assert.equal(data.payments.filter((row) => row.budgetId === budget.id).length, 0);
      assert.equal(data.expectedPayments.filter((row) => row.budgetId === budget.id).length, 0);
      continue;
    }
    assert.ok(budget.event && budget.approval);
    const expected = data.expectedPayments.filter((row) => row.budgetId === budget.id);
    assert.equal(expected.reduce((sum, row) => sum + row.amount, 0), total);
    const received = data.payments.filter((row) => row.budgetId === budget.id);
    assert.equal(expected.reduce((sum, row) => sum + Number(row.paidAmount), 0), received.reduce((sum, row) => sum + row.amount, 0));
    assert.ok(expected.some((row) => row.slot === "installment:1"));
    for (const row of expected) assert.equal(Boolean(row.paymentId), row.status === "CONFIRMED");
  }
  assert.ok(data.budgetSeeds.some((row) => row.status === "NEGOTIATING" && row.revision));
});

test("demo alquileres: dos visitantes no comparten IDs ni referencias", () => {
  const seed = buildDemoEventBusiness("org-test", base);
  const first = makeSeedIds("abcdefghij").mapDeep(seed);
  const second = makeSeedIds("klmnopqrst").mapDeep(seed);
  assert.ok(!JSON.stringify(first).includes('"demo_'));
  assert.ok(!JSON.stringify(second).includes('"demo_'));
  assert.ok(first.assignments.every((row) => String(row.inventoryId).startsWith("sbx_abcdefghij_")));
  assert.equal(first.clients.some((client) => second.clients.some((other) => other.id === client.id)), false);
});
