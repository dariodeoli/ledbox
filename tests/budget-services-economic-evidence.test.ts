import assert from "node:assert/strict";
import { test } from "node:test";
import { serviceEconomicSnapshotSchema, serviceEconomicPolicySupportSchema } from "../lib/budget-service-contract";
import { serviceEconomicCensusDigest, validatePersistedServiceEconomicEvidence, loadLockedServiceEconomicEvidence, appendLockedServiceEconomicObservation } from "../lib/server/budget-service-contract";
import type { Prisma } from "@prisma/client";
import type { AdminContext } from "../lib/server/tenancy";

const at = "2026-10-10T00:00:00.000Z";
const scope = { organizationId: "org", budgetId: "budget", budgetUpdatedAt: at, contractVersion: 1 as const };
const snapshot = serviceEconomicSnapshotSchema.parse({ scope,
  budget: { id: "budget", organizationId: "org", eventId: "event", updatedAt: at, materialCost: 0, laborCost: 0, costEstimate: 0 },
  supplierJobs: [], sources: [], allocations: [],
  components: [{ id: "service", organizationId: "org", budgetId: "budget", kind: "SERVICE", snapshotVersion: 1, sourceRevision: 2, expectedSourceRevision: 2 },
    { id: "item", organizationId: "org", budgetId: "budget", kind: "EQUIPMENT", snapshotVersion: null, sourceRevision: null, expectedSourceRevision: null }],
});
const censusDigest = serviceEconomicCensusDigest({ snapshot, fullEquipmentRows: [{ id: "item", costPrice: 0 }], coverage: [] });
const members: { applicationId: string | null; budgetItemId: string | null; sourceId: string | null; allocationId: string | null }[] = [
  { applicationId: "service", budgetItemId: null, sourceId: null, allocationId: null },
  { applicationId: null, budgetItemId: "item", sourceId: null, allocationId: null },
];
function fixture(kind: "COMPONENT_ZERO" | "LEGACY_RECONCILIATION" = "COMPONENT_ZERO") {
  const record = { id: "evidence", organizationId: "org", budgetId: "budget", contractVersion: 1, revision: 1, kind,
    applicationId: kind === "COMPONENT_ZERO" ? "service" : null, budgetItemId: null,
    budgetUpdatedAt: at, censusDigest, snapshot: structuredClone(snapshot), members: structuredClone(members), policySupport: null,
    provenance: { auditId: "audit", actorId: "actor", recordedAt: at, rationale: "Internal observation with identified custodian", legacyOverlaps: [] as { field: "materialCost" | "laborCost" | "costEstimate"; sourceId: string }[] } };
  const audit = { id: "audit", organizationId: "org", actorId: "actor", action: "SERVICE_ECONOMIC_EVIDENCE_RECORDED",
    entity: "ServiceEconomicEvidence", entityId: "evidence", createdAt: at, detail: {} as unknown };
  const bindAudit = () => { const { members: _members, ...observation } = record;
    audit.detail = { observationDigest: serviceEconomicCensusDigest(observation), censusDigest: record.censusDigest }; };
  bindAudit();
  const current = { snapshot: structuredClone(snapshot), censusDigest, expectedRevision: 1, audit };
  return { record, current, bindAudit };
}

test("persisted/audited zero observations do not manufacture FIN economic authority", () => {
  const { record, current } = fixture();
  const result = validatePersistedServiceEconomicEvidence(record, current);
  assert.equal(result.integrityValidated, true);
  assert.equal(result.costComplete, false);
  assert.equal(result.legacyCostsReconciled, false);
  assert.deepEqual(result.zeroCostConfirmedIds, []);
  assert.equal(result.missingAuthority, "PERSISTED_ECONOMIC_POLICY_SUPPORT_V1");
});

