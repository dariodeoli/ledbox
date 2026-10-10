import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { loadScopedBudgetServices, resolveBudgetServiceCoverage, validateLockedServiceCostAllocation } from "../lib/server/budget-service-contract";

const snapshot = { version: 1, front: "FINAL", mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", normalPrice: 100, fromDays: 0, fromPrice: null, minimumPrice: 10 };
const config = { id: "config", organizationId: "org", inventoryItemId: "product", kind: "TRANSPORT", publicName: "Traslado",
  mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", minimumPrice: 20, floorApplicability: "CHARGED_ONLY", ivaType: "GRAVADA_10", active: true, revision: 2,
  tariffsJson: { version: 1, FINAL: { normalPrice: 200, fromDays: 0, fromPrice: null }, WHOLESALE: { normalPrice: 150, fromDays: 0, fromPrice: null } } };
const app = { id: "service", organizationId: "org", budgetId: "budget", configurationId: "config", kind: "TRANSPORT", scope: "SHARED_EXECUTION", parentLineId: null, executionId: "execution", sortOrder: 1, publicName: "Traslado", inclusion: "INCLUDED_CHARGED", reviewState: "RESOLVED", mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", people: null, serviceDays: null, contextualServiceDays: null, front: "FINAL", tariffSnapshot: snapshot, priceSource: "TARIFF", overridePrice: null, floorApplicability: "CHARGED_ONLY", ivaType: "GRAVADA_10", discountMode: null, discountValue: null, sourceRevision: 1 };
const materialized = { ...app, grossAmount: 100, discountAmount: 0, netAmount: 100, globalDiscountAmount: 0, totalAmount: 100 };
const coverage = [{ id: "coverage", organizationId: "org", budgetId: "budget", applicationId: "service", parentLineId: "line", active: true, removedAt: null }];
const binding = { organizationId: "org", budgetId: "budget", configuration: config,
  executions: [{ id: "execution", organizationId: "org", budgetId: "budget" }],
  lines: [{ id: "line", organizationId: "org", budgetId: "budget", excluded: false }], role: "FINANCE" as const, demo: false };
const terms = { version: 1, id: "service", configurationId: "config", scope: "SHARED_EXECUTION", parentLineId: null, executionId: "execution", coverageItemIds: ["line"], sortOrder: 1,
  publicName: "Traslado", inclusion: "INCLUDED_CHARGED", mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", people: null, serviceDays: null, contextualServiceDays: null,
  front: "FINAL", priceSource: "TARIFF", overridePrice: null, discountMode: null, discountValue: null, ivaType: "GRAVADA_10", refreshSnapshot: false };

function readTx(options: { app?: unknown; allocations?: unknown[]; source?: unknown; found?: boolean } = {}) {
  const queries: { delegate: string; args: Record<string, unknown> }[] = [];
  let locked = false;
  const read = (delegate: string, value: unknown) => async (args: Record<string, unknown>) => { queries.push({ delegate, args }); return value; };
  const tx = {
    $queryRaw: async () => { locked = true; return [{ id: "budget" }]; },
    budget: { findFirst: read("budget", options.found === false ? null : { id: "budget", organizationId: "org", ivaType: "GRAVADA_10", updatedAt: new Date("2026-10-10T00:00:00Z") }) },
    budgetServiceApplication: { findMany: read("applications", [options.app ?? materialized]) },
    inventoryServiceConfiguration: { findMany: read("configuration", [config]) },
    budgetServiceExecution: { findMany: read("execution", binding.executions) },
    budgetItem: { findMany: read("lines", [{ id: "line", budgetId: "budget", excluded: false }]) },
    budgetServiceCoverage: { findMany: read("coverage", coverage) },
    serviceCostSource: { findMany: read("sources", options.source ? [options.source] : []) },
    serviceCostAllocation: { findMany: read("allocations", options.allocations ?? []) },
    supplierJob: { count: read("supplier", 0) },
  } as unknown as Prisma.TransactionClient;
  return { tx, queries, isLocked: () => locked };
}

test("readonly loading retains historical snapshot and returns persisted authority", async () => {
  const { tx, queries, isLocked } = readTx();
  const loaded = await loadScopedBudgetServices(tx, { organizationId: "org" }, "budget");
  assert.equal(loaded.applications[0].tariffSnapshot.normalPrice, 100);
  assert.equal(loaded.applications[0].sourceRevision, 1);
  assert.deepEqual(loaded.authority, { servicesContractVersion: 1, organizationId: "org", budgetId: "budget", budgetUpdatedAt: "2026-10-10T00:00:00.000Z", applications: [{ id: "service", sourceRevision: 1, snapshotVersion: 1 }] });
  assert.equal(isLocked(), false);
  assert.ok(queries.every(query => Object.hasOwn(query.args, "where")));
  assert.deepEqual(queries.find(query => query.delegate === "sources")?.args.where, { organizationId: "org", budgetId: "budget" });
  assert.equal(Object.hasOwn(queries.find(query => query.delegate === "applications")!.args.select as object, "costComplete"), false);
  // Stub exposes no create/update/transaction/allocator: loading must succeed with reads only.
});

test("loader rejects unknown persisted versions, cross-budget rows and missing scoped budget", async () => {
  await assert.rejects(() => loadScopedBudgetServices(readTx({ app: { ...materialized, tariffSnapshot: { ...snapshot, version: 99 } } }).tx, { organizationId: "org" }, "budget"));
  await assert.rejects(() => loadScopedBudgetServices(readTx({ app: { ...materialized, budgetId: "other" } }).tx, { organizationId: "org" }, "budget"));
  await assert.rejects(() => loadScopedBudgetServices(readTx({ app: { ...materialized, sourceRevision: 3 } }).tx, { organizationId: "org" }, "budget"), /SERVICE_SOURCE_REVISION_INVALID/);
  await assert.rejects(() => loadScopedBudgetServices(readTx({ found: false }).tx, { organizationId: "org" }, "budget"), /SERVICE_BUDGET_NOT_FOUND/);
});

test("ordinary resolution does not refresh; explicit scoped refresh advances source revision", () => {
  const retained = resolveBudgetServiceCoverage(terms, config, binding, app, coverage);
  assert.equal(retained.app.tariffSnapshot.normalPrice, 100);
  assert.equal(retained.app.sourceRevision, 1);
  const refreshed = resolveBudgetServiceCoverage({ ...terms, refreshSnapshot: true }, config, binding, app, coverage);
  assert.equal(refreshed.app.tariffSnapshot.normalPrice, 200);
  assert.equal(refreshed.app.sourceRevision, 2);
  assert.throws(() => resolveBudgetServiceCoverage(terms, { ...config, organizationId: "other" }, binding, app, coverage));
  assert.throws(() => resolveBudgetServiceCoverage({ ...terms, reviewState: "RESOLVED" }, config, binding, app, coverage));
});

test("total coverage removal requires explicit exclusion and preserves historical references", () => {
  assert.throws(() => resolveBudgetServiceCoverage({ ...terms, coverageItemIds: [] }, config, binding, app, coverage));
  const removed = resolveBudgetServiceCoverage({ ...terms, inclusion: "NOT_INCLUDED", coverageItemIds: [], ivaType: null }, config, binding, app, coverage, new Date("2026-10-10T12:00:00Z"));
  assert.equal(removed.coverage[0].id, "coverage");
  assert.equal(removed.coverage[0].active, false);
  assert.equal(removed.coverage[0].removedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(removed.app.tariffSnapshot.minimumPrice, 10);
});

test("locked allocation validation re-reads competing committed allocation before bounds", async () => {
  const source = { id: "source", organizationId: "org", budgetId: "budget", sourceKind: "SERVICE", sourceKey: "obligation", supplierJobId: null, aggregationOwner: "SERVICE", executionState: "PARTIAL", incurredAmount: 10000, pendingAmount: null, incurredComplete: false, pendingComplete: false };
  const competitor = { id: "competing", organizationId: "org", budgetId: "budget", sourceId: "source", applicationId: null, budgetItemId: "line", incurredAmount: 6000, pendingAmount: null, incurredComplete: false, pendingComplete: false };
  const fixture = readTx({ source, allocations: [competitor] });
  const patch = { version: 1, id: null, sourceId: "source", applicationId: "service", budgetItemId: null, incurredAmount: 6000, pendingAmount: null, incurredComplete: false, pendingComplete: false };
  await assert.rejects(() => validateLockedServiceCostAllocation(fixture.tx, binding, "budget", patch), /SERVICE_COST_OVERALLOCATED/);
  assert.equal(fixture.isLocked(), true);
  const fit = await validateLockedServiceCostAllocation(fixture.tx, binding, "budget", { ...patch, incurredAmount: 4000 });
  assert.equal(fit.allocation.incurredAmount, 4000);
});
