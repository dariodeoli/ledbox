import { BudgetCalculationError, calculateBudgetCommercial, type CommercialLine } from "./budget-commercial-calculation";
import type { BudgetCommercialTerms } from "./budget-commercial-contract";
import { BUDGET_INT_MAX } from "./budget-payment-plan";
import { grossToNet, isInvoiceTaxType, type InvoiceTaxTypeValue } from "./fiscal";
import { z } from "zod";
import { canonicalJson } from "./server/signature/hash";

/** Private calculation input, NOT a persistence or public DTO. PF maps validated
 * same-company applications/coverage under the existing commercial lock later.
 * Costs must never be serialized through a public commercial projection.
 */
export type ServiceFinancialInput = {
  id: string;
  sortOrder: number | null;
  serviceClass: "TRANSPORT" | "INSTALLATION" | "GUARD" | "PROMOTER";
  inclusion: "INCLUDED_CHARGED" | "INCLUDED_FREE" | "NOT_INCLUDED";
  floorApplicability: "CHARGED_ONLY";
  taxType: InvoiceTaxTypeValue;
  modality: "PERSON_DAY" | "FIXED_EVENT";
  people: number | null;
  serviceDays: number | null;
  contextualServiceDays: number | null;
  /** Conserved effective-front snapshot; null is absence, zero is explicit. */
  tariff: {
    front: "FINAL" | "WHOLESALE";
    normalPrice: number | null;
    fromDays: number | null;
    fromPrice: number | null;
    minimumPrice: number | null;
  };
  /** Per person-day in PERSON_DAY; per execution in FIXED_EVENT. */
  overridePrice: number | null;
  discountMode: "AMOUNT" | "PERCENT" | null;
  discountValue: number | null;
  /** Explicit completeness, independent of inclusion/execution and known sum. */
  costComplete: boolean;
};

export type EquipmentFinancialInput = {
  line: CommercialLine;
  taxType: InvoiceTaxTypeValue;
  costComplete: boolean;
};

/** One normalized obligation+scope, not a SupplierJob copy. Incurred and pending
 * are disjoint recognized balances. One allocation per component per source.
 * Include equipment allocations here too when they share the same obligation;
 * do not add those balances again as legacy laborCost.
 */
export type RecognizedCostContribution = {
  sourceId: string;
  scopeId: string;
  incurred: number | null;
  pending: number | null;
  allocations: { componentId: string; incurred: number | null; pending: number | null }[];
};

const fail = (message: string): never => { throw new BudgetCalculationError(message); };
function amount(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > BUDGET_INT_MAX) fail("Importe de servicio inválido o fuera del límite Int.");
  return value;
}
function intAmount(value: bigint) {
  if (value < BigInt(0) || value > BigInt(BUDGET_INT_MAX)) fail("El cálculo de servicios supera el límite Int.");
  return Number(value);
}
function count(value: number | null) {
  if (value === null || !Number.isInteger(value) || value < 1 || value > 9999) fail("Personas o días propios deben ser enteros entre 1 y 9999.");
  return value as number;
}