test("zero without provenance, wrong actor, unrelated audit or altered statement fails closed", () => {
  for (const mutation of ["absent", "actor", "entity", "altered"] as const) {
    const { record, current } = fixture();
    if (mutation === "absent") assert.throws(() => validatePersistedServiceEconomicEvidence(record, { ...current, audit: null }), /EVIDENCE_PROVENANCE_INVALID/);
    else {
      if (mutation === "actor") current.audit.actorId = "other";
      if (mutation === "entity") current.audit.entityId = "other";
      if (mutation === "altered") record.provenance.rationale = "Edited after recorded provenance";
      assert.throws(() => validatePersistedServiceEconomicEvidence(record, current), /EVIDENCE_PROVENANCE_INVALID/);
    }
  }
});

test("cross-company/budget, stale budget/record revision and service revision invalidation", () => {
  for (const field of ["organizationId", "budgetId", "budgetUpdatedAt", "revision"] as const) {
    const { record, current } = fixture();
    if (field === "revision") record.revision = 2;
    else record[field] = field === "budgetUpdatedAt" ? "2026-10-11T00:00:00.000Z" : "other";
    assert.throws(() => validatePersistedServiceEconomicEvidence(record, current), /EVIDENCE_SCOPE_CENSUS_STALE/);
  }
  const { record, current } = fixture();
  current.snapshot.components[0].sourceRevision = 3;
  assert.throws(() => validatePersistedServiceEconomicEvidence(record, current), /EVIDENCE_SCOPE_CENSUS_STALE/);
});

test("equipment/coverage/source changes invalidate full census even without Budget revision bump", () => {
  const { record, current } = fixture();
  const changed = serviceEconomicCensusDigest({ snapshot, fullEquipmentRows: [{ id: "item", costPrice: 100 }], coverage: [] });
  assert.notEqual(changed, censusDigest);
  assert.throws(() => validatePersistedServiceEconomicEvidence(record, { ...current, censusDigest: changed }), /EVIDENCE_SCOPE_CENSUS_STALE/);
});

test("partial/duplicate census and wrongly typed zero component cannot close", () => {
  const { record, current } = fixture();
  record.members.pop();
  assert.throws(() => validatePersistedServiceEconomicEvidence(record, current), /EVIDENCE_CENSUS_INCOMPLETE/);
  record.members = [members[0], members[0]];
  assert.throws(() => validatePersistedServiceEconomicEvidence(record, current), /EVIDENCE_DUPLICATE_CENSUS/);
  const typed = fixture();
  typed.record.applicationId = "item"; typed.bindAudit();
  assert.throws(() => validatePersistedServiceEconomicEvidence(typed.record, typed.current), /EVIDENCE_TARGET_INVALID/);
});

test("legacy overlap must reference a real recognized source and never produce a second contribution", () => {
  const { record, current, bindAudit } = fixture("LEGACY_RECONCILIATION");
  record.provenance.legacyOverlaps = [{ field: "laborCost", sourceId: "invented-source" }]; bindAudit();
  assert.throws(() => validatePersistedServiceEconomicEvidence(record, current), /EVIDENCE_LEGACY_DOUBLE_COUNT/);
  record.provenance.legacyOverlaps = []; bindAudit();
  const result = validatePersistedServiceEconomicEvidence(record, current);
  assert.equal(result.legacyCostsReconciled, false); // Default-zero legacy isn't an attestation.
  assert.equal("contributions" in result, false); // This guard never allocates/adds legacy.
});

test("duplicate legacy/recognized obligation and repeated legacy overlap cannot be admitted", () => {
  const f = fixture("LEGACY_RECONCILIATION");
  const source = { id: "source", organizationId: "org", budgetId: "budget", sourceKind: "LABOR" as const, sourceKey: "same-obligation", supplierJobId: null,
    incurredAmount: 100, pendingAmount: null, incurredComplete: true, pendingComplete: false };
  f.record.snapshot.sources = [source, { ...source, id: "duplicate" }];
  f.current.snapshot = structuredClone(f.record.snapshot); f.bindAudit();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_DUPLICATE_CENSUS/);
  f.record.snapshot.sources.pop();
  f.record.members.push({ applicationId: null, budgetItemId: null, sourceId: "source", allocationId: null });
  f.record.provenance.legacyOverlaps = [{ field: "laborCost", sourceId: "source" }, { field: "laborCost", sourceId: "source" }];
  f.current.snapshot = structuredClone(f.record.snapshot); f.bindAudit();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_DUPLICATE_CENSUS/);
  f.record.provenance.legacyOverlaps.pop(); f.bindAudit();
  const result = validatePersistedServiceEconomicEvidence(f.record, f.current);
  assert.equal(result.costComplete, false);
  assert.equal("knownCost" in result, false);
  assert.equal(result.observation.snapshot.sources[0].pendingAmount, null); // Remaining unknown stays unknown.
});

