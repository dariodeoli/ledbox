import assert from "node:assert/strict";
import { test } from "node:test";
import { adminBudgetServiceApplicationSchema, persistedBudgetServiceApplicationSchema as budgetServiceApplicationInputSchema, inventoryServiceConfigurationInputSchema,
  publicBudgetServiceTerms, publicServiceV1Schema, resolveServiceTariffSelection, serviceCostSourceSchema,
  validateServiceCompanyBinding, validateServiceCostBindings, budgetServiceMutationInputSchema,
  serviceSnapshotFromConfiguration, validateServiceSnapshotRetention } from "../lib/budget-service-contract";

const snapshot = { version: 1 as const, front: "FINAL" as const, mode: "FIXED_EVENT" as const, unit: "PYG_PER_EXECUTION" as const, normalPrice: 100, fromDays: 0, fromPrice: 50, minimumPrice: 10 };
const application = { id: "service", organizationId: "PRIVATE-company", budgetId: "budget", configurationId: "PRIVATE-config", kind: "TRANSPORT" as const,
  scope: "SHARED_EXECUTION" as const, parentLineId: null, executionId: "PRIVATE-execution", sortOrder: 1, publicName: "Traslado",
  inclusion: "INCLUDED_CHARGED" as const, reviewState: "RESOLVED" as const, mode: "FIXED_EVENT" as const, unit: "PYG_PER_EXECUTION" as const,
  people: null, serviceDays: null, contextualServiceDays: null, front: "FINAL" as const, tariffSnapshot: snapshot, priceSource: "TARIFF" as const,
  overridePrice: null, floorApplicability: "CHARGED_ONLY" as const, ivaType: "GRAVADA_10" as const, discountMode: null, discountValue: null, sourceRevision: 1 };
const coverage = [{ id: "coverage", organizationId: application.organizationId, budgetId: "budget", applicationId: "service", parentLineId: "item", active: true, removedAt: null }];
const context = { organizationId: application.organizationId, budgetId: "budget", configuration: { id: application.configurationId, organizationId: application.organizationId, kind: "TRANSPORT" },
  executions: [{ id: application.executionId, organizationId: application.organizationId, budgetId: "budget" }], lines: [{ id: "item", organizationId: application.organizationId, budgetId: "budget", excluded: false }] };
const materialized = { ...application, grossAmount: 100, discountAmount: 0, netAmount: 100, globalDiscountAmount: 0, totalAmount: 100 };
const source = { id: "source", organizationId: application.organizationId, budgetId: "budget", sourceKind: "SERVICE" as const, sourceKey: "obligation",
  supplierJobId: null, aggregationOwner: "SERVICE" as const, executionState: "PARTIAL" as const, incurredAmount: 100, pendingAmount: null, incurredComplete: false, pendingComplete: false };
const allocation = { id: "allocation", organizationId: application.organizationId, budgetId: "budget", sourceId: "source", applicationId: "service", budgetItemId: null,
  incurredAmount: 100, pendingAmount: null, incurredComplete: false, pendingComplete: false };
const costContext = { organizationId: application.organizationId, budgetId: "budget", applicationIds: ["service"], budgetItemIds: ["item"] };

test("strict input rejects company injection and simultaneous branches", () => {
  const config = { version: 1, id: null, expectedRevision: null, kind: "TRANSPORT", publicName: "Traslado", mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", minimumPrice: null, floorApplicability: "CHARGED_ONLY", ivaType: null,
    tariffsJson: { version: 1, FINAL: { normalPrice: null, fromDays: null, fromPrice: null }, WHOLESALE: { normalPrice: null, fromDays: null, fromPrice: null } } };
  assert.equal(inventoryServiceConfigurationInputSchema.safeParse(config).success, true);
  assert.equal(inventoryServiceConfigurationInputSchema.safeParse({ ...config, organizationId: "attacker" }).success, false);
  assert.equal(inventoryServiceConfigurationInputSchema.safeParse({ ...config, expectedRevision: 1 }).success, false);
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, people: 2, serviceDays: 3 }).success, false);
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, scope: "LINE", parentLineId: "item", executionId: null }).success, false);
});