function serviceLine(service: ServiceFinancialInput): CommercialLine {
  if (!["TRANSPORT", "INSTALLATION", "GUARD", "PROMOTER"].includes(service.serviceClass)
    || !["INCLUDED_CHARGED", "INCLUDED_FREE", "NOT_INCLUDED"].includes(service.inclusion)
    || service.floorApplicability !== "CHARGED_ONLY") fail("Clase, inclusión o aplicabilidad de piso inválida.");
  if (typeof service.costComplete !== "boolean") fail("La completitud del costo debe ser explícita.");
  const { tariff } = service;
  if (tariff.front !== "FINAL" && tariff.front !== "WHOLESALE") fail("El frente efectivo debe ser explícito.");
  for (const value of [tariff.normalPrice, tariff.fromPrice, tariff.minimumPrice, service.overridePrice]) {
    if (value !== null) amount(value);
  }
  const threshold = tariff.fromDays === null ? null : count(tariff.fromDays);
  if (threshold === null && tariff.fromPrice !== null) fail("Una tarifa por tramo requiere umbral explícito.");
  let quantity: number;
  let days: number;
  let selectorDays: number | null;
  if (service.modality === "PERSON_DAY") {
    if (service.serviceClass === "TRANSPORT" || service.serviceClass === "INSTALLATION") fail("Traslado e instalación requieren importe fijo por ejecución.");
    if (service.contextualServiceDays !== null) fail("El brazo variable no admite días contextuales del brazo fijo.");
    quantity = count(service.people);
    days = count(service.serviceDays);
    selectorDays = days;
  } else if (service.modality === "FIXED_EVENT") {
    if (service.people !== null || service.serviceDays !== null) fail("El brazo fijo exige personas y días variables nulos.");
    quantity = 1;
    days = 1;
    selectorDays = service.contextualServiceDays === null ? null : count(service.contextualServiceDays);
    if (threshold !== null && selectorDays === null) fail("El tramo fijo requiere días contextuales explícitos.");
  } else {
    return fail("Modalidad de servicio inválida.");
  }
  const configured = threshold !== null && selectorDays !== null && selectorDays >= threshold ? tariff.fromPrice : tariff.normalPrice;
  const price = service.overridePrice ?? configured;
  const excluded = service.inclusion !== "INCLUDED_CHARGED";
  if (!excluded && (price === null || tariff.minimumPrice === null)) fail("Un cargo requiere precio y mínimo explícitos acreditados.");
  // Resolve the service's own selector first. MANUAL here is an internal bridge
  // to the existing allocator, not a persisted price-mode change or lost floor.
  // Excluded zero placeholders only reach the allocator, never the snapshot.
  return {
    id: service.id, sortOrder: service.sortOrder, quantity, days,
    unitPrice: price ?? 0, minimumPrice: tariff.minimumPrice,
    priceMode: "MANUAL", tariffSnapshot: null, excluded,
    discountMode: service.discountMode, discountValue: service.discountValue,
    discountAmount: service.discountMode === null ? null : 0,
  };
}

function recognizedCosts(components: { id: string; complete: boolean }[], contributions: RecognizedCostContribution[]) {
  const costs = new Map(components.map((component) => [component.id, { knownAmount: BigInt(0), complete: component.complete }]));
  const sources = new Set<string>();
  for (const contribution of contributions) {
    if (!contribution.sourceId || !contribution.scopeId) fail("El costo requiere identidad de fuente y alcance.");
    const key = JSON.stringify([contribution.sourceId, contribution.scopeId]);
    if (sources.has(key)) fail("Una obligación y alcance no pueden contarse dos veces.");
    sources.add(key);
    for (const value of [contribution.incurred, contribution.pending]) if (value !== null) amount(value);
    if (contribution.incurred !== null && contribution.pending !== null) intAmount(BigInt(contribution.incurred) + BigInt(contribution.pending));
    const allocations = new Set<string>();
    let incurred = BigInt(0);
    let pending = BigInt(0);
    let allIncurredKnown = true;
    let allPendingKnown = true;
    for (const allocation of contribution.allocations) {
      const cost = costs.get(allocation.componentId);
      if (!cost || allocations.has(allocation.componentId)) fail("Asignación de costo desconocida o repetida.");
      allocations.add(allocation.componentId);
      for (const value of [allocation.incurred, allocation.pending]) if (value !== null) amount(value);
      incurred += BigInt(allocation.incurred ?? 0);
      pending += BigInt(allocation.pending ?? 0);
      allIncurredKnown &&= allocation.incurred !== null;
      allPendingKnown &&= allocation.pending !== null;
      cost.knownAmount += BigInt(allocation.incurred ?? 0) + BigInt(allocation.pending ?? 0);
      cost.complete &&= allocation.incurred !== null && allocation.pending !== null && contribution.incurred !== null && contribution.pending !== null;
    }
    if ((contribution.incurred !== null && incurred > BigInt(contribution.incurred))
      || (contribution.pending !== null && pending > BigInt(contribution.pending))) fail("Las asignaciones superan el saldo reconocido de la obligación.");
    // Unassigned or unknown remainder cannot disappear from a complete margin.
    const complete = contribution.incurred !== null && contribution.pending !== null
      && allIncurredKnown && allPendingKnown
      && incurred === BigInt(contribution.incurred) && pending === BigInt(contribution.pending);
    if (!complete) for (const allocation of contribution.allocations) costs.get(allocation.componentId)!.complete = false;
    if (contribution.allocations.length === 0) fail("Una contribución debe asignarse explícitamente a componentes del cálculo.");
  }
  return costs;
}

/** Pure/private adapter. No DB, HTTP, provider, ledger write or public projection.
 * PF's DTO/version/transactional mapping is intentionally a separate dependency.
 */
