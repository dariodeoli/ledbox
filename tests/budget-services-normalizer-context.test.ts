import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { AdminContext } from "../lib/server/tenancy";
import { loadLockedServiceEconomicNormalizerContext, serviceEconomicCensusDigest } from "../lib/server/budget-service-contract";

const at = "2026-10-10T00:00:00.000Z";
const context = { organizationId: "org", organization: { id: "org" }, user: { id: "actor" }, role: "FINANCE", demo: false } as AdminContext;
function fixture() {
  const budget = { id: "budget", organizationId: "org", eventId: "event", updatedAt: at, materialCost: 0, laborCost: 0, costEstimate: 0 };
  const item = { id: "item", budgetId: "budget", inventoryId: "inventory", costPrice: 0 };
  const universe: Record<string, Record<string, unknown>[]> = {
    Event: [{ id: "event", organizationId: "org" }], Budget: [budget], BudgetItem: [item],
    BudgetServiceApplication: [], BudgetServiceCoverage: [], ServiceCostSource: [], ServiceCostAllocation: [], SupplierJob: [],
    Expense: [{ id: "expense", organizationId: "org", eventId: "event", amount: 100 }],
    TreasuryMovement: [{ id: "movement", organizationId: "org", origin: "expense", sourceId: "expense", amount: 100 }],
    EventTask: [{ id: "task", eventId: "event", promoterId: "promoter", completedAt: at }],
    Promoter: [{ id: "promoter", organizationId: "org", name: "Person" }],
    EventInventory: [{ id: "assignment", eventId: "event", inventoryId: "inventory", quantity: 1 }],
    InventoryItem: [{ id: "inventory", organizationId: "org", dailyCost: 100 }],
    InventoryUnit: [{ id: "unit", organizationId: "org", inventoryId: "inventory", purchaseCost: 100 }],
  };
  const census = { budget, applications: [], items: [item], coverage: [], sources: [] as Record<string, unknown>[], allocations: [], supplierJobs: [] as Record<string, unknown>[], universe,
    joinedBindings: {
      BudgetItem: [{ id: "item", organizationId: "org", budgetId: "budget", eventId: "event" }],
      EventTask: [{ id: "task", organizationId: "org", budgetId: null, eventId: "event" }],
      EventInventory: [{ id: "assignment", organizationId: "org", budgetId: null, eventId: "event" }],
    } };
  const queries: { sql: string; values: unknown[] }[] = [];
  const tx = { $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ sql: sql.join("?"), values });
    if (queries.length === 1) {
      assert.match(queries[0].sql, /"organizationId"=\? AND "id"=\? FOR UPDATE/);
      assert.deepEqual(values, ["org", "budget"]); return [{ id: "budget" }];
    }
    assert.equal(queries.length, 2, "context must reuse one capture, not reread/reconcile");
    assert.match(queries[1].sql, /JOIN "Budget" x ON x\."id"=i\."budgetId"/);
    assert.match(queries[1].sql, /JOIN "Event" e ON e\."id"=t\."eventId"/);
    assert.match(queries[1].sql, /JOIN "Event" e ON e\."id"=i\."eventId" JOIN "InventoryItem"/);
    assert.deepEqual(values, ["org", "budget"]);
    return [census];
  } } as unknown as Prisma.TransactionClient;
  return { census, tx, queries };
}

// Source-written transaction doubles check assembly/denials only. They are not
// PostgreSQL/joins/MVCC/native PASS or a semantic fact provider.
test("fresh FIN-shaped Map derives current BudgetItem scope from DB capture/join", async () => {
  const f = fixture();
  const loaded = await loadLockedServiceEconomicNormalizerContext(f.tx, context, "budget");
  assert.equal(f.queries.length, 2);
  assert.equal(loaded.current.censusVersion, 2);
  assert.equal(loaded.current.budgetUpdatedAt, at);
  assert.equal(loaded.current.censusDigest, serviceEconomicCensusDigest({ censusVersion: 2, ...f.census }));
  assert.deepEqual(loaded.current.currentRecordMap.get("BudgetItem:item"), {
    rowDigest: serviceEconomicCensusDigest(f.census.items[0]), organizationId: "org", budgetId: "budget", eventId: "event",
  });
  assert.equal(loaded.snapshot.components[0].sourceRevision, null); // No synthetic equipment revision.
});

test("cross-org joins, false Budget/event bindings and missing joins deny context", async () => {
  for (const mutation of ["org", "budget", "event", "missing", "inventory"] as const) {
    const f = fixture();
    if (mutation === "org") f.census.joinedBindings.BudgetItem[0].organizationId = "other-org";
    if (mutation === "budget") f.census.joinedBindings.BudgetItem[0].budgetId = "other-budget";
    if (mutation === "event") f.census.joinedBindings.EventTask[0].eventId = "other-event";
    if (mutation === "missing") f.census.joinedBindings.EventInventory = [];
    if (mutation === "inventory") f.census.universe.InventoryItem[0].organizationId = "other-org";
    await assert.rejects(loadLockedServiceEconomicNormalizerContext(f.tx, context, "budget"), /EVIDENCE_INDEX_(JOIN_SCOPE_INVALID|CROSS_ORGANIZATION)/);
  }
});