test("selector distinguishes unknown and inactive zero, with X-1/X/X+1 without changing front", () => {
  const active = { ...snapshot, fromDays: 3 };
  assert.equal(resolveServiceTariffSelection(active, null, 2).price, 100);
  assert.equal(resolveServiceTariffSelection(active, null, 3).price, 50);
  assert.equal(resolveServiceTariffSelection(active, null, 4).price, 50);
  assert.equal(resolveServiceTariffSelection(snapshot, null, null).price, 100);
  assert.equal(resolveServiceTariffSelection({ ...snapshot, fromDays: null }, null, 3).known, false);
  assert.equal(resolveServiceTariffSelection({ ...active, fromPrice: null }, null, 3).price, null);
  assert.equal(active.front, "FINAL");
});

test("charged unknown floor/price cannot be null-bypassed; explicit override zero remains distinct", () => {
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, tariffSnapshot: { ...snapshot, minimumPrice: null } }).success, false);
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, tariffSnapshot: { ...snapshot, fromDays: null } }).success, false);
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, priceSource: "OVERRIDE", overridePrice: 0, tariffSnapshot: { ...snapshot, minimumPrice: 0, normalPrice: null, fromDays: null, fromPrice: null } }).success, true);
});

test("fixed threshold requires explicit context even with override", () => {
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, priceSource: "OVERRIDE", overridePrice: 100, tariffSnapshot: { ...snapshot, fromDays: 3 } }).success, false);
});

test("company/execution/coverage checks reject crossed tenants and stale parent", () => {
  assert.throws(() => validateServiceCompanyBinding(application, coverage, { ...context, organizationId: "other" }));
  assert.throws(() => validateServiceCompanyBinding(application, coverage, { ...context, executions: [{ ...context.executions[0], budgetId: "other" }] }));
  assert.throws(() => validateServiceCompanyBinding(application, [{ ...coverage[0], organizationId: "other" }], context));
  assert.throws(() => validateServiceCompanyBinding(application, coverage, { ...context, lines: [{ ...context.lines[0], excluded: true }] }));
  assert.throws(() => validateServiceCompanyBinding(application, [...coverage, { ...coverage[0], id: "duplicate" }], context));
  assert.throws(() => validateServiceCompanyBinding({ ...application, reviewState: "NEEDS_REVIEW" }, coverage, context));
});

test("public factory excludes private identities and strict schema rejects leaks at every depth", () => {
  const output = publicBudgetServiceTerms(materialized, coverage, context);
  assert.equal(JSON.stringify(output).includes("PRIVATE-"), false);
  assert.deepEqual(output.coverageItemIds, ["item"]);
  assert.equal(publicServiceV1Schema.safeParse({ ...output, knownCost: 91234 }).success, false);
  assert.equal(publicServiceV1Schema.safeParse({ ...output, tariffSnapshot: { ...output.tariffSnapshot, cost: 91234 } }).success, false);
  assert.throws(() => publicBudgetServiceTerms({ ...materialized, privateCost: "PRIVATE-cost" }, coverage, context));
  assert.equal(publicServiceV1Schema.safeParse({ ...output, unit: "PYG_PER_PERSON_DAY" }).success, false);
});

test("FREE retains floor and historical discount but publishes no applied discount/sale", () => {
  const free = { ...materialized, inclusion: "INCLUDED_FREE", discountMode: "PERCENT", discountValue: 1000, grossAmount: 0, discountAmount: 0, netAmount: 0, globalDiscountAmount: 0, totalAmount: 0 };
  const output = publicBudgetServiceTerms(free, coverage, context);
  assert.equal(output.tariffSnapshot.minimumPrice, 10);
  assert.equal(output.discountMode, null);
  assert.equal(free.discountValue, 1000);
  assert.equal(adminBudgetServiceApplicationSchema.safeParse({ ...free, totalAmount: 1 }).success, false);
});

test("cost partial/unknown retains known amount without inventing completeness", () => {
  const result = validateServiceCostBindings([source], [allocation], costContext);
  assert.equal(result.sources[0].incurredAmount, 100);
  assert.equal(result.sources[0].pendingAmount, null);
  assert.equal(result.allocations[0].incurredComplete, false);
  assert.equal(serviceCostSourceSchema.safeParse({ ...source, pendingComplete: true }).success, false);
  assert.equal(serviceCostSourceSchema.safeParse({ ...source, pendingAmount: 0, pendingComplete: true }).success, true);
});