export function calculateBudgetServiceFinancial(input: {
  equipment: EquipmentFinancialInput[];
  services: ServiceFinancialInput[];
  contributions: RecognizedCostContribution[];
  taxType: InvoiceTaxTypeValue;
  terms: BudgetCommercialTerms;
  legacyDiscount: number;
  fixedAdvance: number;
}) {
  if (!isInvoiceTaxType(input.taxType)) fail("El IVA del presupuesto debe ser explícito.");
  for (const component of [...input.equipment, ...input.services]) {
    if (!isInvoiceTaxType(component.taxType) || component.taxType !== input.taxType) fail("Los componentes requieren IVA explícito homogéneo.");
    if (typeof component.costComplete !== "boolean") fail("La completitud del costo debe ser explícita.");
  }
  const lines = [...input.equipment.map((equipment) => equipment.line), ...input.services.map(serviceLine)];
  const commercial = calculateBudgetCommercial(lines, input.terms, input.legacyDiscount, input.fixedAdvance);
  const costs = recognizedCosts([
    ...input.equipment.map(({ line, costComplete }) => ({ id: line.id, complete: costComplete })),
    ...input.services.map(({ id, costComplete }) => ({ id, complete: costComplete })),
  ], input.contributions);
  const items = commercial.items.map((item) => {
    const cost = costs.get(item.id)!;
    const sale = item.subtotal - item.globalDiscountAmount;
    const knownCost = intAmount(cost.knownAmount);
    const margin = cost.complete ? sale - knownCost : null;
    return {
      id: item.id, sale, ...grossToNet(sale, input.taxType),
      knownCost, costComplete: cost.complete, effectiveCost: cost.complete ? knownCost : null,
      margin, marginPercent: margin === null || sale === 0 ? null : margin * 100 / sale,
    };
  });
  const knownCost = intAmount(items.reduce((sum, item) => sum + BigInt(item.knownCost), BigInt(0)));
  const costComplete = items.every((item) => item.costComplete);
  const margin = costComplete ? commercial.total - knownCost : null;
  return {
    commercial, items, knownCost, costComplete, effectiveCost: costComplete ? knownCost : null,
    margin, marginPercent: margin === null || commercial.total === 0 ? null : margin * 100 / commercial.total,
  };
}

/** Private server projections of persisted PF cost rows; not HTTP authority.
 * No PF runtime import: the dependency must be checked before a loader is wired.
 * Budget.updatedAt binds the locked read; component revisions bind retained
 * service snapshots. Equipment descriptors are scoped through their Budget FK.
 */
export type ServiceEconomicEvidenceInput = {
  scope: { organizationId: string; budgetId: string; budgetUpdatedAt: string; contractVersion: 1 };
  budget: { id: string; organizationId: string; eventId: string | null; updatedAt: string; materialCost: number; laborCost: number; costEstimate: number };
  supplierJobs: { id: string; organizationId: string; eventId: string | null }[];
  components: { id: string; organizationId: string; budgetId: string; kind: "SERVICE" | "EQUIPMENT";
    snapshotVersion: 1 | null; sourceRevision: number | null; expectedSourceRevision: number | null }[];
  sources: {
    id: string; organizationId: string; budgetId: string;
    sourceKind: "SERVICE" | "LABOR" | "SUPPLIER" | "EQUIPMENT";
    sourceKey: string; supplierJobId: string | null;
    incurredAmount: number | null; pendingAmount: number | null;
    incurredComplete: boolean; pendingComplete: boolean;
  }[];
  allocations: {
    id: string; organizationId: string; budgetId: string; sourceId: string;
    applicationId: string | null; budgetItemId: string | null;
    incurredAmount: number | null; pendingAmount: number | null;
    incurredComplete: boolean; pendingComplete: boolean;
  }[];
};

/** Produce recognized balances once per obligation/scope, never estimate them
 * from SupplierJob.total/advance/paidAt or Budget laborCost/costPrice. pending
 * means the persisted remaining recognized commitment, NOT original total.
 *
 * Missing authority is intentional: Budget's default-zero estimates and PF
 * source/allocation flags do not persist a reconciled legacy census or a scoped,
 * versioned zero-cost attestation. Until those records exist, this producer cannot
 * assert legacyCostsReconciled or confirm a zero, even with exact/full balances.
 * Caller retains unallocated known amounts privately; do not add them to FIN
 * assigned knownCost or add legacy/SupplierJob totals a second time.
 */
