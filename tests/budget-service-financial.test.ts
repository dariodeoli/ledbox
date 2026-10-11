import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBudgetServiceFinancial, produceServiceEconomicEvidence, evaluateServiceEconomicPolicy, normalizePfServiceEconomicPolicy, type PfEconomicPolicySupport, type ServiceEconomicNormalizerContext, type ServiceEconomicPolicyV1, type ServiceEconomicFactResolver, type ServiceEconomicEvidenceInput, type ServiceFinancialInput, type RecognizedCostContribution } from "../lib/budget-service-financial";
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

// New evidence-boundary cases; the original twelve calculation cases are retained.
const economicEvidence = (): ServiceEconomicEvidenceInput => ({
  scope: { organizationId: "org", budgetId: "budget", budgetUpdatedAt: "2026-10-10T00:00:00.000Z", contractVersion: 1 },
  budget: { id: "budget", organizationId: "org", eventId: "event", updatedAt: "2026-10-10T00:00:00.000Z", materialCost: 0, laborCost: 30000, costEstimate: 0 },
  supplierJobs: [{ id: "job", organizationId: "org", eventId: "event" }],
  components: [{ id: "service", organizationId: "org", budgetId: "budget", kind: "SERVICE", snapshotVersion: 1, sourceRevision: 2, expectedSourceRevision: 2 }],
  sources: [{ id: "source", organizationId: "org", budgetId: "budget", sourceKind: "SUPPLIER", sourceKey: "job-obligation", supplierJobId: "job",
    incurredAmount: 10000, pendingAmount: 20000, incurredComplete: true, pendingComplete: true }],
  allocations: [{ id: "allocation", organizationId: "org", budgetId: "budget", sourceId: "source", applicationId: "service", budgetItemId: null,
    incurredAmount: 10000, pendingAmount: 20000, incurredComplete: true, pendingComplete: true }],
});

test("economic evidence cannot certify legacy reconciliation despite exact recognized balances", () => {
  const input = economicEvidence(), before = structuredClone(input);
  const result = produceServiceEconomicEvidence(input);
  assert.equal(result.legacyCostsReconciled, false);
  assert.equal(result.costComplete, false);
  assert.equal(result.costCompleteById.service, false);
  assert.deepEqual(result.zeroCostConfirmedIds, []);
  assert.equal(result.contributions.length, 1);
  assert.equal(result.legacyEstimates.laborCost, 30000, "estimate is retained separately, not a second contribution");
  assert.deepEqual(result.provenance[0].allocationIds, ["allocation"]);
  assert.deepEqual(input, before);
});

test("default-zero legacy fields, empty costs and explicit zero balances cannot certify a scoped zero", () => {
  for (const empty of [true, false]) {
    const input = economicEvidence();
    input.budget.laborCost = 0;
    if (empty) { input.sources = []; input.allocations = []; }
    else {
      input.sources[0].incurredAmount = input.sources[0].pendingAmount = 0;
      input.allocations[0].incurredAmount = input.allocations[0].pendingAmount = 0;
    }
    const result = produceServiceEconomicEvidence(input);
    assert.equal(result.costCompleteById.service, false);
    assert.deepEqual(result.zeroCostConfirmedIds, []);
    assert.ok(result.missingAuthority.includes("SCOPED_VERSIONED_COMPONENT_ZERO_COST_ATTESTATION"));
  }
});

test("persisted remaining commitment is not replaced by original job total or legacy amount", () => {
  const input = economicEvidence();
  input.sources[0].incurredAmount = input.allocations[0].incurredAmount = 25000;
  input.sources[0].pendingAmount = input.allocations[0].pendingAmount = 5000;
  const result = produceServiceEconomicEvidence(input);
  assert.deepEqual(result.contributions[0], { sourceId: "source", scopeId: "budget", incurred: 25000, pending: 5000,
    allocations: [{ componentId: "service", incurred: 25000, pending: 5000 }] });
  input.sources[0].pendingAmount = input.allocations[0].pendingAmount = null;
  input.sources[0].pendingComplete = input.allocations[0].pendingComplete = false;
  const unknown = produceServiceEconomicEvidence(input);
  assert.equal(unknown.contributions[0].pending, null);
  assert.equal(unknown.residuals[0].pending, null);
  assert.deepEqual(unknown.incompleteSourceIds, ["source"]);
});

