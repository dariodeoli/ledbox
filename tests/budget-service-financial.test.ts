import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBudgetServiceFinancial, type ServiceFinancialInput, type RecognizedCostContribution } from "../lib/budget-service-financial";
import { BUDGET_INT_MAX } from "../lib/budget-payment-plan";
import type { CommercialLine } from "../lib/budget-commercial-calculation";

const service = (patch: Partial<ServiceFinancialInput> = {}): ServiceFinancialInput => ({
  id: "service", sortOrder: 1, serviceClass: "GUARD", inclusion: "INCLUDED_CHARGED",
  floorApplicability: "CHARGED_ONLY", taxType: "IVA10", modality: "PERSON_DAY",
  people: 2, serviceDays: 3, contextualServiceDays: null,
  tariff: { front: "WHOLESALE", normalPrice: 80001, fromDays: 3, fromPrice: 70001, minimumPrice: 10000 },
  overridePrice: null, discountMode: null, discountValue: null, costComplete: true,
  ...patch,
});
const fixture = (services = [service()], contributions: RecognizedCostContribution[] = []) => ({
  services, contributions, equipment: [], taxType: "IVA10" as const,
  terms: { discountMode: null, discountValue: null, advancePercentBps: null },
  legacyDiscount: 0, fixedAdvance: 0,
});
const obligation = (patch: Partial<RecognizedCostContribution> = {}): RecognizedCostContribution => ({
  sourceId: "obligation-1", scopeId: "execution-1", incurred: 10000, pending: 20000,
  allocations: [{ componentId: "service", incurred: 10000, pending: 20000 }], ...patch,
});

test("own service days select conserved wholesale tier, BigInt person-day charge and included IVA", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = calculateBudgetServiceFinancial(input);
  assert.equal(result.commercial.total, 420006);
  assert.equal(result.commercial.items[0].floor, 60000);
  assert.equal(result.items[0].taxable + result.items[0].taxAmount, 420006);
  assert.deepEqual(input, before, "adapter must not mutate the snapshot or cost inputs");
});

test("fixed transport/install use contextual days only as selector, never multiply by coverage or days", () => {
  for (const serviceClass of ["TRANSPORT", "INSTALLATION"] as const) {
    const result = calculateBudgetServiceFinancial(fixture([service({
      serviceClass, modality: "FIXED_EVENT", people: null, serviceDays: null, contextualServiceDays: 7,
    })]));
    assert.equal(result.commercial.total, 70001);
    assert.equal(result.commercial.items[0].floor, 10000);
    assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ serviceClass })])), /fijo/);
  }
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({
    modality: "FIXED_EVENT", people: null, serviceDays: null, contextualServiceDays: null,
  })])), /contextuales/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ modality: "FIXED_EVENT" })])), /nulos/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ contextualServiceDays: 3 })])), /brazo fijo/);
});

test("override stays per person-day, retains floor and does not invent missing tariff", () => {
  const missing = { front: "FINAL" as const, normalPrice: null, fromDays: null, fromPrice: null, minimumPrice: 100 };
  const input = fixture([service({ tariff: missing, overridePrice: 150 })]);
  assert.equal(calculateBudgetServiceFinancial(input).commercial.total, 900);
  assert.equal(input.services[0].tariff.normalPrice, null);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ tariff: missing })])), /precio y mínimo/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ tariff: { ...missing, minimumPrice: null }, overridePrice: 150 })])), /mínimo/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ tariff: missing, overridePrice: 99 })])), /piso/);
  assert.equal(calculateBudgetServiceFinancial(fixture([service({
    tariff: { ...missing, normalPrice: 0, minimumPrice: 0 },
  })])).commercial.total, 0, "explicit zero differs from absent price/floor");
});

test("ternary inclusion excludes free/not included sales and floor enforcement, preserving known costs and snapshot", () => {
  for (const inclusion of ["INCLUDED_FREE", "NOT_INCLUDED"] as const) {
    const input = fixture([service({ inclusion })], [obligation()]);
    const result = calculateBudgetServiceFinancial(input);
    assert.equal(result.commercial.total, 0);
    assert.equal(result.knownCost, 30000);
    assert.equal(result.margin, -30000);
    assert.equal(result.marginPercent, null);
    assert.equal(input.services[0].tariff.minimumPrice, 10000);
    assert.equal(result.commercial.items[0].globalDiscountAmount, 0);
  }
  const free = service({ inclusion: "INCLUDED_FREE", overridePrice: 1 });
  calculateBudgetServiceFinancial(fixture([free]));
  assert.throws(() => calculateBudgetServiceFinancial(fixture([{ ...free, inclusion: "INCLUDED_CHARGED" }])), /piso/);
});

test("incurred plus remaining commitment is 30000, transfer to incurred preserves effective cost", () => {
  const first = calculateBudgetServiceFinancial(fixture(undefined, [obligation()]));
  const second = calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    incurred: 30000, pending: 0, allocations: [{ componentId: "service", incurred: 30000, pending: 0 }],
  })]));
  assert.equal(first.effectiveCost, 30000);
  assert.equal(second.effectiveCost, 30000);
  assert.equal(first.margin, second.margin);
});

test("unknown pending preserves incurred as partial, unknown margin differs from accredited zero", () => {
  const result = calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    pending: null, allocations: [{ componentId: "service", incurred: 10000, pending: null }],
  })]));
  assert.equal(result.knownCost, 10000);
  assert.equal(result.effectiveCost, null);
  assert.equal(result.margin, null);
  assert.equal(result.items[0].marginPercent, null);
  assert.equal(calculateBudgetServiceFinancial(fixture([service({ costComplete: false })])).effectiveCost, null);
  assert.equal(calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    incurred: 0, pending: 0, allocations: [{ componentId: "service", incurred: 0, pending: 0 }],
  })])).effectiveCost, 0);
  assert.equal(calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    allocations: [{ componentId: "service", incurred: 5000, pending: 20000 }],
  })])).effectiveCost, null, "unassigned recognized remainder cannot disappear from complete margin");
});