export function produceServiceEconomicEvidence(input: ServiceEconomicEvidenceInput) {
  const { scope, budget } = input;
  const identity = (value: string) => { if (typeof value !== "string" || !value.trim()) fail("EVIDENCE_IDENTITY_INVALID"); };
  identity(scope.organizationId); identity(scope.budgetId);
  const validRevision = (value: number) => Number.isInteger(value) && value >= 1 && value <= BUDGET_INT_MAX;
  if (scope.contractVersion !== 1 || budget.id !== scope.budgetId || budget.organizationId !== scope.organizationId
    || !Number.isFinite(Date.parse(scope.budgetUpdatedAt)) || budget.updatedAt !== scope.budgetUpdatedAt) fail("EVIDENCE_SCOPE_VERSION_MISMATCH");
  for (const value of [budget.materialCost, budget.laborCost, budget.costEstimate]) amount(value);
  const scoped = (row: { organizationId: string; budgetId: string }) => {
    if (row.organizationId !== scope.organizationId || row.budgetId !== scope.budgetId) fail("EVIDENCE_SCOPE_VERSION_MISMATCH");
  };
  const components = new Set<string>();
  const componentKinds = new Map<string, "SERVICE" | "EQUIPMENT">();
  for (const component of input.components) {
    identity(component.id); scoped(component);
    // BudgetItem has no service revision/version. Do not synthesize revision1.
    const versionValid = component.kind === "EQUIPMENT"
      ? component.snapshotVersion === null && component.sourceRevision === null && component.expectedSourceRevision === null
      : component.kind === "SERVICE" && component.snapshotVersion === 1 && component.sourceRevision !== null
        && validRevision(component.sourceRevision) && component.sourceRevision === component.expectedSourceRevision;
    if (components.has(component.id) || !versionValid) fail("EVIDENCE_COMPONENT_VERSION_INVALID");
    components.add(component.id);
    componentKinds.set(component.id, component.kind);
  }
  const sources = new Map<string, ServiceEconomicEvidenceInput["sources"][number]>();
  const obligations = new Set<string>(), supplierJobs = new Set<string>();
  const persistedJobs = new Map<string, ServiceEconomicEvidenceInput["supplierJobs"][number]>();
  for (const job of input.supplierJobs) {
    identity(job.id);
    if (job.organizationId !== scope.organizationId || persistedJobs.has(job.id)) fail("EVIDENCE_SUPPLIER_SCOPE_INVALID");
    persistedJobs.set(job.id, job);
  }
  const balances = (row: { incurredAmount: number | null; pendingAmount: number | null; incurredComplete: boolean; pendingComplete: boolean }) => {
    if (typeof row.incurredComplete !== "boolean" || typeof row.pendingComplete !== "boolean"
      || (row.incurredComplete && row.incurredAmount === null) || (row.pendingComplete && row.pendingAmount === null)) fail("EVIDENCE_BALANCE_COMPLETENESS_INVALID");
    for (const value of [row.incurredAmount, row.pendingAmount]) if (value !== null) amount(value);
    if (row.incurredAmount !== null && row.pendingAmount !== null) intAmount(BigInt(row.incurredAmount) + BigInt(row.pendingAmount));
  };
  for (const source of input.sources) {
    identity(source.id); identity(source.sourceKey); scoped(source); balances(source);
    if (!["SERVICE", "LABOR", "SUPPLIER", "EQUIPMENT"].includes(source.sourceKind)
      || (source.sourceKind === "SUPPLIER") !== (source.supplierJobId !== null)) fail("EVIDENCE_SOURCE_INVALID");
    if (source.supplierJobId !== null) {
      identity(source.supplierJobId);
      const job = persistedJobs.get(source.supplierJobId);
      // Event membership alone does not assign cost to a budget: the scoped
      // persisted source AND typed allocations are still required. Missing or
      // conflicting event membership cannot be silently inferred by this helper.
      if (!job || budget.eventId === null || job.eventId !== budget.eventId) fail("EVIDENCE_SUPPLIER_SCOPE_INVALID");
    }
    const obligation = JSON.stringify([source.sourceKind, source.sourceKey, scope.budgetId]);
    if (sources.has(source.id) || obligations.has(obligation)
      || (source.supplierJobId !== null && supplierJobs.has(source.supplierJobId))) fail("EVIDENCE_DUPLICATE_OBLIGATION");
    sources.set(source.id, source); obligations.add(obligation);
    if (source.supplierJobId !== null) supplierJobs.add(source.supplierJobId);
  }
  const allocationIds = new Set<string>(), destinations = new Set<string>();
  for (const allocation of input.allocations) {
    identity(allocation.id); scoped(allocation); balances(allocation);
    const destination = allocation.applicationId ?? allocation.budgetItemId;
    if ((allocation.applicationId === null) === (allocation.budgetItemId === null)
      || destination === null || !components.has(destination) || !sources.has(allocation.sourceId)) fail("EVIDENCE_ALLOCATION_SCOPE_INVALID");
    if (componentKinds.get(destination!) !== (allocation.applicationId === null ? "EQUIPMENT" : "SERVICE")) fail("EVIDENCE_ALLOCATION_SCOPE_INVALID");
    const key = JSON.stringify([allocation.sourceId, destination]);
    if (allocationIds.has(allocation.id) || destinations.has(key)) fail("EVIDENCE_DUPLICATE_ALLOCATION");
    allocationIds.add(allocation.id); destinations.add(key);
  }
  const contributions: RecognizedCostContribution[] = [];
  const provenance: { sourceId: string; sourceKind: string; sourceKey: string; supplierJobId: string | null; allocationIds: string[]; incurredComplete: boolean; pendingComplete: boolean }[] = [];
  const residuals: { sourceId: string; incurred: number | null; pending: number | null }[] = [];
  const incompleteSourceIds: string[] = [];
  for (const source of sources.values()) {
    const rows = input.allocations.filter(row => row.sourceId === source.id);
    const remainder = (field: "incurredAmount" | "pendingAmount") => {
      const known = rows.filter(row => row[field] !== null);
      // Unknown source cannot authorize even an explicit known zero allocation.
      if (source[field] === null && known.length) fail("EVIDENCE_UNKNOWN_SOURCE_ALLOCATION");
      const sum = known.reduce((total, row) => total + BigInt(row[field]!), BigInt(0));
      if (source[field] !== null && sum > BigInt(source[field]!)) fail("EVIDENCE_OVERALLOCATED");
      return source[field] === null ? null : intAmount(BigInt(source[field]!) - sum);
    };
    const incurred = remainder("incurredAmount"), pending = remainder("pendingAmount");
    residuals.push({ sourceId: source.id, incurred, pending });
    if (!source.incurredComplete || !source.pendingComplete || incurred !== 0 || pending !== 0 || rows.length === 0
      || rows.some(row => !row.incurredComplete || !row.pendingComplete || row.incurredAmount === null || row.pendingAmount === null)) incompleteSourceIds.push(source.id);
    provenance.push({ sourceId: source.id, sourceKind: source.sourceKind, sourceKey: source.sourceKey, supplierJobId: source.supplierJobId,
      allocationIds: rows.map(row => row.id), incurredComplete: source.incurredComplete, pendingComplete: source.pendingComplete });
    if (rows.length) contributions.push({ sourceId: source.id, scopeId: scope.budgetId,
      incurred: source.incurredAmount, pending: source.pendingAmount,
      allocations: rows.map(row => ({ componentId: (row.applicationId ?? row.budgetItemId)!, incurred: row.incurredAmount, pending: row.pendingAmount })) });
  }
  return {
    authority: { organizationId: scope.organizationId, budgetId: scope.budgetId,
      budgetUpdatedAt: scope.budgetUpdatedAt, contractVersion: scope.contractVersion,
      componentVersions: input.components.map(row => ({ id: row.id, sourceRevision: row.sourceRevision, snapshotVersion: row.snapshotVersion })) },
    contributions, provenance, residuals, incompleteSourceIds,
    legacyEstimates: { materialCost: budget.materialCost, laborCost: budget.laborCost, costEstimate: budget.costEstimate },
    legacyCostsReconciled: false as const,
    costComplete: false as const,
    zeroCostConfirmedIds: [] as string[],
    costCompleteById: Object.fromEntries([...components].map(id => [id, false])),
    missingAuthority: ["PERSISTED_LEGACY_COST_RECONCILIATION", "SCOPED_VERSIONED_COMPONENT_ZERO_COST_ATTESTATION"] as const,
  };
}