test("evidence rejects stale locked-budget version and cross-tenant/budget component or record", () => {
  const mutations: ((input: ServiceEconomicEvidenceInput) => void)[] = [
    input => { input.budget.updatedAt = "2026-10-11T00:00:00.000Z"; },
    input => { input.budget.organizationId = "foreign"; },
    input => { input.components[0].budgetId = "foreign"; },
    input => { input.sources[0].organizationId = "foreign"; },
    input => { input.allocations[0].budgetId = "foreign"; },
    input => { input.components[0].expectedSourceRevision = 3; },
  ];
  for (const mutate of mutations) { const input = economicEvidence(); mutate(input); assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_.*(MISMATCH|VERSION_INVALID)/); }
});

test("supplier commitment cannot reappear under a second source identity or obligation key", () => {
  for (const sourceKey of ["job-obligation", "alternate-key"]) {
    const input = economicEvidence();
    input.sources.push({ ...input.sources[0], id: "second-source", sourceKey });
    assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_DUPLICATE_OBLIGATION/);
  }
});

test("supplier reference requires real same-company job and matching event, never a name-only claim", () => {
  const mutations: ((input: ServiceEconomicEvidenceInput) => void)[] = [
    input => { input.supplierJobs = []; },
    input => { input.supplierJobs[0].organizationId = "foreign"; },
    input => { input.supplierJobs[0].eventId = "foreign-event"; },
    input => { input.budget.eventId = null; },
  ];
  for (const mutate of mutations) { const input = economicEvidence(); mutate(input); assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_SUPPLIER_SCOPE_INVALID/); }
});

test("extra authority claims cannot elevate computed completeness or confirm a zero", () => {
  const result = produceServiceEconomicEvidence({ ...economicEvidence(),
    legacyCostsReconciled: true, zeroCostConfirmedIds: ["service"], costComplete: true,
  } as ServiceEconomicEvidenceInput);
  assert.equal(result.legacyCostsReconciled, false);
  assert.deepEqual(result.zeroCostConfirmedIds, []);
  assert.equal(result.costCompleteById.service, false);
});

test("typed equipment destination cannot masquerade as service allocation evidence", () => {
  const input = economicEvidence();
  input.components = [{ id: "equipment", organizationId: "org", budgetId: "budget", kind: "EQUIPMENT", snapshotVersion: null, sourceRevision: null, expectedSourceRevision: null }];
  input.allocations[0].applicationId = "equipment";
  assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_ALLOCATION_SCOPE_INVALID/);
  input.allocations[0].applicationId = null; input.allocations[0].budgetItemId = "equipment";
  assert.equal(produceServiceEconomicEvidence(input).costCompleteById.equipment, false);
  input.components[0].sourceRevision = 1;
  assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_COMPONENT_VERSION_INVALID/);
});

test("source residue and unassigned obligations survive evidence production privately", () => {
  const input = economicEvidence();
  input.allocations[0].incurredAmount = 5000;
  const result = produceServiceEconomicEvidence(input);
  assert.deepEqual(result.residuals[0], { sourceId: "source", incurred: 5000, pending: 0 });
  input.allocations = [];
  const unassigned = produceServiceEconomicEvidence(input);
  assert.deepEqual(unassigned.contributions, []);
  assert.deepEqual(unassigned.residuals[0], { sourceId: "source", incurred: 10000, pending: 20000 });
  assert.equal(unassigned.provenance[0].sourceId, "source");
  assert.equal(unassigned.costCompleteById.service, false);
});

