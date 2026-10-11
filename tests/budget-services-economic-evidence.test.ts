import assert from "node:assert/strict";
import { test } from "node:test";
import { serviceEconomicSnapshotSchema } from "../lib/budget-service-contract";
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
    budgetUpdatedAt: at, censusDigest, snapshot: structuredClone(snapshot), members: structuredClone(members),
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
  assert.equal(result.missingAuthority, "FIN_ECONOMIC_ATTESTATION_POLICY_V1");
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
      kind: "COMPONENT_ZERO", applicationId: "service", budgetItemId: null, budgetUpdatedAt: at, censusDigest: serviceEconomicCensusDigest(census),
      expectedEvidenceRevision: previous === 2 ? 1 : previous, rationale: "Internal observation", legacyOverlaps: [],
    }), previous === 2 ? /EVIDENCE_REVISION_STALE/ : /EVIDENCE_REVISION_EXHAUSTED/);
    assert.equal(reads, 3);
  }
});