const economicDomains = ["SERVICE", "LABOR", "EQUIPMENT_MATERIAL", "SUPPLIER", "EXPENSE_TREASURY"] as const;
const legacyFields = ["materialCost", "laborCost", "costEstimate"] as const;
const policyId = z.string().trim().min(1).max(200);
const policyMoney = z.number().int().min(0).max(BUDGET_INT_MAX);
const economicSliceSchema = z.object({ sourceId: policyId, allocationId: policyId,
  incurred: policyMoney, pending: policyMoney, domain: z.enum(economicDomains), overlapGroup: policyId.nullable(), proofId: policyId }).strict();
const legacyDispositionSchema = z.object({ fieldValue: policyMoney,
  disposition: z.enum(["ESTIMATE_ONLY", "REPRESENTED_BY_RECOGNIZED_SOURCES", "UNRESOLVED"]),
  originProofId: policyId.nullable(), slices: z.array(economicSliceSchema) }).strict();
const economicPolicySchema = z.object({ policyVersion: z.literal(1), censusVersion: z.literal(2),
  scope: z.object({ organizationId: policyId, budgetId: policyId, budgetUpdatedAt: z.string().datetime(), censusDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  legacyDispositionByField: z.object({ materialCost: legacyDispositionSchema, laborCost: legacyDispositionSchema, costEstimate: legacyDispositionSchema }).strict(),
  componentObligationClosure: z.array(z.object({ componentId: policyId,
    domains: z.array(z.object({ domain: z.enum(economicDomains), status: z.enum(["RECOGNIZED", "VERIFIED_NOT_APPLICABLE", "UNRESOLVED"]),
      allocationIds: z.array(policyId), proofId: policyId.nullable() }).strict()) }).strict()),
}).strict();
export type ServiceEconomicPolicyV1 = z.infer<typeof economicPolicySchema>;

/** This is a server resolver contract, not a persisted boolean or audit wrapper.
 * A checked loader must independently validate semantic source records (origin,
 * recognized slices, or closed obligation universe including absence proofs),
 * actor/action and complete-census freshness before returning a fact. Merely
 * matching PF observation/rationale/audit/digest MUST return null. JSON request
 * data cannot supply this function. No such production resolver is wired here.
 */
export type ServiceEconomicFactResolver = (proofId: string) => {
  id: string; organizationId: string; budgetId: string; budgetUpdatedAt: string; censusDigest: string;
  censusVersion: 2;
  actorId: string; actionId: string; kind: "ESTIMATE_ORIGIN" | "RECOGNIZED_SLICE" | "DOMAIN_CLOSURE";
  originRecords: { entity: string; recordId: string; rowDigest: string }[];
  statement: unknown;
} | null;

/** FIN_ECONOMIC_ATTESTATION_POLICY_V1. Private, synchronous policy evaluation;
 * never opens a transaction, authenticates a HTTP claim, or invokes an allocator.
 * Internal resolver freshness/semantic provenance is a prerequisite, not a flag
 * that this predicate derives from the observation it is evaluating.
 */
export function evaluateServiceEconomicPolicy(input: ServiceEconomicEvidenceInput, policyInput: unknown, context: {
  censusDigest: string;
  resolveInternalFact?: ServiceEconomicFactResolver;
  /** Independently loaded current tenant census, keyed entity:recordId. */
  internalRecordDigests?: ReadonlyMap<string, string>;
}) {
  const evidence = produceServiceEconomicEvidence(input);
  const reasons = new Set<string>();
  const parsed = economicPolicySchema.safeParse(policyInput);
  const denied = () => ({ ...evidence, policyVersion: 1 as const, policyReasons: [...reasons] });
  if (!parsed.success) {
    reasons.add(policyInput == null ? "POLICY_SUPPORT_MISSING" : "POLICY_SUPPORT_INVALID");
    reasons.add("LEGACY_DISPOSITION_BY_FIELD_MISSING_OR_INVALID");
    reasons.add("FIVE_DOMAIN_OBLIGATION_CLOSURE_MISSING_OR_INVALID");
    return denied();
  }
  const policy = parsed.data;
  if (!/^[a-f0-9]{64}$/.test(context.censusDigest) || policy.scope.censusDigest !== context.censusDigest
    || policy.scope.organizationId !== input.scope.organizationId || policy.scope.budgetId !== input.scope.budgetId
    || policy.scope.budgetUpdatedAt !== input.scope.budgetUpdatedAt) reasons.add("POLICY_SCOPE_CENSUS_STALE");
  if (!context.resolveInternalFact) reasons.add("INTERNAL_SEMANTIC_FACT_RESOLVER_MISSING");
  if (!context.internalRecordDigests) reasons.add("INTERNAL_RECORD_CENSUS_MISSING");
  const proofEntities = new Set(["Budget", "BudgetItem", "BudgetServiceApplication", "BudgetServiceCoverage", "ServiceCostSource", "ServiceCostAllocation",
    "Event", "SupplierJob", "Expense", "TreasuryMovement", "EventTask", "Promoter", "EventInventory", "InventoryItem", "InventoryUnit"]);
  const supported = (id: string | null, kind: "ESTIMATE_ORIGIN" | "RECOGNIZED_SLICE" | "DOMAIN_CLOSURE", statement: unknown) => {
    const fact = id === null ? null : context.resolveInternalFact?.(id);
    if (!fact || fact.id !== id || fact.kind !== kind || typeof fact.actorId !== "string" || !fact.actorId.trim()
      || typeof fact.actionId !== "string" || !fact.actionId.trim()
      || fact.censusVersion !== 2 || !Array.isArray(fact.originRecords) || !fact.originRecords.length
      || fact.originRecords.some(row => !row || !proofEntities.has(row.entity) || typeof row.recordId !== "string" || !row.recordId.trim()
        || typeof row.rowDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.rowDigest)
        || context.internalRecordDigests?.get(`${row.entity}:${row.recordId}`) !== row.rowDigest)
      || new Set(fact.originRecords.map(row => `${row.entity}:${row.recordId}`)).size !== fact.originRecords.length
      || fact.organizationId !== input.scope.organizationId || fact.budgetId !== input.scope.budgetId
      || fact.budgetUpdatedAt !== input.scope.budgetUpdatedAt || fact.censusDigest !== context.censusDigest
      || canonicalJson(fact.statement) !== canonicalJson(statement)) { reasons.add(`UNSUPPORTED_INTERNAL_FACT:${id ?? "missing"}`); return false; }
    return true;
  };
  const sources = new Map(input.sources.map(row => [row.id, row]));
  const allocations = new Map(input.allocations.map(row => [row.id, row]));
  const sliceRepresentations = new Map<string, { field: string; incurred: number; pending: number; domain: string; overlapGroup: string | null }>();
  for (const field of legacyFields) {
    const disposition = policy.legacyDispositionByField[field];
    if (disposition.fieldValue !== input.budget[field]) reasons.add(`LEGACY_VALUE_STALE:${field}`);
    if (disposition.disposition === "UNRESOLVED") reasons.add(`LEGACY_UNRESOLVED:${field}`);
    if (disposition.disposition === "ESTIMATE_ONLY") {
      if (disposition.slices.length) reasons.add(`LEGACY_ESTIMATE_HAS_SLICES:${field}`);
      supported(disposition.originProofId, "ESTIMATE_ORIGIN", { field, fieldValue: disposition.fieldValue, disposition: "ESTIMATE_ONLY" });
      continue;
    }
    if (disposition.disposition !== "REPRESENTED_BY_RECOGNIZED_SOURCES") continue;
    // An empty partition, including fieldValue0, cannot prove representation.
    if (disposition.originProofId !== null || !disposition.slices.length) reasons.add(`LEGACY_PARTITION_MISSING:${field}`);
    let total = BigInt(0);
    const seen = new Set<string>();
    for (const slice of disposition.slices) {
      const source = sources.get(slice.sourceId), allocation = allocations.get(slice.allocationId);
      total += BigInt(slice.incurred) + BigInt(slice.pending);
      if (seen.has(slice.allocationId)) reasons.add(`LEGACY_DUPLICATE_SLICE:${field}`);
      seen.add(slice.allocationId);
      if (!source || !allocation || allocation.sourceId !== source.id || !source.incurredComplete || !source.pendingComplete
        || !allocation.incurredComplete || !allocation.pendingComplete || source.incurredAmount === null || source.pendingAmount === null
        || allocation.incurredAmount === null || allocation.pendingAmount === null
        || slice.incurred > allocation.incurredAmount || slice.pending > allocation.pendingAmount) reasons.add(`LEGACY_SLICE_UNRECOGNIZED:${field}`);
      supported(slice.proofId, "RECOGNIZED_SLICE", { field, fieldValue: disposition.fieldValue, sourceId: slice.sourceId,
        allocationId: slice.allocationId, incurred: slice.incurred, pending: slice.pending, domain: slice.domain, overlapGroup: slice.overlapGroup });
      const prior = sliceRepresentations.get(slice.allocationId);
      // V1 admits exact declared cross-field representations. Partial ambiguous
      // overlap requires a finer persisted partition and remains unresolved.
      if (prior && (prior.field === field || prior.overlapGroup === null || prior.overlapGroup !== slice.overlapGroup
        || prior.incurred !== slice.incurred || prior.pending !== slice.pending || prior.domain !== slice.domain)) reasons.add("LEGACY_OVERLAP_UNDECLARED_OR_PARTIAL");
      sliceRepresentations.set(slice.allocationId, { field, incurred: slice.incurred, pending: slice.pending, domain: slice.domain, overlapGroup: slice.overlapGroup });
    }
    if (total !== BigInt(disposition.fieldValue)) reasons.add(`LEGACY_PARTITION_AMOUNT_MISMATCH:${field}`);
  }
  const componentIds = new Set(input.components.map(row => row.id));
  const closedComponents = new Set<string>();
  const closuresSeen = new Set<string>();
  for (const closure of policy.componentObligationClosure) {
    if (!componentIds.has(closure.componentId) || closuresSeen.has(closure.componentId)) reasons.add("CLOSURE_COMPONENT_INVALID_OR_DUPLICATE");
    closuresSeen.add(closure.componentId);
    const ownIds = input.allocations.filter(row => (row.applicationId ?? row.budgetItemId) === closure.componentId).map(row => row.id);
    const covered = new Set<string>(), seenDomains = new Set<string>();
    const reasonsBefore = reasons.size;
    for (const domain of closure.domains) {
      if (seenDomains.has(domain.domain)) reasons.add(`CLOSURE_DOMAIN_DUPLICATE:${closure.componentId}`);
      seenDomains.add(domain.domain);
      if (domain.status === "UNRESOLVED" || (domain.status === "VERIFIED_NOT_APPLICABLE" && domain.allocationIds.length)
        || (domain.status === "RECOGNIZED" && !domain.allocationIds.length)
        || new Set(domain.allocationIds).size !== domain.allocationIds.length
        || domain.allocationIds.some(id => !ownIds.includes(id) || covered.has(id)
          || (sliceRepresentations.has(id) && sliceRepresentations.get(id)!.domain !== domain.domain))) reasons.add(`CLOSURE_DOMAIN_UNRESOLVED:${closure.componentId}:${domain.domain}`);
      for (const id of domain.allocationIds) covered.add(id);
      supported(domain.proofId, "DOMAIN_CLOSURE", { componentId: closure.componentId, domain: domain.domain,
        status: domain.status, allocationIds: [...domain.allocationIds].sort(),
        sourceIds: [...new Set(domain.allocationIds.map(id => allocations.get(id)?.sourceId))].sort(),
        componentVersion: evidence.authority.componentVersions.find(row => row.id === closure.componentId) });
    }
    if (economicDomains.some(domain => !seenDomains.has(domain)) || ownIds.some(id => !covered.has(id))) reasons.add(`CLOSURE_UNIVERSE_INCOMPLETE:${closure.componentId}`);
    if (reasons.size === reasonsBefore) closedComponents.add(closure.componentId);
  }
  if (!componentIds.size || [...componentIds].some(id => !closuresSeen.has(id))) reasons.add("CLOSURE_COMPONENTS_MISSING");
  if (evidence.incompleteSourceIds.length) reasons.add("RECOGNIZED_SOURCE_PARTIAL_UNKNOWN_OR_RESIDUAL");
  if (reasons.size) return denied();
  const zeroCostConfirmedIds = input.components.filter(component => closedComponents.has(component.id)
    && input.allocations.filter(row => (row.applicationId ?? row.budgetItemId) === component.id)
      .every(row => row.incurredComplete && row.pendingComplete && row.incurredAmount === 0 && row.pendingAmount === 0)).map(row => row.id);
  return { ...evidence, policyVersion: 1 as const, policyReasons: [] as string[], legacyCostsReconciled: true,
    zeroCostConfirmedIds, costComplete: true, costCompleteById: Object.fromEntries(input.components.map(row => [row.id, true])),
    missingAuthority: [] as string[] };
}