test("unknown source cannot authorize a known allocation and incomplete flags cannot claim known null", () => {
  const input = economicEvidence();
  input.sources[0].pendingAmount = null; input.sources[0].pendingComplete = false;
  input.allocations[0].pendingAmount = 0;
  assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_UNKNOWN_SOURCE_ALLOCATION/);
  input.sources[0].pendingComplete = true;
  assert.throws(() => produceServiceEconomicEvidence(input), /EVIDENCE_BALANCE_COMPLETENESS_INVALID/);
});

// Policy fixtures model independently validated internal facts ONLY for unit
// contracts. They do not certify persisted data, DB closure, or production cost.
function economicPolicyFixture(input = economicEvidence()) {
  const censusDigest = "a".repeat(64);
  const facts = new Map<string, NonNullable<ReturnType<ServiceEconomicFactResolver>>>();
  const internalRecordDigests = new Map<string, string>();
  const record = (id: string, kind: NonNullable<ReturnType<ServiceEconomicFactResolver>>["kind"], statement: unknown) => {
    const recordId = `semantic-source:${id}`, rowDigest = "b".repeat(64);
    internalRecordDigests.set(`Budget:${recordId}`, rowDigest);
    facts.set(id, { id, kind, statement, organizationId: input.scope.organizationId, budgetId: input.scope.budgetId,
      budgetUpdatedAt: input.scope.budgetUpdatedAt, censusDigest, actorId: "finance-actor", actionId: `internal-action:${id}`,
      censusVersion: 2, originRecords: [{ entity: "Budget", recordId, rowDigest }] });
    return id;
  };
  const fields = ["materialCost", "laborCost", "costEstimate"] as const;
  const policy: ServiceEconomicPolicyV1 = {
    policyVersion: 1, censusVersion: 2, scope: { organizationId: input.scope.organizationId, budgetId: input.scope.budgetId, budgetUpdatedAt: input.scope.budgetUpdatedAt, censusDigest },
    legacyDispositionByField: {
      materialCost: { fieldValue: input.budget.materialCost, disposition: "ESTIMATE_ONLY", originProofId: null, slices: [] },
      laborCost: { fieldValue: input.budget.laborCost, disposition: "ESTIMATE_ONLY", originProofId: null, slices: [] },
      costEstimate: { fieldValue: input.budget.costEstimate, disposition: "ESTIMATE_ONLY", originProofId: null, slices: [] },
    },
    componentObligationClosure: input.components.map(component => ({ componentId: component.id,
      domains: (["SERVICE", "LABOR", "EQUIPMENT_MATERIAL", "SUPPLIER", "EXPENSE_TREASURY"] as const).map(domain => {
        const allocationIds = domain === "SUPPLIER" ? input.allocations.filter(row => (row.applicationId ?? row.budgetItemId) === component.id).map(row => row.id) : [];
        const status = allocationIds.length ? "RECOGNIZED" as const : "VERIFIED_NOT_APPLICABLE" as const;
        return { domain, status, allocationIds, proofId: record(`closure:${component.id}:${domain}`, "DOMAIN_CLOSURE", {
          componentId: component.id, domain, status, allocationIds: [...allocationIds].sort(),
          sourceIds: [...new Set(allocationIds.map(id => input.allocations.find(row => row.id === id)!.sourceId))].sort(),
          componentVersion: { id: component.id, sourceRevision: component.sourceRevision, snapshotVersion: component.snapshotVersion },
        }) };
      }) })),
  };
  for (const field of fields) policy.legacyDispositionByField[field].originProofId = record(`origin:${field}`, "ESTIMATE_ORIGIN",
    { field, fieldValue: input.budget[field], disposition: "ESTIMATE_ONLY" });
  return { input, policy, facts, record, context: { censusDigest, internalRecordDigests, resolveInternalFact: (id: string) => facts.get(id) ?? null } };
}