test("cost destination XOR, source identity and sum bounds prevent duplicate/foreign contributions", () => {
  assert.throws(() => validateServiceCostBindings([source], [{ ...allocation, budgetItemId: "item" }], costContext));
  assert.throws(() => validateServiceCostBindings([source], [{ ...allocation, incurredAmount: 101 }], costContext));
  assert.throws(() => validateServiceCostBindings([source], [{ ...allocation, organizationId: "other" }], costContext));
  assert.throws(() => validateServiceCostBindings([source, { ...source, id: "another" }], [allocation], costContext));
  assert.throws(() => validateServiceCostBindings([source], [allocation, { ...allocation, id: "duplicate" }], costContext));
});

test("terms boundary rejects forged authority, versions and aggregate flags", () => {
  const terms = { version: 1, id: null, configurationId: application.configurationId, scope: application.scope,
    parentLineId: null, executionId: application.executionId, coverageItemIds: ["item"], sortOrder: 1,
    publicName: application.publicName, inclusion: application.inclusion, mode: application.mode, unit: application.unit,
    people: null, serviceDays: null, contextualServiceDays: null, front: application.front,
    priceSource: application.priceSource, overridePrice: null, discountMode: null, discountValue: null,
    ivaType: application.ivaType, refreshSnapshot: false };
  assert.equal(budgetServiceMutationInputSchema.safeParse(terms).success, true);
  for (const [key, value] of Object.entries({ organizationId: "foreign", budgetId: "other", tariffSnapshot: snapshot,
    sourceRevision: 99, grossAmount: 1, costComplete: true, reviewState: "RESOLVED", documentVersion: 4 })) {
    assert.equal(budgetServiceMutationInputSchema.safeParse({ ...terms, [key]: value }).success, false, key);
  }
  assert.equal(budgetServiceMutationInputSchema.safeParse({ ...terms, version: 2 }).success, false);
  const { version: _version, ...withoutVersion } = terms;
  assert.equal(budgetServiceMutationInputSchema.safeParse(withoutVersion).success, false);
  assert.equal(budgetServiceApplicationInputSchema.safeParse({ ...application, tariffSnapshot: { ...snapshot, version: 2 } }).success, false);
});

test("unknown source forbids known allocation including accredited zero", () => {
  for (const incurredAmount of [0, 100]) assert.throws(() => validateServiceCostBindings(
    [{ ...source, incurredAmount: null }], [{ ...allocation, incurredAmount }], costContext));
  assert.equal(validateServiceCostBindings([{ ...source, incurredAmount: null }], [{ ...allocation, incurredAmount: null }], costContext).sources[0].incurredAmount, null);
});

test("same supplier commitment cannot be recreated under a second source key", () => {
  const supplier = { ...source, sourceKind: "SUPPLIER", supplierJobId: "job", aggregationOwner: "SUPPLIER" };
  assert.throws(() => validateServiceCostBindings([supplier, { ...supplier, id: "duplicate", sourceKey: "different-key" }], [], costContext));
});

test("catalog snapshots are explicit versioned effective front, never both fronts", () => {
  const config = { id: application.configurationId, organizationId: application.organizationId, inventoryItemId: "product",
    kind: application.kind, publicName: "Traslado", mode: application.mode, unit: application.unit,
    minimumPrice: 20, floorApplicability: "CHARGED_ONLY", ivaType: "GRAVADA_10", active: true, revision: 2,
    tariffsJson: { version: 1, FINAL: { normalPrice: 200, fromDays: 0, fromPrice: null }, WHOLESALE: { normalPrice: 150, fromDays: null, fromPrice: null } } };
  const refreshed = serviceSnapshotFromConfiguration(config, "FINAL");
  assert.equal(refreshed.normalPrice, 200);
  assert.equal(Object.hasOwn(refreshed, "WHOLESALE"), false);
  assert.throws(() => validateServiceSnapshotRetention(application, { ...application, tariffSnapshot: refreshed, sourceRevision: 2 }, false));
  validateServiceSnapshotRetention(application, { ...application, tariffSnapshot: refreshed, sourceRevision: 2 }, true);
  validateServiceSnapshotRetention(application, { ...application, inclusion: "INCLUDED_FREE" }, false);
  assert.throws(() => serviceSnapshotFromConfiguration({ ...config, tariffsJson: { ...config.tariffsJson, version: 99 } }, "FINAL"));
});