test("nested cross-org/budget and stale component revision fail even with matching audit digest", () => {
  for (const mutation of ["organization", "budget", "revision"] as const) {
    const f = fixture();
    if (mutation === "organization") f.record.snapshot.components[0].organizationId = "other";
    if (mutation === "budget") f.record.snapshot.components[0].budgetId = "other";
    if (mutation === "revision") f.record.snapshot.components[0].expectedSourceRevision = 3;
    f.current.snapshot = structuredClone(f.record.snapshot); f.bindAudit();
    assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), mutation === "revision" ? /EVIDENCE_COMPONENT_VERSION_INVALID/ : /EVIDENCE_SCOPE_CENSUS_STALE/);
  }
});

test("unknown/positive recognized balances prevent a zero observation even with valid provenance", () => {
  for (const amount of [null, 100] as const) {
    const f = fixture();
    const source = { id: "source", organizationId: "org", budgetId: "budget", sourceKind: "LABOR" as const, sourceKey: "obligation", supplierJobId: null,
      incurredAmount: amount, pendingAmount: 0, incurredComplete: amount !== null, pendingComplete: true };
    const allocation = { ...source, id: "allocation", sourceId: "source", applicationId: "service", budgetItemId: null };
    f.record.snapshot.sources = [source];
    const { sourceKind: _kind, sourceKey: _key, supplierJobId: _job, ...allocationTerms } = allocation;
    f.record.snapshot.allocations = [allocationTerms];
    f.record.members.push({ applicationId: null, budgetItemId: null, sourceId: "source", allocationId: null },
      { applicationId: null, budgetItemId: null, sourceId: null, allocationId: "allocation" });
    f.current.snapshot = structuredClone(f.record.snapshot); f.bindAudit();
    assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_ZERO_CONFLICT/);
  }
});

test("private snapshot rejects costComplete/client claims and future versions", () => {
  const { record, current } = fixture();
  assert.throws(() => validatePersistedServiceEconomicEvidence({ ...record, costComplete: true }, current));
  assert.throws(() => validatePersistedServiceEconomicEvidence({ ...record, contractVersion: 2 }, current));
  assert.throws(() => serviceEconomicSnapshotSchema.parse({ ...snapshot, zeroCostConfirmedIds: ["service"] }));
});

test("internal loader locks same-company Budget before any evidence read; absence is not adopted", async () => {
  let queries = 0;
  const tx = { $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
    queries++;
    assert.match(sql.join("?"), /"organizationId"=\? AND "id"=\? FOR UPDATE/);
    assert.deepEqual(values, ["org", "budget"]);
    return [];
  } } as unknown as Prisma.TransactionClient;
  await assert.rejects(loadLockedServiceEconomicEvidence(tx, { organizationId: "org" }, "budget", "evidence", 1), /EVIDENCE_BUDGET_NOT_FOUND/);
  assert.equal(queries, 1);
});

test("internal persistence forbids viewer/operations/demo before reading or writing", async () => {
  const tx = { $queryRaw: async () => { assert.fail("forbidden caller queried database"); } } as unknown as Prisma.TransactionClient;
  for (const role of ["VIEWER", "OPERATIONS"] as const) {
    await assert.rejects(appendLockedServiceEconomicObservation(tx, { role, demo: false } as AdminContext, "budget", {}), /EVIDENCE_WRITE_FORBIDDEN/);
  }
  await assert.rejects(appendLockedServiceEconomicObservation(tx, { role: "OWNER", demo: true } as AdminContext, "budget", {}), /EVIDENCE_WRITE_FORBIDDEN/);
});

