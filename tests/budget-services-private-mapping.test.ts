import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeServiceCostContributions, toServiceFinancialInput, validateBudgetServiceMutation } from "../lib/server/budget-service-contract";

const snapshot = { version: 1, front: "FINAL", mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", normalPrice: 100, fromDays: 0, fromPrice: 50, minimumPrice: 10 };
const app = { id: "service", organizationId: "org", budgetId: "budget", configurationId: "config", kind: "TRANSPORT", scope: "SHARED_EXECUTION", parentLineId: null, executionId: "execution", sortOrder: 1, publicName: "Traslado", inclusion: "INCLUDED_CHARGED", reviewState: "RESOLVED", mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", people: null, serviceDays: null, contextualServiceDays: null, front: "FINAL", tariffSnapshot: snapshot, priceSource: "TARIFF", overridePrice: null, floorApplicability: "CHARGED_ONLY", ivaType: "GRAVADA_10", discountMode: null, discountValue: null, sourceRevision: 1 };
const binding = { organizationId: "org", budgetId: "budget", configuration: { id: "config", organizationId: "org", kind: "TRANSPORT" }, executions: [{ id: "execution", organizationId: "org", budgetId: "budget" }], lines: [{ id: "item", organizationId: "org", budgetId: "budget", excluded: false }] };
const coverage = [{ id: "coverage", organizationId: "org", budgetId: "budget", applicationId: "service", parentLineId: "item", active: true, removedAt: null }];
const source = { id: "source", organizationId: "org", budgetId: "budget", sourceKind: "SERVICE", sourceKey: "obligation", supplierJobId: null, aggregationOwner: "SERVICE", executionState: "PARTIAL", incurredAmount: 100, pendingAmount: 200, incurredComplete: true, pendingComplete: false };
const allocation = { id: "allocation", organizationId: "org", budgetId: "budget", sourceId: "source", applicationId: "service", budgetItemId: null, incurredAmount: 100, pendingAmount: 200, incurredComplete: true, pendingComplete: false };
const costContext = { organizationId: "org", budgetId: "budget", applicationIds: ["service"], budgetItemIds: [], zeroCostConfirmedIds: [], legacyCostsReconciled: true };

test("native descriptor disables explicit zero threshold without mutating persisted snapshot", () => {
  const input = toServiceFinancialInput(app, "GRAVADA_10", false);
  assert.equal(input.tariff.fromDays, null);
  assert.equal(input.tariff.fromPrice, null);
  assert.equal(snapshot.fromDays, 0);
  assert.equal(snapshot.fromPrice, 50);
  assert.equal(input.taxType, "IVA10");
  assert.equal(input.modality, "FIXED_EVENT");
  assert.equal(input.people, null);
});

test("unknown tariff threshold and unknown/mixed taxes cannot satisfy materialization", () => {
  assert.throws(() => toServiceFinancialInput({ ...app, tariffSnapshot: { ...snapshot, fromDays: null } }, "GRAVADA_10", false));
  assert.throws(() => toServiceFinancialInput(app, "GRAVADA_5", false));
  assert.throws(() => toServiceFinancialInput({ ...app, inclusion: "NOT_INCLUDED", ivaType: null }, null, false));
  assert.throws(() => toServiceFinancialInput({ ...app, reviewState: "NEEDS_REVIEW" }, "GRAVADA_10", false));
});

test("inactive historical override is not applied to tariff descriptor", () => {
  assert.equal(toServiceFinancialInput({ ...app, overridePrice: 500 }, "GRAVADA_10", false).overridePrice, null);
});

test("VIEWER and demo cannot mutate, FINANCE can after actual scoped binding", () => {
  assert.throws(() => validateBudgetServiceMutation(app, coverage, { ...binding, role: "VIEWER", demo: false }));
  assert.throws(() => validateBudgetServiceMutation(app, coverage, { ...binding, role: "OWNER", demo: true }));
  assert.equal(validateBudgetServiceMutation(app, coverage, { ...binding, role: "FINANCE", demo: false }).app.id, "service");
  assert.throws(() => validateBudgetServiceMutation(app, coverage, { ...binding, organizationId: "other", role: "OWNER", demo: false }));
});

test("partial recognized cost remains complete=false even if balances are allocated", () => {
  const mapped = normalizeServiceCostContributions([source], [allocation], costContext);
  assert.equal(mapped.costCompleteById.service, false);
  assert.deepEqual(mapped.contributions[0].allocations[0], { componentId: "service", incurred: 100, pending: 200 });
  assert.equal(mapped.contributions[0].scopeId, "budget");
});

test("zero cost requires evidence; unassigned source conservatively blocks complete margins", () => {
  assert.equal(normalizeServiceCostContributions([], [], costContext).costCompleteById.service, false);
  assert.equal(normalizeServiceCostContributions([], [], { ...costContext, zeroCostConfirmedIds: ["service"] }).costCompleteById.service, true);
  const unassigned = normalizeServiceCostContributions([source], [], { ...costContext, zeroCostConfirmedIds: ["service"] });
  assert.equal(unassigned.costCompleteById.service, false);
  assert.deepEqual(unassigned.unassignedSourceIds, ["source"]);
});

test("source/assignment partial flags and recognized residue independently block complete cost", () => {
  const fullSource = { ...source, incurredComplete: true, pendingComplete: true };
  const fullAllocation = { ...allocation, incurredComplete: true, pendingComplete: true };
  assert.equal(normalizeServiceCostContributions([fullSource], [fullAllocation], costContext).costCompleteById.service, true);
  for (const [s, a] of [[{ ...fullSource, pendingComplete: false }, fullAllocation],
    [fullSource, { ...fullAllocation, incurredComplete: false }], [fullSource, { ...fullAllocation, incurredAmount: 50 }]]) {
    const mapped = normalizeServiceCostContributions([s], [a], costContext);
    assert.equal(mapped.costCompleteById.service, false);
    assert.equal(mapped.contributions[0].incurred, 100);
    assert.equal(mapped.contributions[0].pending, 200);
  }
  assert.equal(normalizeServiceCostContributions([fullSource], [fullAllocation], { ...costContext, legacyCostsReconciled: false }).costCompleteById.service, false);
});

test("one legacy obligation maps once with two explicit typed component allocations", () => {
  const mapped = normalizeServiceCostContributions([{ ...source, sourceKind: "LABOR", aggregationOwner: "LABOR", pendingComplete: true }],
    [{ ...allocation, incurredAmount: 40, pendingAmount: 80, pendingComplete: true },
      { ...allocation, id: "equipment-allocation", applicationId: null, budgetItemId: "equipment", incurredAmount: 60, pendingAmount: 120, pendingComplete: true }],
    { ...costContext, budgetItemIds: ["equipment"] });
  assert.equal(mapped.contributions.length, 1);
  assert.equal(mapped.contributions[0].allocations.length, 2);
  assert.deepEqual(mapped.contributions[0].allocations.map(row => row.componentId), ["service", "equipment"]);
  assert.equal(mapped.costCompleteById.service, true);
  assert.equal(mapped.costCompleteById.equipment, true);
});