test("policy contract can reconcile independently supported estimates and all five closed domains", () => {
  const fixture = economicPolicyFixture();
  const result = evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context);
  assert.equal(result.legacyCostsReconciled, true);
  assert.equal(result.costCompleteById.service, true);
  assert.deepEqual(result.zeroCostConfirmedIds, []);
  assert.equal(result.contributions[0].pending, 20000);
  assert.deepEqual(result.policyReasons, []);
});

test("policy absence or PF integrity-only observation reports missing semantic support without zero inference", () => {
  const fixture = economicPolicyFixture();
  for (const policy of [undefined, { integrityValidated: true, rationale: "reviewed", legacyCostsReconciled: true, censusDigest: fixture.context.censusDigest }]) {
    const result = evaluateServiceEconomicPolicy(fixture.input, policy, fixture.context);
    assert.equal(result.legacyCostsReconciled, false);
    assert.deepEqual(result.zeroCostConfirmedIds, []);
    assert.ok(result.policyReasons.includes("LEGACY_DISPOSITION_BY_FIELD_MISSING_OR_INVALID"));
    assert.equal(result.contributions[0].incurred, 10000);
  }
});

test("policy cannot accept raw support, audit-only provenance, stale scope or forged origin statement", () => {
  const fixture = economicPolicyFixture();
  assert.equal(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, { censusDigest: fixture.context.censusDigest }).legacyCostsReconciled, false);
  fixture.facts.get("origin:laborCost")!.originRecords = [];
  assert.equal(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).legacyCostsReconciled, false);
  fixture.facts.get("origin:laborCost")!.originRecords = [{ entity: "AuditLog", recordId: "audit", rowDigest: "b".repeat(64) }];
  assert.equal(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).legacyCostsReconciled, false);
  fixture.facts.get("origin:laborCost")!.originRecords = [{ entity: "Budget", recordId: "semantic-source:origin:laborCost", rowDigest: "b".repeat(64) }];
  fixture.context.internalRecordDigests.delete("Budget:semantic-source:origin:laborCost");
  assert.equal(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).legacyCostsReconciled, false);
  fixture.context.internalRecordDigests.set("Budget:semantic-source:origin:laborCost", "b".repeat(64));
  fixture.facts.get("origin:laborCost")!.statement = { field: "laborCost", fieldValue: 0, disposition: "ESTIMATE_ONLY" };
  assert.equal(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).legacyCostsReconciled, false);
  fixture.policy.scope.budgetUpdatedAt = "2026-10-11T00:00:00.000Z";
  assert.ok(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).policyReasons.includes("POLICY_SCOPE_CENSUS_STALE"));
});

test("zero with no allocations requires independently supported absence closure for every domain", () => {
  const input = economicEvidence(); input.sources = []; input.allocations = []; input.budget.laborCost = 0;
  const fixture = economicPolicyFixture(input);
  assert.deepEqual(evaluateServiceEconomicPolicy(input, fixture.policy, fixture.context).zeroCostConfirmedIds, ["service"]);
  fixture.facts.delete("closure:service:LABOR");
  assert.deepEqual(evaluateServiceEconomicPolicy(input, fixture.policy, fixture.context).zeroCostConfirmedIds, []);
  fixture.policy.componentObligationClosure[0].domains.pop();
  assert.ok(evaluateServiceEconomicPolicy(input, fixture.policy, fixture.context).policyReasons.includes("CLOSURE_UNIVERSE_INCOMPLETE:service"));
});