test("persisting stale/exhausted evidence revision never writes audit/evidence/members", async () => {
  const census = { budget: snapshot.budget,
    applications: [{ id: "service", organizationId: "org", budgetId: "budget", sourceRevision: 2, tariffSnapshot: { version: 1 } }],
    items: [{ id: "item", budgetId: "budget", costPrice: 0 }], coverage: [], sources: [], allocations: [], supplierJobs: [] };
  for (const previous of [2, 2147483647]) {
    let reads = 0;
    const tx = { $queryRaw: async () => { reads++; return reads === 1 ? [{ id: "budget" }] : reads === 2 ? [census] : [{ revision: previous }]; },
      $executeRaw: async () => { assert.fail("revision rejection wrote evidence"); },
      auditLog: { create: async () => { assert.fail("revision rejection wrote audit"); } } } as unknown as Prisma.TransactionClient;
    await assert.rejects(appendLockedServiceEconomicObservation(tx, { role: "FINANCE", demo: false, organizationId: "org" } as AdminContext, "budget", {
      kind: "COMPONENT_ZERO", applicationId: "service", budgetItemId: null, budgetUpdatedAt: at, censusDigest: serviceEconomicCensusDigest({ censusVersion: 2, ...census }),
      expectedEvidenceRevision: previous === 2 ? 1 : previous, rationale: "Internal observation", legacyOverlaps: [],
      policySupport: null,
    }), previous === 2 ? /EVIDENCE_REVISION_STALE/ : /EVIDENCE_REVISION_EXHAUSTED/);
    assert.equal(reads, 3);
  }
});

const domains = ["SERVICE", "LABOR", "EQUIPMENT_MATERIAL", "SUPPLIER", "EXPENSE_TREASURY"] as const;
function unresolvedPolicy() {
  return serviceEconomicPolicySupportSchema.parse({ policyVersion: 1, censusVersion: 2,
    legacyDispositionByField: ["materialCost", "laborCost", "costEstimate"].map(field => ({ field, fieldValue: 0, state: "UNRESOLVED", reason: "No persisted origin/disposition facts" })),
    overlaps: [], componentObligationClosure: members.map(member => ({ applicationId: member.applicationId, budgetItemId: member.budgetItemId,
      domains: domains.map(domain => ({ domain, state: "UNRESOLVED", reason: "No operational closure facts" })) })),
  });
}
function policyFixture() {
  const f = fixture("LEGACY_RECONCILIATION");
  const record = { ...f.record, policySupport: unresolvedPolicy() };
  const universe: Record<string, Record<string, unknown>[]> = Object.fromEntries([
    "Event", "Budget", "BudgetItem", "BudgetServiceApplication", "BudgetServiceCoverage", "ServiceCostSource", "ServiceCostAllocation", "SupplierJob", "Expense", "TreasuryMovement", "EventTask", "Promoter", "EventInventory", "InventoryItem", "InventoryUnit",
  ].map(entity => [entity, []]));
  const current = { ...f.current, universe };
  const bind = () => { current.snapshot = structuredClone(record.snapshot);
    const { members: _members, ...observation } = record;
    current.audit.detail = { observationDigest: serviceEconomicCensusDigest(observation), censusDigest: record.censusDigest }; };
  bind(); return { record, current, bind };
}

test("FIN policy V1 typed unresolved fields/domains preserve false with specific reasons", () => {
  const f = policyFixture();
  const result = validatePersistedServiceEconomicEvidence(f.record, f.current);
  assert.equal(result.legacyCostsReconciled, false); assert.equal(result.costComplete, false);
  assert.deepEqual(result.zeroCostConfirmedIds, []);
  assert.ok(result.supportReasons.includes("LEGACY_materialCost_UNRESOLVED"));
  assert.ok(result.supportReasons.includes("COMPONENT_service_EXPENSE_TREASURY_UNRESOLVED"));
  assert.equal(result.missingAuthority, "PERSISTED_ECONOMIC_ORIGIN_AND_DOMAIN_CLOSURE_FACTS");
});