test("unique obligation/scope allocations reject double count and over-assignment", () => {
  assert.throws(() => calculateBudgetServiceFinancial(fixture(undefined, [obligation(), obligation()])), /dos veces/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    allocations: [{ componentId: "service", incurred: 10001, pending: 20000 }],
  })])), /superan/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    allocations: [obligation().allocations[0], obligation().allocations[0]],
  })])), /repetida/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture(undefined, [obligation({
    allocations: [{ componentId: "foreign", incurred: 10000, pending: 20000 }],
  })])), /desconocida/);
});

const equipment: CommercialLine = {
  id: "equipment", sortOrder: 0, quantity: 1, days: 1, unitPrice: 100,
  minimumPrice: 0, priceMode: "MANUAL", tariffSnapshot: null,
  discountMode: null, discountValue: null, discountAmount: null,
};

test("equipment and services share one largest-remainder allocator and one obligation, no laborCost copy", () => {
  const input = {
    ...fixture([service({ people: 1, serviceDays: 1, tariff: { front: "FINAL" as const, normalPrice: 100, fromDays: null, fromPrice: null, minimumPrice: 0 } })], [obligation({
      allocations: [
        { componentId: "equipment", incurred: 4000, pending: 8000 },
        { componentId: "service", incurred: 6000, pending: 12000 },
      ],
    })]),
    equipment: [{ line: equipment, taxType: "IVA10" as const, costComplete: true }],
    terms: { discountMode: "AMOUNT" as const, discountValue: 1, advancePercentBps: 3000 },
  };
  const result = calculateBudgetServiceFinancial(input);
  assert.deepEqual(result.commercial.items.map((item) => item.globalDiscountAmount), [1, 0]);
  assert.equal(result.commercial.total, 199);
  assert.equal(result.commercial.advanceAmount, 60);
  assert.equal(result.effectiveCost, 30000);
  assert.deepEqual(result.items.map((item) => item.knownCost), [12000, 18000]);
});

test("line and global discounts reject entire below-floor deal; fixed advance rejects above total", () => {
  const item = service({ people: 1, serviceDays: 1, tariff: { front: "FINAL", normalPrice: 100, fromDays: null, fromPrice: null, minimumPrice: 90 } });
  assert.throws(() => calculateBudgetServiceFinancial(fixture([{ ...item, discountMode: "AMOUNT", discountValue: 11 }])), /piso/);
  assert.throws(() => calculateBudgetServiceFinancial({ ...fixture([item]), terms: { discountMode: "AMOUNT", discountValue: 11, advancePercentBps: null } }), /piso/);
  assert.throws(() => calculateBudgetServiceFinancial({ ...fixture([item]), fixedAdvance: 101 }), /seña/);
  assert.throws(() => calculateBudgetServiceFinancial({ ...fixture([item]), terms: { discountMode: "AMOUNT", discountValue: 101, advancePercentBps: null } }), /descuento fijo/);
});

test("525 BPS local discount then global discount use only charged net components", () => {
  const charged = service({ people: 1, serviceDays: 1, overridePrice: 10000,
    tariff: { front: "FINAL", normalPrice: 10000, fromDays: null, fromPrice: null, minimumPrice: 0 },
    discountMode: "PERCENT", discountValue: 525,
  });
  const result = calculateBudgetServiceFinancial({
    ...fixture([charged, { ...charged, id: "free", inclusion: "INCLUDED_FREE" }]),
    terms: { discountMode: "PERCENT", discountValue: 525, advancePercentBps: 3000 },
  });
  assert.equal(result.commercial.subtotal, 9475);
  assert.equal(result.commercial.discount, 497);
  assert.equal(result.commercial.total, 8978);
  assert.equal(result.commercial.advanceAmount, 2693);
  assert.equal(result.commercial.items[1].globalDiscountAmount, 0);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([charged, charged])), /repetido/);
});

test("BigInt guards product, aggregate sales, recognized costs and numeric limits before materialization", () => {
  const max = service({ people: 1, serviceDays: 1, overridePrice: BUDGET_INT_MAX });
  assert.equal(calculateBudgetServiceFinancial(fixture([max])).commercial.total, BUDGET_INT_MAX);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([{ ...max, people: 2 }])), /límite Int/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([max, { ...max, id: "other" }])), /límite Int/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture(undefined, [obligation({ incurred: BUDGET_INT_MAX, pending: 1 })])), /límite Int/);
  for (const people of [0, 10000, 1.5, Number.NaN]) assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ people })])), /9999/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ overridePrice: BUDGET_INT_MAX + 1 })])), /Int/);
});

test("explicit homogeneous IVA is required even for free components; fiscal totals conserve negotiated gross", () => {
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ taxType: "IVA5" })])), /homogéneo/);
  assert.throws(() => calculateBudgetServiceFinancial(fixture([service({ inclusion: "INCLUDED_FREE", taxType: "EXEMPT" })])), /homogéneo/);
  for (const taxType of ["IVA10", "IVA5", "EXEMPT"] as const) {
    const result = calculateBudgetServiceFinancial({ ...fixture([service({ taxType })]), taxType });
    assert.equal(result.items.reduce((sum, item) => sum + item.taxable + item.taxAmount, 0), result.commercial.total);
  }
});