test("explicit source zero and exact assignments still fail without supported universe; residual or unknown remains partial", () => {
  const fixture = economicPolicyFixture();
  fixture.input.allocations[0].incurredAmount = 5000;
  const residual = evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context);
  assert.equal(residual.legacyCostsReconciled, false);
  assert.equal(residual.residuals[0].incurred, 5000);
  fixture.input.sources[0].pendingAmount = fixture.input.allocations[0].pendingAmount = null;
  fixture.input.sources[0].pendingComplete = fixture.input.allocations[0].pendingComplete = false;
  const unknown = evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context);
  assert.equal(unknown.contributions[0].pending, null);
  assert.ok(unknown.policyReasons.includes("RECOGNIZED_SOURCE_PARTIAL_UNKNOWN_OR_RESIDUAL"));
  const zero = economicEvidence(); zero.budget.laborCost = 0;
  zero.sources[0].incurredAmount = zero.sources[0].pendingAmount = 0;
  zero.allocations[0].incurredAmount = zero.allocations[0].pendingAmount = 0;
  const supported = economicPolicyFixture(zero);
  supported.policy.componentObligationClosure[0].domains = [];
  assert.deepEqual(evaluateServiceEconomicPolicy(zero, supported.policy, supported.context).zeroCostConfirmedIds, []);
});

test("recognized partitions reconcile exact declared cross-field representations only, never add legacy twice", () => {
  const fixture = economicPolicyFixture(); fixture.input.budget.materialCost = 30000;
  const fields = ["materialCost", "laborCost"] as const;
  for (const field of fields) {
    const slice = { sourceId: "source", allocationId: "allocation", incurred: 10000, pending: 20000,
      domain: "SUPPLIER" as const, overlapGroup: "same-obligation-representation", proofId: `slice:${field}` };
    fixture.policy.legacyDispositionByField[field] = { fieldValue: 30000, disposition: "REPRESENTED_BY_RECOGNIZED_SOURCES", originProofId: null, slices: [slice] };
    fixture.record(slice.proofId, "RECOGNIZED_SLICE", { field, fieldValue: 30000, sourceId: slice.sourceId, allocationId: slice.allocationId,
      incurred: slice.incurred, pending: slice.pending, domain: slice.domain, overlapGroup: slice.overlapGroup });
  }
  const result = evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context);
  assert.equal(result.legacyCostsReconciled, true);
  assert.equal(result.contributions.length, 1);
  fixture.policy.legacyDispositionByField.laborCost.slices[0].overlapGroup = null;
  assert.ok(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).policyReasons.includes("LEGACY_OVERLAP_UNDECLARED_OR_PARTIAL"));
});

test("legacy partition mismatches, duplicate slices and domain coverage gaps cannot certify reconciliation", () => {
  const fixture = economicPolicyFixture();
  fixture.policy.legacyDispositionByField.laborCost = { fieldValue: 30000, disposition: "REPRESENTED_BY_RECOGNIZED_SOURCES", originProofId: null,
    slices: [{ sourceId: "source", allocationId: "allocation", incurred: 10000, pending: 10000, domain: "SUPPLIER", overlapGroup: null, proofId: "unproven" }] };
  assert.ok(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).policyReasons.includes("LEGACY_PARTITION_AMOUNT_MISMATCH:laborCost"));
  fixture.policy.legacyDispositionByField.laborCost.slices.push(fixture.policy.legacyDispositionByField.laborCost.slices[0]);
  assert.ok(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).policyReasons.includes("LEGACY_DUPLICATE_SLICE:laborCost"));
  fixture.policy.componentObligationClosure[0].domains.find(row => row.domain === "SUPPLIER")!.allocationIds = [];
  assert.ok(evaluateServiceEconomicPolicy(fixture.input, fixture.policy, fixture.context).policyReasons.includes("CLOSURE_UNIVERSE_INCOMPLETE:service"));
});