test("exact three fields and five distinct domains required, not merely array cardinality", () => {
  const f = policyFixture();
  f.record.policySupport.legacyDispositionByField[2] = { ...f.record.policySupport.legacyDispositionByField[0] }; f.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_DUPLICATE/);
  const other = policyFixture();
  other.record.policySupport.componentObligationClosure[0].domains[4] = { ...other.record.policySupport.componentObligationClosure[0].domains[0] }; other.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(other.record, other.current), /EVIDENCE_POLICY_DUPLICATE/);
  assert.throws(() => serviceEconomicPolicySupportSchema.parse({ ...unresolvedPolicy(), legacyDispositionByField: [] }));
});

test("audit/rationale, empty references and empty partitions never authorize estimate or zero", () => {
  const p = unresolvedPolicy();
  assert.throws(() => serviceEconomicPolicySupportSchema.parse({ ...p, legacyDispositionByField: [
    { field: "materialCost", fieldValue: 0, state: "ESTIMATE_ONLY", origin: "PERSISTED_ESTIMATE_DECLARATION", factReferences: [] }, ...p.legacyDispositionByField.slice(1),
  ] }));
  assert.throws(() => serviceEconomicPolicySupportSchema.parse({ ...p, legacyDispositionByField: [
    { field: "materialCost", fieldValue: 0, state: "REPRESENTED_BY_RECOGNIZED_SOURCES", slices: [] }, ...p.legacyDispositionByField.slice(1),
  ] }));
  assert.throws(() => serviceEconomicPolicySupportSchema.parse({ ...p, componentObligationClosure: [
    { applicationId: "service", budgetItemId: null, domains: domains.map(domain => ({ domain, state: "VERIFIED_NOT_APPLICABLE", factReferences: [{ entity: "AuditLog", recordId: "audit", rowDigest: censusDigest, fact: "DOMAIN_OPERATIONAL_CLOSURE" }] })) },
    p.componentObligationClosure[1],
  ] }));
});

test("actual task completion and row digest are not persisted operational closure facts", () => {
  const f = policyFixture();
  const task = { id: "task", eventId: "event", completedAt: at };
  f.current.universe.EventTask = [task];
  f.record.policySupport.componentObligationClosure[0].domains[1] = { domain: "LABOR", state: "VERIFIED_NOT_APPLICABLE",
    factReferences: [{ entity: "EventTask", recordId: "task", rowDigest: serviceEconomicCensusDigest(task), fact: "DOMAIN_OPERATIONAL_CLOSURE" }] };
  f.bind();
  const result = validatePersistedServiceEconomicEvidence(f.record, f.current);
  assert.ok(result.supportReasons.includes("PERSISTED_DOMAIN_OPERATIONAL_CLOSURE_FACT_ABSENT"));
  assert.ok(result.supportReasons.includes("DOMAIN_LABOR_NOT_APPLICABLE_FACT_ABSENT"));
  assert.deepEqual(result.zeroCostConfirmedIds, []);
  f.current.universe.EventTask = [{ ...task, completedAt: null }];
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_FACT_STALE/);
});

test("cross-tenant/missing fact and incomplete universe reject even with matching audit", () => {
  const f = policyFixture();
  f.record.policySupport.legacyDispositionByField[0] = { field: "materialCost", fieldValue: 0, state: "ESTIMATE_ONLY", origin: "PERSISTED_ESTIMATE_DECLARATION",
    factReferences: [{ entity: "Budget", recordId: "other-tenant-budget", rowDigest: censusDigest, fact: "ESTIMATE_ORIGIN" }] };
  f.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_FACT_STALE/);
  delete f.current.universe.Expense;
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_UNIVERSE_INCOMPLETE/);
});