test("event membership, cash source and related supplier sources never assign entity to Budget", async () => {
  const f = fixture();
  const job = { id: "job", organizationId: "org", eventId: "event" };
  const source = { id: "source", organizationId: "org", budgetId: "budget", sourceKind: "SUPPLIER", sourceKey: "job-obligation", supplierJobId: "job",
    incurredAmount: 100, pendingAmount: 0, incurredComplete: true, pendingComplete: true };
  f.census.universe.SupplierJob = [job]; f.census.supplierJobs = [job];
  f.census.sources = [source]; f.census.universe.ServiceCostSource = [source];
  const loaded = await loadLockedServiceEconomicNormalizerContext(f.tx, context, "budget");
  for (const key of ["Event:event", "EventTask:task", "EventInventory:assignment", "Expense:expense", "TreasuryMovement:movement", "Promoter:promoter", "InventoryItem:inventory", "SupplierJob:job"]) {
    assert.equal(loaded.current.currentRecordMap.get(key), undefined);
    assert.equal(loaded.unavailableRecords.get(key)?.budgetId, null);
    assert.equal(loaded.unavailableRecords.get(key)?.reason, "BUDGET_ATTRIBUTION_MISSING");
  }
  assert.equal(loaded.unavailableRecords.get("TreasuryMovement:movement")?.eventId, "event");
  assert.deepEqual(loaded.unavailableRecords.get("SupplierJob:job")?.linkedBudgetIds, ["budget"]);
  assert.equal(loaded.current.currentRecordMap.get("ServiceCostSource:source")?.budgetId, "budget");
});

test("fresh mutation changes row digest and full census; unrelated Budget is excluded", async () => {
  const original = fixture(), changed = fixture();
  const first = await loadLockedServiceEconomicNormalizerContext(original.tx, context, "budget");
  changed.census.items[0].costPrice = 200;
  changed.census.universe.Budget.push({ ...changed.census.budget, id: "other-budget" });
  const second = await loadLockedServiceEconomicNormalizerContext(changed.tx, context, "budget");
  assert.notEqual(first.current.currentRecordMap.get("BudgetItem:item")?.rowDigest, second.current.currentRecordMap.get("BudgetItem:item")?.rowDigest);
  assert.notEqual(first.current.censusDigest, second.current.censusDigest);
  assert.equal(second.current.currentRecordMap.get("Budget:other-budget"), undefined);
  assert.equal(second.unavailableRecords.get("Budget:other-budget")?.reason, "OTHER_BUDGET");
});

test("duplicates and orphan join bindings never silently overwrite a canonical Map key", async () => {
  for (const mutation of ["record", "join", "orphan"] as const) {
    const f = fixture();
    if (mutation === "record") f.census.universe.BudgetItem.push({ ...f.census.items[0] });
    if (mutation === "join") f.census.joinedBindings.BudgetItem.push({ ...f.census.joinedBindings.BudgetItem[0] });
    if (mutation === "orphan") f.census.joinedBindings.BudgetItem.push({ ...f.census.joinedBindings.BudgetItem[0], id: "orphan" });
    await assert.rejects(loadLockedServiceEconomicNormalizerContext(f.tx, context, "budget"), /EVIDENCE_INDEX_(DUPLICATE_RECORD|DUPLICATE_JOIN|JOIN_ORPHAN)/);
  }
});

test("canonical row digest ignores property order but does not hash synthetic join metadata", async () => {
  const f = fixture();
  f.census.universe.BudgetItem[0] = { costPrice: 0, inventoryId: "inventory", budgetId: "budget", id: "item" };
  const loaded = await loadLockedServiceEconomicNormalizerContext(f.tx, context, "budget");
  const rowDigest = loaded.current.currentRecordMap.get("BudgetItem:item")?.rowDigest;
  assert.equal(rowDigest, serviceEconomicCensusDigest(f.census.items[0]));
  assert.notEqual(rowDigest, serviceEconomicCensusDigest({ ...f.census.items[0], organizationId: "org", eventId: "event" }));
});

test("unauthenticated/tenant-mismatched, operations/viewer and demo contexts read nothing", async () => {
  const denied = [
    { ...context, user: { ...context.user, id: "" } },
    { ...context, organization: { ...context.organization, id: "other" } },
    { ...context, role: "OPERATIONS" as const }, { ...context, role: "VIEWER" as const }, { ...context, demo: true },
  ];
  for (const ctx of denied) {
    const f = fixture();
    await assert.rejects(loadLockedServiceEconomicNormalizerContext(f.tx, ctx, "budget"), /EVIDENCE_NORMALIZER_CONTEXT_FORBIDDEN/);
    assert.equal(f.queries.length, 0);
  }
});

test("digest/audit/task completion produce no semantic facts, provider or certified handle", async () => {
  const f = fixture();
  const loaded = await loadLockedServiceEconomicNormalizerContext(f.tx, context, "budget");
  assert.equal(loaded.semanticFactProvider, null);
  assert.equal("factProvider" in loaded.current, false);
  assert.equal(loaded.semanticFactProviderReason, "PERSISTED_ORIGIN_DOMAIN_CLOSURE_AND_BUDGET_ATTRIBUTION_FACTS_ABSENT");
  assert.equal(loaded.current.currentRecordMap.get("AuditLog:audit"), undefined);
  assert.equal("legacyCostsReconciled" in loaded, false);
  assert.equal("proofId" in loaded, false);
});