// New PF->FIN shape boundary fixtures. No semantic provider or DB proof is minted.
function pfNormalizerFixture() {
  const snapshot = economicEvidence();
  const references = (["ESTIMATE_ORIGIN", "RECOGNIZED_OBLIGATION", "BUDGET_ATTRIBUTION", "DOMAIN_OPERATIONAL_CLOSURE", "NOT_APPLICABLE_FOR_EXECUTION"] as const)
    .map(fact => ({ entity: "Budget" as const, recordId: "budget", rowDigest: "b".repeat(64), fact }));
  const support: PfEconomicPolicySupport = { policyVersion: 1, censusVersion: 2,
    legacyDispositionByField: (["materialCost", "laborCost", "costEstimate"] as const).map(field => ({ field,
      fieldValue: snapshot.budget[field], state: "ESTIMATE_ONLY" as const, origin: "PERSISTED_ESTIMATE_DECLARATION" as const, factReferences: references })),
    overlaps: [], componentObligationClosure: [{ applicationId: "service", budgetItemId: null,
      domains: (["SERVICE", "LABOR", "EQUIPMENT_MATERIAL", "SUPPLIER", "EXPENSE_TREASURY"] as const).map(domain => domain === "SUPPLIER"
        ? { domain, state: "RECOGNIZED" as const, sourceIds: ["source"], allocationIds: ["allocation"], factReferences: references }
        : { domain, state: "VERIFIED_NOT_APPLICABLE" as const, factReferences: references }) }],
  };
  const current: ServiceEconomicNormalizerContext = { organizationId: "org", budgetId: "budget", budgetUpdatedAt: snapshot.scope.budgetUpdatedAt,
    censusVersion: 2, censusDigest: "a".repeat(64), currentRecordMap: new Map([["Budget:budget", { rowDigest: "b".repeat(64), organizationId: "org", budgetId: "budget", eventId: "event" }]]) };
  return { snapshot, support, current, references };
}

test("PF array/state shape maps to strict FIN object/disposition without creating proof handles", () => {
  const fixture = pfNormalizerFixture();
  const result = normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current);
  assert.ok(result.policy);
  assert.equal(result.policy.legacyDispositionByField.laborCost.fieldValue, 30000);
  assert.equal(result.policy.legacyDispositionByField.laborCost.disposition, "ESTIMATE_ONLY");
  assert.equal(result.policy.legacyDispositionByField.laborCost.originProofId, null);
  assert.equal(result.policy.componentObligationClosure[0].domains[3].status, "RECOGNIZED");
  assert.equal(result.authorityStatus, "STRUCTURAL_ONLY");
  assert.equal(result.evaluation.legacyCostsReconciled, false);
  assert.deepEqual(result.evaluation.zeroCostConfirmedIds, []);
  assert.ok(result.normalizationReasons.includes("AUTHENTIC_SEMANTIC_FACT_PROVIDER_MISSING"));
  assert.deepEqual(result.evaluation.contributions, produceServiceEconomicEvidence(fixture.snapshot).contributions);
});

test("missing internal map or historical null support stays structural and preserves known/null balances", () => {
  const fixture = pfNormalizerFixture();
  fixture.current.currentRecordMap = undefined;
  fixture.snapshot.sources[0].pendingAmount = fixture.snapshot.allocations[0].pendingAmount = null;
  fixture.snapshot.sources[0].pendingComplete = fixture.snapshot.allocations[0].pendingComplete = false;
  const result = normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current);
  assert.ok(result.normalizationReasons.includes("CURRENT_INTERNAL_RECORD_MAP_MISSING"));
  assert.equal(result.evaluation.contributions[0].pending, null);
  assert.equal(result.evaluation.residuals[0].pending, null);
  assert.equal(result.evaluation.costComplete, false);
  const historical = normalizePfServiceEconomicPolicy(fixture.snapshot, null, fixture.current);
  assert.deepEqual(historical.normalizationReasons, ["PF_POLICY_SUPPORT_MISSING"]);
});

test("raw body facts, unexpected versions and non-bijective field shapes cannot cross normalization", () => {
  const fixture = pfNormalizerFixture();
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, { ...fixture.support, resolveInternalFact: true, legacyCostsReconciled: true }, fixture.current));
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, { ...fixture.support, censusVersion: 3 }, fixture.current));
  const auditOnly = { ...fixture.support, legacyDispositionByField: [{ field: "materialCost", fieldValue: 0, state: "ESTIMATE_ONLY", origin: "PERSISTED_ESTIMATE_DECLARATION",
    factReferences: [{ entity: "AuditLog", recordId: "audit", rowDigest: "b".repeat(64), fact: "ESTIMATE_ORIGIN" }] }, ...fixture.support.legacyDispositionByField.slice(1)] };
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, auditOnly, fixture.current));
  fixture.support.legacyDispositionByField[1] = fixture.support.legacyDispositionByField[0];
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_LEGACY_FIELDS_NOT_BIJECTIVE/);
});