function representedPolicyFixture() {
  const f = policyFixture();
  const source = { id: "source", organizationId: "org", budgetId: "budget", sourceKind: "LABOR" as const, sourceKey: "obligation", supplierJobId: null,
    incurredAmount: 100, pendingAmount: 0, incurredComplete: true, pendingComplete: true };
  const allocation = { id: "allocation", organizationId: "org", budgetId: "budget", sourceId: "source", applicationId: "service", budgetItemId: null,
    incurredAmount: 100, pendingAmount: 0, incurredComplete: true, pendingComplete: true };
  f.record.snapshot.sources = [source]; f.record.snapshot.allocations = [allocation];
  f.current.universe.ServiceCostSource = [source]; f.current.universe.ServiceCostAllocation = [allocation];
  f.record.members.push({ applicationId: null, budgetItemId: null, sourceId: "source", allocationId: null }, { applicationId: null, budgetItemId: null, sourceId: null, allocationId: "allocation" });
  const slice = { id: "slice", sourceId: "source", allocationId: "allocation", domain: "LABOR" as const, incurredAmount: 100, pendingAmount: 0,
    factReferences: [{ entity: "ServiceCostSource" as const, recordId: "source", rowDigest: serviceEconomicCensusDigest(source), fact: "RECOGNIZED_OBLIGATION" as const }] };
  f.record.snapshot.budget.laborCost = 100;
  f.record.policySupport.legacyDispositionByField[1] = { field: "laborCost", fieldValue: 100, state: "REPRESENTED_BY_RECOGNIZED_SOURCES", slices: [slice] };
  f.bind(); return { ...f, slice };
}

test("legacy slices require full scoped partition and recognized complete balances", () => {
  const f = representedPolicyFixture();
  const disposition = f.record.policySupport.legacyDispositionByField[1];
  assert.equal(disposition.state, "REPRESENTED_BY_RECOGNIZED_SOURCES");
  if (disposition.state !== "REPRESENTED_BY_RECOGNIZED_SOURCES") assert.fail();
  disposition.slices[0].incurredAmount = 101; f.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_SLICE_OVERALLOCATED/);
  disposition.slices[0].incurredAmount = 99; f.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_PARTITION_INCOMPLETE/);
  disposition.slices[0].incurredAmount = 100;
  f.record.snapshot.sources[0].pendingAmount = null; f.record.snapshot.sources[0].pendingComplete = false; f.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_OVERALLOCATED/); // known allocation cannot use unknown source.
});

test("cross-field repeated representation needs explicit overlap and is never summed anew", () => {
  const f = representedPolicyFixture();
  f.record.snapshot.budget.costEstimate = 100;
  f.record.policySupport.legacyDispositionByField[2] = { field: "costEstimate", fieldValue: 100, state: "REPRESENTED_BY_RECOGNIZED_SOURCES", slices: [{ ...f.slice, id: "estimate-slice" }] };
  f.bind();
  assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, f.current), /EVIDENCE_POLICY_OVERLAP_UNDECLARED/);
  f.record.policySupport.overlaps = [{ leftField: "laborCost", leftSliceId: "slice", rightField: "costEstimate", rightSliceId: "estimate-slice" }]; f.bind();
  const result = validatePersistedServiceEconomicEvidence(f.record, f.current);
  assert.equal(result.legacyCostsReconciled, false); // explicit overlap isn't semantic domain closure.
  assert.equal("contributions" in result, false);
  assert.equal(result.observation.snapshot.sources.length, 1);
});

test("changes in every external universe and cross-budget attribution invalidate census V2", () => {
  const universe = policyFixture().current.universe;
  const before = serviceEconomicCensusDigest({ censusVersion: 2, snapshot, universe });
  for (const entity of ["Expense", "TreasuryMovement", "EventTask", "Promoter", "EventInventory", "InventoryItem", "InventoryUnit", "Budget", "ServiceCostAllocation"]) {
    const changed = structuredClone(universe);
    changed[entity] = [{ id: "new-row", organizationId: "org", budgetId: "other-budget" }];
    const digest = serviceEconomicCensusDigest({ censusVersion: 2, snapshot, universe: changed });
    assert.notEqual(digest, before);
    const f = fixture();
    assert.throws(() => validatePersistedServiceEconomicEvidence(f.record, { ...f.current, censusDigest: digest }), /EVIDENCE_SCOPE_CENSUS_STALE/);
  }
});
