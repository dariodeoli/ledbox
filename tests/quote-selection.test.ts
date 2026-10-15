import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveQuoteSelection, selectionSubtotal, selectionApprovalError, counterofferExclusion } from "../lib/quote-selection";

const items = [
  { id: "paid", name: "Stand", quantity: 2, days: 3, unitPrice: 1000 },
  { id: "gift", name: "Brindis", quantity: 1, days: 1, unitPrice: 0 },
];

test("exclusion preserves original terms, excludes cost from total and can be restored", () => {
  const proposal = resolveQuoteSelection(items, [{ ...items[0], unitPrice: undefined, name: undefined, excluded: true }]);
  assert.equal(proposal.ok, true);
  if (!proposal.ok) return;
  assert.equal(selectionSubtotal({ ...items[0], ...proposal.value[0] }), 0);
  assert.equal(proposal.value[0].quantity, 2);
  assert.equal(proposal.value[0].days, 3);
  assert.equal(selectionApprovalError([{ ...items[0], excluded: true }, items[1]]), null, "free active items remain valid");
  const restore = resolveQuoteSelection([{ ...items[0], excluded: true }], [{ id: "paid", quantity: 2, days: 3, excluded: false }]);
  assert.equal(restore.ok, true);
  assert.equal(selectionSubtotal(items[0]), 6000);
});

test("all excluded cannot be submitted or approved, including an unchanged free line", () => {
  const rows = items.map((item) => ({ id: item.id, quantity: item.quantity, days: item.days, excluded: true }));
  assert.equal(resolveQuoteSelection(items, rows).ok, false);
  assert.ok(selectionApprovalError(items.map((item) => ({ ...item, excluded: true }))));
});

test("reject foreign, duplicate, tampered and invalid proposals", () => {
  for (const raw of [
    [{ id: "foreign", quantity: 1, days: 1, excluded: true }],
    [{ id: "paid", quantity: 2, days: 3, excluded: true }, { id: "paid", quantity: 2, days: 3 }],
    [{ id: "paid", quantity: 0, days: 3 }],
    [{ id: "paid", quantity: 2, days: 0 }],
    [{ id: "paid", quantity: 2, days: 3, excluded: "true" }],
    [{ id: "paid", quantity: 2, days: 3, unitPrice: 1 }],
    [{ id: "paid", quantity: 2, days: 3, inventoryId: "foreign-product" }],
    [{ id: "paid", quantity: 2, days: 3, subtotal: 1 }],
    [{ id: "paid", quantity: 3, days: 3, excluded: true }],
    [{ id: "paid", quantity: 9999, days: 3 }],
    [{ id: "paid", quantity: 2, days: 366 }],
  ]) assert.equal(resolveQuoteSelection(items, raw).ok, false, JSON.stringify(raw));
});

test("pending selection and overcommitted payment plan block approval", () => {
  assert.ok(selectionApprovalError(items, true));
  assert.ok(selectionApprovalError(items, false, 7000, 6000));
  assert.equal(selectionApprovalError(items, false, 6000, 6000), null);
});

test("admin exclusion of a changed counteroffer restores original quantities and days before validation", () => {
  for (const proposed of [{ quantity: 3, days: 3 }, { quantity: 2, days: 5 }, { quantity: 3, days: 5 }]) {
    const selection = counterofferExclusion(items[0], proposed, true);
    assert.deepEqual(selection, { quantity: 2, days: 3, excluded: true });
    const accepted = resolveQuoteSelection(items, [{ id: items[0].id, ...selection }], { requireChange: false });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) continue;
    assert.equal(selectionSubtotal({ ...items[0], ...accepted.value[0] }), 0);
    assert.equal(selectionApprovalError([accepted.value[0], items[1]]), null);
    assert.deepEqual(counterofferExclusion(items[0], selection, false), { quantity: 2, days: 3, excluded: false });
    assert.deepEqual(counterofferExclusion(items[0], proposed, false), { ...proposed, excluded: false }, "included counteroffers keep their proposed terms");
  }
});

test("productos por evento: los días de la propuesta se fuerzan a 1 al validar y al leer el payload", async () => {
  const { parseProposalPayload } = await import("../lib/server/budget-portal");
  const rental = [
    { id: "evt", name: "Copa", quantity: 10, days: 1, unitPrice: 5000, inventory: { billingUnit: "EVENT" } },
    { id: "day", name: "Mesa", quantity: 2, days: 1, unitPrice: 1000, inventory: { billingUnit: "DAILY" } },
  ];
  const proposal = resolveQuoteSelection(rental, [{ id: "evt", quantity: 12, days: 5 }, { id: "day", quantity: 2, days: 4 }]);
  assert.equal(proposal.ok, true);
  if (!proposal.ok) return;
  assert.equal(proposal.value.find((row) => row.id === "evt")?.days, 1, "por evento: nunca más de un día");
  assert.equal(proposal.value.find((row) => row.id === "day")?.days, 4, "por día: respeta lo pedido");
  assert.equal(selectionSubtotal({ ...rental[0], ...proposal.value[0] }), 12 * 1 * 5000);
  // Una propuesta que solo cambia los días de un producto por evento no cambia nada.
  assert.equal(resolveQuoteSelection(rental.slice(0, 1), [{ id: "evt", quantity: 10, days: 7 }]).ok, false);
  // Payload ya guardado con días > 1: se lee con 1 al aplicar.
  const stored = { items: [{ id: "evt", quantity: 12, days: 9 }, { id: "day", quantity: 2, days: 9 }] };
  const parsed = parseProposalPayload(stored, new Set(["evt"]));
  assert.deepEqual(parsed.items.map((row) => [row.id, row.days]), [["evt", 1], ["day", 9]]);
});