test("typed closure, source IDs and fresh reference scope must match actual internal snapshot", () => {
  const fixture = pfNormalizerFixture();
  fixture.support.componentObligationClosure[0].applicationId = null;
  fixture.support.componentObligationClosure[0].budgetItemId = "service";
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_TYPED_COMPONENT_INVALID/);
  fixture.support.componentObligationClosure[0].applicationId = "service"; fixture.support.componentObligationClosure[0].budgetItemId = null;
  const supplier = fixture.support.componentObligationClosure[0].domains.find(row => row.state === "RECOGNIZED")!;
  if (supplier.state !== "RECOGNIZED") assert.fail();
  supplier.sourceIds = ["other-source"];
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_DOMAIN_SOURCE_IDS_MISMATCH/);
  supplier.sourceIds = ["source"];
  fixture.current.currentRecordMap = new Map([["Budget:budget", { rowDigest: "b".repeat(64), organizationId: "other-company", budgetId: "budget", eventId: "event" }]]);
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_REFERENCE_SCOPE_OR_DIGEST_STALE/);
});

test("declared cross-field slices map incurred/pending only with exact unique overlap pairs", () => {
  const fixture = pfNormalizerFixture(); fixture.snapshot.budget.materialCost = 30000;
  for (const field of ["materialCost", "laborCost"] as const) {
    fixture.support.legacyDispositionByField[field === "materialCost" ? 0 : 1] = { field, fieldValue: 30000, state: "REPRESENTED_BY_RECOGNIZED_SOURCES",
      slices: [{ id: `slice:${field}`, sourceId: "source", allocationId: "allocation", domain: "SUPPLIER", incurredAmount: 10000, pendingAmount: 20000, factReferences: fixture.references }] };
  }
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_OVERLAP_DECLARATION_INCOMPLETE/);
  fixture.support.overlaps = [{ leftField: "materialCost", leftSliceId: "slice:materialCost", rightField: "laborCost", rightSliceId: "slice:laborCost" }];
  const result = normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current);
  assert.ok(result.policy);
  const slice = result.policy.legacyDispositionByField.laborCost.slices[0];
  assert.equal(slice.incurred, 10000); assert.equal(slice.pending, 20000); assert.equal(slice.proofId, null);
  assert.equal(result.evaluation.contributions.length, 1);
  assert.equal(result.authorityStatus, "STRUCTURAL_ONLY");
  fixture.support.overlaps.push(fixture.support.overlaps[0]);
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_OVERLAP_AMBIGUOUS_OR_NONBIJECTIVE/);
});

test("stale budget/component revisions and missing domain coverage are rejected before claims can elevate", () => {
  const fixture = pfNormalizerFixture();
  fixture.current.budgetUpdatedAt = "2026-10-11T00:00:00.000Z";
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_SCOPE_CENSUS_STALE/);
  fixture.current.budgetUpdatedAt = fixture.snapshot.scope.budgetUpdatedAt;
  fixture.snapshot.components[0].expectedSourceRevision = 3;
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /EVIDENCE_COMPONENT_VERSION_INVALID/);
  fixture.snapshot.components[0].expectedSourceRevision = 2;
  fixture.support.componentObligationClosure[0].domains[0] = fixture.support.componentObligationClosure[0].domains[1];
  assert.throws(() => normalizePfServiceEconomicPolicy(fixture.snapshot, fixture.support, fixture.current), /NORMALIZER_DOMAIN_CENSUS_INCOMPLETE/);
});
