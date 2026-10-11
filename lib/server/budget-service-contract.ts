import { createHash, randomUUID } from "node:crypto";
import type { Prisma, AdminRole } from "@prisma/client";
import { roleCan } from "./permissions";
import { QuoteComparisonError } from "./quote-comparison";
import type { AdminContext } from "./tenancy";
import { adminInventoryServiceConfigurationSchema, persistedInventoryServiceConfigurationSchema,
  inventoryServiceConfigurationInputSchema, adminBudgetServiceApplicationSchema, serviceConfigurationRevisionSchema,
  persistedBudgetServiceApplicationSchema, budgetServiceMutationInputSchema, serviceSnapshotFromConfiguration,
  validateServiceSnapshotRetention, validateServiceCompanyBinding, validateServiceCostBindings, serviceCoverageArraySchema, serviceCostAllocationInputSchema, serviceApplicationTerms,
   persistedServiceEconomicEvidenceSchema, serviceEconomicSnapshotSchema, serviceEconomicObservationInputSchema,
   type ServiceEconomicSnapshot, type ServiceBindingContext } from "../budget-service-contract";
import { canonicalJson } from "./signature/hash";

/** Hash the complete fresh census, not just IDs or claimed completeness flags.
 * Equipment has no revision: full persisted rows/coverage are bound instead. */
export function serviceEconomicCensusDigest(census: unknown) {
  return createHash("sha256").update(canonicalJson(census)).digest("hex");
}

type EconomicAudit = { id: string; organizationId: string; actorId: string; action: string; entity: string; entityId: string; createdAt: string; detail: unknown };
type EconomicUniverse = Record<string, Record<string, unknown>[]>;
function evidenceFailure(code: string): never { throw new Error(code); }
const economicMemberKey = (row: { applicationId: string | null; budgetItemId: string | null; sourceId: string | null; allocationId: string | null }) =>
  canonicalJson([row.applicationId, row.budgetItemId, row.sourceId, row.allocationId]);

/** Validate FIN V1 support representation against real fresh references. This
 * does not implement FIN's positive economic predicate. Current source models
 * have no persisted estimate-origin/domain-closure facts: never promote a field,
 * task completion, generic audit, amount equality or row absence to such proof. */
function validateEconomicPolicySupport(row: ReturnType<typeof persistedServiceEconomicEvidenceSchema.parse>, fresh: ServiceEconomicSnapshot, universe?: EconomicUniverse) {
  const reasons: string[] = [];
  const support = row.policySupport;
  if (support === null) return ["POLICY_SUPPORT_ABSENT", "PERSISTED_ORIGIN_FACTS_ABSENT", "PERSISTED_DOMAIN_CLOSURE_FACTS_ABSENT"];
  const distinct = (values: string[]) => { if (new Set(values).size !== values.length) evidenceFailure("EVIDENCE_POLICY_DUPLICATE"); };
  const requiredEntities = ["Event", "Budget", "BudgetItem", "BudgetServiceApplication", "BudgetServiceCoverage", "ServiceCostSource", "ServiceCostAllocation", "SupplierJob", "Expense", "TreasuryMovement", "EventTask", "Promoter", "EventInventory", "InventoryItem", "InventoryUnit"];
  if (!universe || requiredEntities.some(entity => !Array.isArray(universe[entity]))) evidenceFailure("EVIDENCE_POLICY_UNIVERSE_INCOMPLETE");
  distinct(support.legacyDispositionByField.map(value => value.field));
  const fields = ["materialCost", "laborCost", "costEstimate"] as const;
  if (fields.some(field => !support.legacyDispositionByField.some(value => value.field === field))) evidenceFailure("EVIDENCE_POLICY_FIELDS_INCOMPLETE");
  const sourceMap = new Map(fresh.sources.map(value => [value.id, value]));
  const allocationMap = new Map(fresh.allocations.map(value => [value.id, value]));
  for (const source of fresh.sources) {
    const allocations = fresh.allocations.filter(value => value.sourceId === source.id);
    if (!source.incurredComplete || !source.pendingComplete || source.incurredAmount === null || source.pendingAmount === null
      || allocations.some(value => !value.incurredComplete || !value.pendingComplete || value.incurredAmount === null || value.pendingAmount === null)) reasons.push(`SOURCE_${source.id}_PARTIAL_OR_UNKNOWN`);
    for (const field of ["incurredAmount", "pendingAmount"] as const) {
      const knownAssigned = allocations.filter(value => value[field] !== null).reduce((sum, value) => sum + BigInt(value[field]!), BigInt(0));
      if (source[field] !== null && knownAssigned !== BigInt(source[field]!)) reasons.push(`SOURCE_${source.id}_UNASSIGNED_RESIDUAL`);
    }
  }
  type Fact = { entity: string; recordId: string; rowDigest: string; fact: string };
  const facts = (references: Fact[]) => {
    distinct(references.map(value => canonicalJson([value.entity, value.recordId, value.fact])));
    for (const reference of references) {
      const actual = universe[reference.entity]?.find(value => value.id === reference.recordId);
      if (!actual || serviceEconomicCensusDigest(actual) !== reference.rowDigest) evidenceFailure("EVIDENCE_POLICY_FACT_STALE");
      if ((reference.entity === "Budget" && actual.id !== row.budgetId)
        || (["BudgetItem", "BudgetServiceApplication", "BudgetServiceCoverage", "ServiceCostSource", "ServiceCostAllocation"].includes(reference.entity) && actual.budgetId !== row.budgetId)
        || (reference.entity === "Event" && actual.id !== fresh.budget.eventId)
        || (["SupplierJob", "Expense", "EventTask", "EventInventory"].includes(reference.entity) && actual.eventId !== null && actual.eventId !== fresh.budget.eventId)) evidenceFailure("EVIDENCE_POLICY_FACT_SCOPE_INVALID");
      // Joining the row to this tenant proves scope, not its requested economic
      // meaning. These facts aren't persisted in the current entity schemas.
      if (reference.fact === "ESTIMATE_ORIGIN" || reference.fact === "DOMAIN_OPERATIONAL_CLOSURE" || reference.fact === "NOT_APPLICABLE_FOR_EXECUTION") {
        reasons.push(`PERSISTED_${reference.fact}_FACT_ABSENT`);
      }
      if (reference.fact === "BUDGET_ATTRIBUTION" && actual.budgetId !== row.budgetId) reasons.push("EXPLICIT_BUDGET_ATTRIBUTION_ABSENT");
      if (reference.fact === "RECOGNIZED_OBLIGATION" && !["ServiceCostSource", "ServiceCostAllocation"].includes(reference.entity)) reasons.push("EXPLICIT_OBLIGATION_RECOGNITION_ABSENT");
    }
  };
  type Slice = Extract<(typeof support.legacyDispositionByField)[number], { state: "REPRESENTED_BY_RECOGNIZED_SOURCES" }>["slices"][number];
  const slices = new Map<string, { field: string; slice: Slice }>();
  for (const disposition of support.legacyDispositionByField) {
    if (disposition.fieldValue !== fresh.budget[disposition.field]) evidenceFailure("EVIDENCE_POLICY_FIELD_VALUE_STALE");
    if (disposition.state === "UNRESOLVED") { reasons.push(`LEGACY_${disposition.field}_UNRESOLVED`); continue; }
    if (disposition.state === "ESTIMATE_ONLY") {
      if ((disposition.field === "costEstimate") !== (disposition.origin === "CANONICAL_BUDGET_ITEM_ESTIMATE")) evidenceFailure("EVIDENCE_POLICY_ORIGIN_INVALID");
      facts(disposition.factReferences);
      if (!disposition.factReferences.some(value => value.fact === "ESTIMATE_ORIGIN")) reasons.push(`LEGACY_${disposition.field}_ORIGIN_ABSENT`);
      continue;
    }
    distinct(disposition.slices.map(value => value.id));
    distinct(disposition.slices.map(value => canonicalJson([value.sourceId, value.allocationId, value.domain, value.incurredAmount, value.pendingAmount])));
    let total = BigInt(0);
    const partitions = new Map<string, { incurred: bigint; pending: bigint }>();
    for (const slice of disposition.slices) {
      const source = sourceMap.get(slice.sourceId), allocation = allocationMap.get(slice.allocationId);
      if (!source || !allocation || allocation.sourceId !== source.id) evidenceFailure("EVIDENCE_POLICY_SLICE_SCOPE_INVALID");
      if (!source.incurredComplete || !source.pendingComplete || source.incurredAmount === null || source.pendingAmount === null
        || !allocation.incurredComplete || !allocation.pendingComplete || allocation.incurredAmount === null || allocation.pendingAmount === null) evidenceFailure("EVIDENCE_POLICY_SLICE_UNKNOWN");
      const sums = partitions.get(allocation.id) ?? { incurred: BigInt(0), pending: BigInt(0) };
      sums.incurred += BigInt(slice.incurredAmount); sums.pending += BigInt(slice.pendingAmount);
      if (sums.incurred > BigInt(allocation.incurredAmount) || sums.pending > BigInt(allocation.pendingAmount)) evidenceFailure("EVIDENCE_POLICY_SLICE_OVERALLOCATED");
      partitions.set(allocation.id, sums);
      total += BigInt(slice.incurredAmount) + BigInt(slice.pendingAmount);
      facts(slice.factReferences);
      // sourceKind alone cannot establish the slice's economic domain.
      reasons.push("PERSISTED_SLICE_DOMAIN_FACT_ABSENT");
      slices.set(canonicalJson([disposition.field, slice.id]), { field: disposition.field, slice });
    }
    if (total !== BigInt(disposition.fieldValue)) evidenceFailure("EVIDENCE_POLICY_PARTITION_INCOMPLETE");
  }
  const overlapPairs = new Set<string>();
  const pairKey = (a: string, b: string) => canonicalJson([a, b].sort());
  for (const overlap of support.overlaps) {
    const leftKey = canonicalJson([overlap.leftField, overlap.leftSliceId]), rightKey = canonicalJson([overlap.rightField, overlap.rightSliceId]);
    const left = slices.get(leftKey), right = slices.get(rightKey);
    if (!left || !right || left.field === right.field || canonicalJson([left.slice.sourceId, left.slice.allocationId, left.slice.domain, left.slice.incurredAmount, left.slice.pendingAmount])
      !== canonicalJson([right.slice.sourceId, right.slice.allocationId, right.slice.domain, right.slice.incurredAmount, right.slice.pendingAmount])) evidenceFailure("EVIDENCE_POLICY_OVERLAP_INVALID");
    const key = pairKey(leftKey, rightKey);
    if (overlapPairs.has(key)) evidenceFailure("EVIDENCE_POLICY_DUPLICATE");
    overlapPairs.add(key);
  }
  const entries = [...slices.entries()];
  for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
    const [leftKey, left] = entries[a], [rightKey, right] = entries[b];
    if (left.field !== right.field && left.slice.allocationId === right.slice.allocationId && !overlapPairs.has(pairKey(leftKey, rightKey))) evidenceFailure("EVIDENCE_POLICY_OVERLAP_UNDECLARED");
  }
  const closures = support.componentObligationClosure;
  const key = (value: { applicationId: string | null; budgetItemId: string | null }) => canonicalJson([value.applicationId, value.budgetItemId]);
  distinct(closures.map(key));
  const expected = fresh.components.map(value => key({ applicationId: value.kind === "SERVICE" ? value.id : null, budgetItemId: value.kind === "EQUIPMENT" ? value.id : null })).sort();
  if (canonicalJson(closures.map(key).sort()) !== canonicalJson(expected)) evidenceFailure("EVIDENCE_POLICY_COMPONENT_CENSUS_INCOMPLETE");
  for (const closure of closures) {
    distinct(closure.domains.map(value => value.domain));
    for (const domain of closure.domains) {
      if (domain.state === "UNRESOLVED") { reasons.push(`COMPONENT_${closure.applicationId ?? closure.budgetItemId}_${domain.domain}_UNRESOLVED`); continue; }
      facts(domain.factReferences);
      if (!domain.factReferences.some(value => value.fact === "DOMAIN_OPERATIONAL_CLOSURE")) reasons.push(`DOMAIN_${domain.domain}_OPERATIONAL_CLOSURE_ABSENT`);
      if (domain.state === "VERIFIED_NOT_APPLICABLE" && !domain.factReferences.some(value => value.fact === "NOT_APPLICABLE_FOR_EXECUTION")) reasons.push(`DOMAIN_${domain.domain}_NOT_APPLICABLE_FACT_ABSENT`);
      if (domain.state === "RECOGNIZED") {
        distinct(domain.sourceIds); distinct(domain.allocationIds);
        if (domain.sourceIds.some(id => !sourceMap.has(id)) || domain.allocationIds.some(id => {
          const allocation = allocationMap.get(id);
          return !allocation || !domain.sourceIds.includes(allocation.sourceId) || allocation.applicationId !== closure.applicationId || allocation.budgetItemId !== closure.budgetItemId;
        })) evidenceFailure("EVIDENCE_POLICY_DOMAIN_ASSIGNMENT_INVALID");
      }
    }
  }
  return [...new Set([...reasons, "PERSISTED_DOMAIN_CLOSURE_FACTS_ABSENT", "FIN_POSITIVE_PREDICATE_NOT_WIRED"])];
}

/** Structural/provenance validation only, NOT FIN economic approval. Caller must
 * provide a fresh complete census under the same Budget lock, never request data.
 * No legacy sum is emitted; overlaps identify excluded legacy representations. */
export function validatePersistedServiceEconomicEvidence(input: unknown, current: {
  snapshot: ServiceEconomicSnapshot; censusDigest: string; expectedRevision: number; audit: EconomicAudit | null; universe?: EconomicUniverse;
}) {
  const row = persistedServiceEconomicEvidenceSchema.parse(input);
  const fresh = serviceEconomicSnapshotSchema.parse(current.snapshot);
  const scope = fresh.scope;
  if (row.organizationId !== scope.organizationId || row.budgetId !== scope.budgetId
    || fresh.budget.organizationId !== scope.organizationId || fresh.budget.id !== scope.budgetId
    || fresh.budget.updatedAt !== scope.budgetUpdatedAt || row.budgetUpdatedAt !== scope.budgetUpdatedAt
    || row.revision !== serviceConfigurationRevisionSchema.parse(current.expectedRevision)
    || row.censusDigest !== current.censusDigest || canonicalJson(row.snapshot) !== canonicalJson(fresh)) evidenceFailure("EVIDENCE_SCOPE_CENSUS_STALE");
  const audit = current.audit;
  const { members: _members, ...observation } = row;
  if (!audit || audit.id !== row.provenance.auditId || audit.organizationId !== row.organizationId
    || audit.actorId !== row.provenance.actorId || audit.createdAt !== row.provenance.recordedAt
    || audit.action !== "SERVICE_ECONOMIC_EVIDENCE_RECORDED" || audit.entity !== "ServiceEconomicEvidence" || audit.entityId !== row.id
    || canonicalJson(audit.detail) !== canonicalJson({ observationDigest: serviceEconomicCensusDigest(observation), censusDigest: row.censusDigest })) evidenceFailure("EVIDENCE_PROVENANCE_INVALID");
  const scoped = (value: { organizationId: string; budgetId: string }) => {
    if (value.organizationId !== scope.organizationId || value.budgetId !== scope.budgetId) evidenceFailure("EVIDENCE_SCOPE_CENSUS_STALE");
  };
  const componentMap = new Map(fresh.components.map(component => [component.id, component]));
  const sourceMap = new Map(fresh.sources.map(source => [source.id, source]));
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) evidenceFailure("EVIDENCE_DUPLICATE_CENSUS"); };
  unique(fresh.components.map(value => value.id)); unique(fresh.sources.map(value => value.id)); unique(fresh.allocations.map(value => value.id));
  unique(fresh.supplierJobs.map(value => value.id));
  unique(fresh.sources.map(value => canonicalJson([value.sourceKind, value.sourceKey])));
  unique(fresh.sources.flatMap(value => value.supplierJobId === null ? [] : [value.supplierJobId]));
  for (const component of fresh.components) {
    scoped(component);
    if (component.kind === "EQUIPMENT" ? component.sourceRevision !== null || component.expectedSourceRevision !== null || component.snapshotVersion !== null
      : component.snapshotVersion !== 1 || component.sourceRevision === null || component.sourceRevision !== component.expectedSourceRevision) evidenceFailure("EVIDENCE_COMPONENT_VERSION_INVALID");
  }
  const validateBalance = (value: { incurredAmount: number | null; pendingAmount: number | null; incurredComplete: boolean; pendingComplete: boolean }) => {
    if ((value.incurredComplete && value.incurredAmount === null) || (value.pendingComplete && value.pendingAmount === null)
      || (value.incurredAmount !== null && value.pendingAmount !== null && BigInt(value.incurredAmount) + BigInt(value.pendingAmount) > BigInt(2147483647))) evidenceFailure("EVIDENCE_BALANCE_INVALID");
  };
  for (const job of fresh.supplierJobs) if (job.organizationId !== scope.organizationId) evidenceFailure("EVIDENCE_SUPPLIER_SCOPE_INVALID");
  for (const source of fresh.sources) {
    scoped(source); validateBalance(source);
    if ((source.sourceKind === "SUPPLIER") !== (source.supplierJobId !== null)) evidenceFailure("EVIDENCE_SUPPLIER_SCOPE_INVALID");
    if (source.supplierJobId !== null && (fresh.budget.eventId === null || !fresh.supplierJobs.some(job => job.id === source.supplierJobId && job.eventId === fresh.budget.eventId))) evidenceFailure("EVIDENCE_SUPPLIER_SCOPE_INVALID");
  }
  unique(fresh.allocations.map(value => canonicalJson([value.sourceId, value.applicationId, value.budgetItemId])));
  for (const allocation of fresh.allocations) {
    scoped(allocation); validateBalance(allocation);
    const component = componentMap.get(allocation.applicationId ?? allocation.budgetItemId ?? "");
    if ((allocation.applicationId === null) === (allocation.budgetItemId === null) || !sourceMap.has(allocation.sourceId)
      || !component || component.kind !== (allocation.applicationId === null ? "EQUIPMENT" : "SERVICE")) evidenceFailure("EVIDENCE_ALLOCATION_SCOPE_INVALID");
  }
  for (const source of fresh.sources) for (const field of ["incurredAmount", "pendingAmount"] as const) {
    const values = fresh.allocations.filter(value => value.sourceId === source.id && value[field] !== null);
    if (source[field] === null ? values.length > 0 : values.reduce((sum, value) => sum + BigInt(value[field]!), BigInt(0)) > BigInt(source[field]!)) evidenceFailure("EVIDENCE_OVERALLOCATED");
  }
  const empty = { applicationId: null, budgetItemId: null, sourceId: null, allocationId: null };
  const expected = [
    ...fresh.components.map(value => economicMemberKey({ ...empty, ...(value.kind === "SERVICE" ? { applicationId: value.id } : { budgetItemId: value.id }) })),
    ...fresh.sources.map(value => economicMemberKey({ ...empty, sourceId: value.id })),
    ...fresh.allocations.map(value => economicMemberKey({ ...empty, allocationId: value.id })),
  ].sort();
  const actual = row.members.map(economicMemberKey).sort(); unique(actual);
  if (canonicalJson(expected) !== canonicalJson(actual)) evidenceFailure("EVIDENCE_CENSUS_INCOMPLETE");
  unique(row.provenance.legacyOverlaps.map(value => canonicalJson([value.field, value.sourceId])));
  if (row.provenance.legacyOverlaps.some(value => !sourceMap.has(value.sourceId))) evidenceFailure("EVIDENCE_LEGACY_DOUBLE_COUNT");
  if (row.kind === "LEGACY_RECONCILIATION") {
    if (row.applicationId !== null || row.budgetItemId !== null) evidenceFailure("EVIDENCE_TARGET_INVALID");
  } else {
    const component = componentMap.get(row.applicationId ?? row.budgetItemId ?? "");
    if ((row.applicationId === null) === (row.budgetItemId === null) || !component || component.kind !== (row.applicationId === null ? "EQUIPMENT" : "SERVICE")
      || row.provenance.legacyOverlaps.length > 0) evidenceFailure("EVIDENCE_TARGET_INVALID");
    // A zero observation cannot erase a known/unknown recognized allocation.
    const allocations = fresh.allocations.filter(value => value.applicationId === row.applicationId && value.budgetItemId === row.budgetItemId);
    if (allocations.some(value => value.incurredAmount !== 0 || value.pendingAmount !== 0 || !value.incurredComplete || !value.pendingComplete)) evidenceFailure("EVIDENCE_ZERO_CONFLICT");
  }
  const supportReasons = validateEconomicPolicySupport(row, fresh, current.universe);
  return { observation: row, integrityValidated: true as const, supportReasons,
    legacyCostsReconciled: false as const, costComplete: false as const, zeroCostConfirmedIds: [] as string[],
    missingAuthority: row.policySupport === null ? "PERSISTED_ECONOMIC_POLICY_SUPPORT_V1" as const : "PERSISTED_ECONOMIC_ORIGIN_AND_DOMAIN_CLOSURE_FACTS" as const };
}

/** Internal readonly candidate read under the commercial Budget lock. Explicit
 * scoped SQL avoids an unchecked/generated-client dependency on new tables.
 * No economic flags are exposed through loadScopedBudgetServices/public DTOs. */
export async function captureLockedServiceEconomicCensus(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId">, budgetId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Budget" WHERE "organizationId"=${context.organizationId} AND "id"=${budgetId} FOR UPDATE`;
  if (locked.length !== 1) evidenceFailure("EVIDENCE_BUDGET_NOT_FOUND");
  type Row = Record<string, unknown>;
  type Census = { budget: Row; applications: Row[]; items: Row[]; coverage: Row[]; sources: Row[]; allocations: Row[]; supplierJobs: Row[]; universe: EconomicUniverse };
  const [census] = await tx.$queryRaw<Census[]>`
    SELECT to_jsonb(b) AS budget,
      COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."id") FROM "BudgetServiceApplication" a WHERE a."organizationId"=b."organizationId" AND a."budgetId"=b."id"),'[]'::jsonb) AS applications,
      COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i."id") FROM "BudgetItem" i WHERE i."budgetId"=b."id"),'[]'::jsonb) AS items,
      COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."id") FROM "BudgetServiceCoverage" c WHERE c."organizationId"=b."organizationId" AND c."budgetId"=b."id"),'[]'::jsonb) AS coverage,
      COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "ServiceCostSource" s WHERE s."organizationId"=b."organizationId" AND s."budgetId"=b."id"),'[]'::jsonb) AS sources,
      COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."id") FROM "ServiceCostAllocation" a WHERE a."organizationId"=b."organizationId" AND a."budgetId"=b."id"),'[]'::jsonb) AS allocations,
      COALESCE((SELECT jsonb_agg(to_jsonb(j) ORDER BY j."id") FROM "SupplierJob" j WHERE j."organizationId"=b."organizationId" AND ((b."eventId" IS NOT NULL AND j."eventId"=b."eventId") OR j."id" IN (SELECT s."supplierJobId" FROM "ServiceCostSource" s WHERE s."organizationId"=b."organizationId" AND s."budgetId"=b."id"))),'[]'::jsonb) AS "supplierJobs",
      jsonb_build_object(
        'Event',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e."id") FROM "Event" e WHERE e."organizationId"=b."organizationId"),'[]'::jsonb),
        'Budget',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."id") FROM "Budget" x WHERE x."organizationId"=b."organizationId"),'[]'::jsonb),
        'BudgetItem',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i."id") FROM "BudgetItem" i JOIN "Budget" x ON x."id"=i."budgetId" WHERE x."organizationId"=b."organizationId"),'[]'::jsonb),
        'BudgetServiceApplication',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."id") FROM "BudgetServiceApplication" a WHERE a."organizationId"=b."organizationId"),'[]'::jsonb),
        'BudgetServiceCoverage',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."id") FROM "BudgetServiceCoverage" c WHERE c."organizationId"=b."organizationId"),'[]'::jsonb),
        'ServiceCostSource',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "ServiceCostSource" s WHERE s."organizationId"=b."organizationId"),'[]'::jsonb),
        'ServiceCostAllocation',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."id") FROM "ServiceCostAllocation" a WHERE a."organizationId"=b."organizationId"),'[]'::jsonb),
        'SupplierJob',COALESCE((SELECT jsonb_agg(to_jsonb(j) ORDER BY j."id") FROM "SupplierJob" j WHERE j."organizationId"=b."organizationId"),'[]'::jsonb),
        'Expense',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e."id") FROM "Expense" e WHERE e."organizationId"=b."organizationId"),'[]'::jsonb),
        'TreasuryMovement',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "TreasuryMovement" t WHERE t."organizationId"=b."organizationId"),'[]'::jsonb),
        'EventTask',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "EventTask" t JOIN "Event" e ON e."id"=t."eventId" WHERE e."organizationId"=b."organizationId"),'[]'::jsonb),
        'Promoter',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."id") FROM "Promoter" p WHERE p."organizationId"=b."organizationId"),'[]'::jsonb),
        'EventInventory',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i."id") FROM "EventInventory" i JOIN "Event" e ON e."id"=i."eventId" WHERE e."organizationId"=b."organizationId"),'[]'::jsonb),
        'InventoryItem',COALESCE((SELECT jsonb_agg((to_jsonb(i)-'imageData') ORDER BY i."id") FROM "InventoryItem" i WHERE i."organizationId"=b."organizationId"),'[]'::jsonb),
        'InventoryUnit',COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u."id") FROM "InventoryUnit" u WHERE u."organizationId"=b."organizationId"),'[]'::jsonb)
      ) AS universe
    FROM "Budget" b WHERE b."organizationId"=${context.organizationId} AND b."id"=${budgetId}`;
  if (!census) evidenceFailure("EVIDENCE_BUDGET_NOT_FOUND");
  const select = (row: Row, fields: readonly string[]) => Object.fromEntries(fields.map(field => [field, row[field]]));
  // Prisma timestamp(3) is UTC but to_jsonb(timestamp) omits the zone. Do not
  // reinterpret Budget.updatedAt in the machine's local timezone.
  const rawUpdatedAt = String(census.budget.updatedAt);
  const updatedAt = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(rawUpdatedAt) ? rawUpdatedAt : `${rawUpdatedAt}Z`).toISOString();
  const snapshot = serviceEconomicSnapshotSchema.parse({
    scope: { organizationId: context.organizationId, budgetId, budgetUpdatedAt: updatedAt, contractVersion: 1 },
    budget: { ...select(census.budget, ["id", "organizationId", "eventId", "materialCost", "laborCost", "costEstimate"]), updatedAt },
    supplierJobs: census.supplierJobs.map(row => select(row, ["id", "organizationId", "eventId"])),
    components: [...census.applications.map(row => ({ ...select(row, ["id", "organizationId", "budgetId", "sourceRevision"]), kind: "SERVICE",
      snapshotVersion: (row.tariffSnapshot as Row | null)?.version, expectedSourceRevision: row.sourceRevision })),
      ...census.items.map(row => ({ id: row.id, organizationId: context.organizationId, budgetId, kind: "EQUIPMENT", snapshotVersion: null, sourceRevision: null, expectedSourceRevision: null }))],
    sources: census.sources.map(row => select(row, ["id", "organizationId", "budgetId", "sourceKind", "sourceKey", "supplierJobId", "incurredAmount", "pendingAmount", "incurredComplete", "pendingComplete"])),
    allocations: census.allocations.map(row => select(row, ["id", "organizationId", "budgetId", "sourceId", "applicationId", "budgetItemId", "incurredAmount", "pendingAmount", "incurredComplete", "pendingComplete"])),
  });
  // Company-wide scope is deliberate while event-level expenses/commitments
  // lack explicit Budget attribution. It invalidates conservatively, assigns
  // nothing, and cannot certify a supported economic closure from membership.
  return { snapshot, censusDigest: serviceEconomicCensusDigest({ censusVersion: 2, ...census }), universe: census.universe };
}

export async function loadLockedServiceEconomicEvidence(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId">,
  budgetId: string, evidenceId: string, expectedRevision: number) {
  serviceConfigurationRevisionSchema.parse(expectedRevision);
  const current = await captureLockedServiceEconomicCensus(tx, context, budgetId);
  type Row = Record<string, unknown>;
  const select = (row: Row, fields: readonly string[]) => Object.fromEntries(fields.map(field => [field, row[field]]));
  const [record] = await tx.$queryRaw<Row[]>`SELECT * FROM "ServiceEconomicEvidence" WHERE "organizationId"=${context.organizationId} AND "budgetId"=${budgetId} AND "id"=${evidenceId}`;
  if (!record) evidenceFailure("EVIDENCE_NOT_FOUND");
  const [latest] = await tx.$queryRaw<{ revision: number | null }[]>`SELECT MAX("revision") AS revision FROM "ServiceEconomicEvidence"
    WHERE "organizationId"=${context.organizationId} AND "budgetId"=${budgetId} AND "kind"=${String(record.kind)}
    AND "applicationId" IS NOT DISTINCT FROM ${record.applicationId as string | null} AND "budgetItemId" IS NOT DISTINCT FROM ${record.budgetItemId as string | null}`;
  if (latest?.revision !== record.revision || latest.revision !== expectedRevision) evidenceFailure("EVIDENCE_REVISION_STALE");
  const members = await tx.$queryRaw<Row[]>`SELECT "applicationId","budgetItemId","sourceId","allocationId" FROM "ServiceEconomicEvidenceMember" WHERE "organizationId"=${context.organizationId} AND "budgetId"=${budgetId} AND "evidenceId"=${evidenceId} ORDER BY "id"`;
  const [auditRow] = await tx.$queryRaw<(Omit<EconomicAudit, "createdAt"> & { createdAt: Date })[]>`SELECT "id","organizationId","actorId","action","entity","entityId","createdAt","detail" FROM "AuditLog" WHERE "organizationId"=${context.organizationId} AND "id"=${String(record.auditId)}`;
  const observation = { ...select(record, ["id", "organizationId", "budgetId", "contractVersion", "revision", "kind", "applicationId", "budgetItemId", "censusDigest", "snapshot", "policySupport"]),
    budgetUpdatedAt: new Date(String(record.budgetUpdatedAt)).toISOString(), members,
    provenance: { ...select(record, ["auditId", "actorId", "rationale", "legacyOverlaps"]), recordedAt: new Date(String(record.recordedAt)).toISOString() } };
  return validatePersistedServiceEconomicEvidence(observation, { ...current, expectedRevision,
    audit: auditRow ? { ...auditRow, createdAt: auditRow.createdAt.toISOString() } : null });
}

/** Append an internal observation, NOT a FIN approval. Caller owns the transaction;
 * audit, snapshot and all FK census members commit together or roll back together.
 * No endpoint accepts this input. Budget lock serializes the target revision CAS. */
export async function appendLockedServiceEconomicObservation(tx: Prisma.TransactionClient, context: AdminContext, budgetId: string, input: unknown) {
  if (context.demo || !["OWNER", "ADMIN", "FINANCE"].includes(context.role) || !roleCan(context.role, "budgets.write")) evidenceFailure("EVIDENCE_WRITE_FORBIDDEN");
  const terms = serviceEconomicObservationInputSchema.parse(input);
  const current = await captureLockedServiceEconomicCensus(tx, context, budgetId);
  if (terms.budgetUpdatedAt !== current.snapshot.scope.budgetUpdatedAt || terms.censusDigest !== current.censusDigest) evidenceFailure("EVIDENCE_SCOPE_CENSUS_STALE");
  const [previous] = await tx.$queryRaw<{ revision: number | null }[]>`SELECT MAX("revision") AS revision FROM "ServiceEconomicEvidence"
    WHERE "organizationId"=${context.organizationId} AND "budgetId"=${budgetId} AND "kind"=${terms.kind}
    AND "applicationId" IS NOT DISTINCT FROM ${terms.applicationId} AND "budgetItemId" IS NOT DISTINCT FROM ${terms.budgetItemId}`;
  const oldRevision = previous?.revision ?? 0;
  if (oldRevision !== terms.expectedEvidenceRevision) evidenceFailure("EVIDENCE_REVISION_STALE");
  if (oldRevision === 2147483647) evidenceFailure("EVIDENCE_REVISION_EXHAUSTED");
  const id = randomUUID(), auditId = randomUUID(), recordedAt = new Date();
  const empty = { applicationId: null, budgetItemId: null, sourceId: null, allocationId: null };
  const members = [
    ...current.snapshot.components.map(value => ({ ...empty, ...(value.kind === "SERVICE" ? { applicationId: value.id } : { budgetItemId: value.id }) })),
    ...current.snapshot.sources.map(value => ({ ...empty, sourceId: value.id })),
    ...current.snapshot.allocations.map(value => ({ ...empty, allocationId: value.id })),
  ];
  const observation = { id, organizationId: context.organizationId, budgetId, contractVersion: 1, revision: oldRevision + 1,
    kind: terms.kind, applicationId: terms.applicationId, budgetItemId: terms.budgetItemId,
    budgetUpdatedAt: terms.budgetUpdatedAt, censusDigest: current.censusDigest, snapshot: current.snapshot, policySupport: terms.policySupport,
    provenance: { auditId, actorId: context.user.id, recordedAt: recordedAt.toISOString(), rationale: terms.rationale, legacyOverlaps: terms.legacyOverlaps } };
  const detail = { observationDigest: serviceEconomicCensusDigest(observation), censusDigest: current.censusDigest };
  const result = validatePersistedServiceEconomicEvidence({ ...observation, members }, { ...current, expectedRevision: observation.revision,
    audit: { id: auditId, organizationId: context.organizationId, actorId: context.user.id, action: "SERVICE_ECONOMIC_EVIDENCE_RECORDED", entity: "ServiceEconomicEvidence", entityId: id, createdAt: recordedAt.toISOString(), detail } });
  await tx.auditLog.create({ data: { id: auditId, organizationId: context.organizationId, actorId: context.user.id, actorName: context.user.name,
    actorEmail: context.user.email, action: "SERVICE_ECONOMIC_EVIDENCE_RECORDED", entity: "ServiceEconomicEvidence", entityId: id,
    summary: "Observación económica privada; aprobación FIN pendiente", detail, createdAt: recordedAt } });
  await tx.$executeRaw`INSERT INTO "ServiceEconomicEvidence" ("id","organizationId","budgetId","contractVersion","revision","kind","applicationId","budgetItemId","budgetUpdatedAt","censusDigest","snapshot","auditId","actorId","recordedAt","rationale","legacyOverlaps","policySupport")
    VALUES (${id},${context.organizationId},${budgetId},1,${observation.revision},${terms.kind},${terms.applicationId},${terms.budgetItemId},${new Date(terms.budgetUpdatedAt)},${current.censusDigest},${JSON.stringify(current.snapshot)}::jsonb,${auditId},${context.user.id},${recordedAt},${terms.rationale},${JSON.stringify(terms.legacyOverlaps)}::jsonb,${terms.policySupport === null ? null : JSON.stringify(terms.policySupport)}::jsonb)`;
  for (const member of members) await tx.$executeRaw`INSERT INTO "ServiceEconomicEvidenceMember" ("id","organizationId","budgetId","evidenceId","applicationId","budgetItemId","sourceId","allocationId")
    VALUES (${randomUUID()},${context.organizationId},${budgetId},${id},${member.applicationId},${member.budgetItemId},${member.sourceId},${member.allocationId})`;
  return result;
}

/** Pure validation adapter. DB loaders/CAS/transaction wiring are a later stage. */
export function validateBudgetServiceMutation(input: unknown, coverage: unknown, context: ServiceBindingContext & { role: AdminRole; demo: boolean }) {
  if (context.demo || !roleCan(context.role, "budgets.write")) throw new Error("SERVICE_MUTATION_FORBIDDEN");
  return validateServiceCompanyBinding(input, coverage, context);
}

function invoiceTax(value: "GRAVADA_10" | "GRAVADA_5" | "EXENTA" | null): "IVA10" | "IVA5" | "EXEMPT" {
  if (value === "GRAVADA_10") return "IVA10";
  if (value === "GRAVADA_5") return "IVA5";
  if (value === "EXENTA") return "EXEMPT";
  throw new Error("SERVICE_FISCAL_UNKNOWN");
}

/** Structural mapping to FIN9f ServiceFinancialInput, not public DTO/calc. */
export function toServiceFinancialInput(input: unknown, budgetIvaType: "GRAVADA_10" | "GRAVADA_5" | "EXENTA" | null, costComplete: boolean) {
  const app = persistedBudgetServiceApplicationSchema.parse(input);
  if (app.reviewState !== "RESOLVED") throw new Error("SERVICE_REVIEW_REQUIRED");
  if (app.ivaType !== budgetIvaType || budgetIvaType === null) throw new Error("SERVICE_FISCAL_INCOMPATIBLE");
  if (typeof costComplete !== "boolean") throw new Error("SERVICE_COST_COMPLETENESS_REQUIRED");
  const snapshot = app.tariffSnapshot;
  // Snapshot0 is retained outside this descriptor. Unknown threshold can only
  // enter an incomplete/override or excluded path, never tariff CHARGED fallback.
  const active = snapshot.fromDays !== null && snapshot.fromDays > 0;
  return { id: app.id, sortOrder: app.sortOrder, serviceClass: app.kind, inclusion: app.inclusion,
    floorApplicability: app.floorApplicability, taxType: invoiceTax(app.ivaType), modality: app.mode,
    people: app.people, serviceDays: app.serviceDays, contextualServiceDays: app.contextualServiceDays,
    tariff: { front: snapshot.front, normalPrice: snapshot.normalPrice, fromDays: active ? snapshot.fromDays : null,
      fromPrice: active ? snapshot.fromPrice : null, minimumPrice: snapshot.minimumPrice },
    overridePrice: app.priceSource === "OVERRIDE" ? app.overridePrice : null,
    discountMode: app.discountMode, discountValue: app.discountValue, costComplete };
}

/** FIN calls under its commercial lock with freshly loaded rows/coverage and
 * completeness from private reconciled sources. Administrative loading alone
 * does not satisfy this final resolved-coverage guard. No calculation here.
 */
export function toResolvedServiceFinancialInput(input: unknown, coverage: unknown, binding: ServiceBindingContext,
  budgetIvaType: "GRAVADA_10" | "GRAVADA_5" | "EXENTA" | null, costComplete: boolean) {
  const terms = serviceApplicationTerms(input);
  validateServiceCompanyBinding(terms, coverage, binding, true);
  return toServiceFinancialInput(terms, budgetIvaType, costComplete);
}

/** Keep partial known balances; normalized contributions match FIN9f structurally.
 * This validates bounds/completeness, never calculates money/margins/allocator.
 */
export function normalizeServiceCostContributions(sourcesInput: unknown, allocationsInput: unknown, context: {
  organizationId: string; budgetId: string; applicationIds: string[]; budgetItemIds: string[]; zeroCostConfirmedIds: string[];
  legacyCostsReconciled: boolean;
}) {
  const componentIds = [...context.applicationIds, ...context.budgetItemIds];
  if (new Set(componentIds).size !== componentIds.length || context.zeroCostConfirmedIds.some(id => !componentIds.includes(id))) throw new Error("SERVICE_COMPONENT_ID_INVALID");
  const { sources, allocations } = validateServiceCostBindings(sourcesInput, allocationsInput, context);
  const unassignedSourceIds = sources.filter(source => !allocations.some(row => row.sourceId === source.id)).map(source => source.id);
  const contributions = sources.filter(source => !unassignedSourceIds.includes(source.id)).map(source => ({ sourceId: source.id, scopeId: source.budgetId,
    incurred: source.incurredAmount, pending: source.pendingAmount,
    allocations: allocations.filter(row => row.sourceId === source.id).map(row => ({ componentId: row.applicationId ?? row.budgetItemId!, incurred: row.incurredAmount, pending: row.pendingAmount })) }));
  const costCompleteById = Object.fromEntries(componentIds.map(id => {
    const own = allocations.filter(row => (row.applicationId ?? row.budgetItemId) === id);
    const complete = context.legacyCostsReconciled === true && unassignedSourceIds.length === 0 && (own.length > 0 ? own.every(row => {
      const source = sources.find(source => source.id === row.sourceId)!;
      const related = allocations.filter(allocation => allocation.sourceId === source.id);
      return row.incurredComplete && row.pendingComplete && source.incurredComplete && source.pendingComplete
        && (["incurredAmount", "pendingAmount"] as const).every(field => source[field] !== null
          && related.every(allocation => allocation[field] !== null)
          && related.reduce((sum, allocation) => sum + BigInt(allocation[field]!), BigInt(0)) === BigInt(source[field]!));
    }) : context.zeroCostConfirmedIds.includes(id));
    return [id, complete];
  }));
  return { contributions, costCompleteById, unassignedSourceIds };
}

const configurationSelect = { id: true, organizationId: true, inventoryItemId: true, kind: true, publicName: true,
  mode: true, unit: true, tariffsJson: true, minimumPrice: true, floorApplicability: true, ivaType: true,
  active: true, revision: true } as const satisfies Prisma.InventoryServiceConfigurationSelect;
const applicationSelect = { id: true, organizationId: true, budgetId: true, configurationId: true, kind: true,
  scope: true, parentLineId: true, executionId: true, sortOrder: true, publicName: true, inclusion: true,
  reviewState: true, mode: true, unit: true, people: true, serviceDays: true, contextualServiceDays: true,
  front: true, tariffSnapshot: true, priceSource: true, overridePrice: true, floorApplicability: true,
  ivaType: true, discountMode: true, discountValue: true, sourceRevision: true,
  grossAmount: true, discountAmount: true, netAmount: true, globalDiscountAmount: true, totalAmount: true } as const satisfies Prisma.BudgetServiceApplicationSelect;
const coverageSelect = { id: true, organizationId: true, budgetId: true, applicationId: true, parentLineId: true, active: true, removedAt: true } as const satisfies Prisma.BudgetServiceCoverageSelect;
const costSourceSelect = { id: true, organizationId: true, budgetId: true, sourceKind: true, sourceKey: true,
  supplierJobId: true, aggregationOwner: true, executionState: true, incurredAmount: true, pendingAmount: true,
  incurredComplete: true, pendingComplete: true } as const satisfies Prisma.ServiceCostSourceSelect;
const costAllocationSelect = { id: true, organizationId: true, budgetId: true, sourceId: true, applicationId: true,
  budgetItemId: true, incurredAmount: true, pendingAmount: true, incurredComplete: true, pendingComplete: true } as const satisfies Prisma.ServiceCostAllocationSelect;

function configurationDto(input: unknown) {
  const row = persistedInventoryServiceConfigurationSchema.parse(input);
  const { organizationId: _organizationId, ...dto } = row;
  return adminInventoryServiceConfigurationSchema.parse(dto);
}

/** Read-only: caller passes the transaction/context resolved by tenancy. */
export async function loadInventoryServiceConfigurations(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId">, inventoryItemId: string) {
  if (!await tx.inventoryItem.findFirst({ where: { id: inventoryItemId, organizationId: context.organizationId }, select: { id: true } })) throw new QuoteComparisonError(404, "SERVICE_CONFIGURATION_NOT_FOUND");
  const rows = await tx.inventoryServiceConfiguration.findMany({ where: { organizationId: context.organizationId, inventoryItemId }, select: configurationSelect, orderBy: [{ kind: "asc" }, { id: "asc" }] });
  return rows.map(configurationDto);
}

/** Scoped CAS and audit share caller's transaction. No snapshot refresh or charges. */
export async function saveInventoryServiceConfiguration(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId" | "role" | "demo" | "user">, inventoryItemId: string, input: unknown) {
  if (context.demo || !roleCan(context.role, "inventory.write")) throw new QuoteComparisonError(403, "SERVICE_MUTATION_FORBIDDEN");
  const parsed = inventoryServiceConfigurationInputSchema.safeParse(input);
  if (!parsed.success) throw new QuoteComparisonError(400, "SERVICE_CONFIGURATION_INVALID");
  const value = parsed.data;
  // Serialize create/edit/archive for this product; DB unique remains authoritative.
  const products = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InventoryItem" WHERE "id" = ${inventoryItemId} AND "organizationId" = ${context.organizationId} FOR UPDATE`;
  if (!products.length) throw new QuoteComparisonError(404, "SERVICE_CONFIGURATION_NOT_FOUND");
  const data = { kind: value.kind, publicName: value.publicName, mode: value.mode, unit: value.unit,
    minimumPrice: value.minimumPrice, floorApplicability: value.floorApplicability, ivaType: value.ivaType,
    tariffsJson: value.tariffsJson };
  const configurationId = value.id ?? randomUUID();
  if (value.id === null) {
    if (await tx.inventoryServiceConfiguration.findFirst({ where: { organizationId: context.organizationId, inventoryItemId, kind: value.kind }, select: { id: true } })) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_EXISTS");
    await tx.inventoryServiceConfiguration.create({ data: { id: configurationId, organizationId: context.organizationId, inventoryItemId, ...data, active: true, revision: 1 } });
  } else {
    const previous = await tx.inventoryServiceConfiguration.findFirst({ where: { id: value.id, organizationId: context.organizationId, inventoryItemId }, select: configurationSelect });
    if (!previous) throw new QuoteComparisonError(404, "SERVICE_CONFIGURATION_NOT_FOUND");
    if (previous.kind !== value.kind) throw new QuoteComparisonError(400, "SERVICE_CONFIGURATION_KIND_IMMUTABLE");
    if (previous.revision !== value.expectedRevision) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_STALE");
    if (previous.revision === 2147483647) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_REVISION_EXHAUSTED");
    const changed = await tx.inventoryServiceConfiguration.updateMany({ where: { id: value.id, organizationId: context.organizationId, inventoryItemId, revision: value.expectedRevision! }, data: { ...data, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_STALE");
  }
  const row = await tx.inventoryServiceConfiguration.findFirstOrThrow({ where: { id: configurationId, organizationId: context.organizationId, inventoryItemId }, select: configurationSelect });
  await tx.auditLog.create({ data: { id: randomUUID(), organizationId: context.organizationId,
    actorId: context.user.id, actorName: context.user.name, actorEmail: context.user.email,
    action: value.id === null ? "create" : "update", entity: "InventoryItem", entityId: inventoryItemId,
    summary: `Configuración de servicio: ${row.publicName}`, detail: { fields: { configurationId, revision: row.revision, kind: row.kind } } } });
  return configurationDto(row);
}

export async function archiveInventoryServiceConfiguration(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId" | "role" | "demo" | "user">, inventoryItemId: string, configurationId: string, expectedRevision: number) {
  if (context.demo || !roleCan(context.role, "inventory.write")) throw new QuoteComparisonError(403, "SERVICE_MUTATION_FORBIDDEN");
  if (!serviceConfigurationRevisionSchema.safeParse(expectedRevision).success) throw new QuoteComparisonError(400, "SERVICE_CONFIGURATION_INVALID");
  const products = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InventoryItem" WHERE "id" = ${inventoryItemId} AND "organizationId" = ${context.organizationId} FOR UPDATE`;
  if (!products.length) throw new QuoteComparisonError(404, "SERVICE_CONFIGURATION_NOT_FOUND");
  const previous = await tx.inventoryServiceConfiguration.findFirst({ where: { id: configurationId, organizationId: context.organizationId, inventoryItemId }, select: { id: true, revision: true } });
  if (!previous) throw new QuoteComparisonError(404, "SERVICE_CONFIGURATION_NOT_FOUND");
  if (previous.revision !== expectedRevision) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_STALE");
  if (previous.revision === 2147483647) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_REVISION_EXHAUSTED");
  const changed = await tx.inventoryServiceConfiguration.updateMany({ where: { id: configurationId, organizationId: context.organizationId, inventoryItemId, revision: expectedRevision }, data: { active: false, revision: { increment: 1 } } });
  if (changed.count !== 1) throw new QuoteComparisonError(409, "SERVICE_CONFIGURATION_STALE");
  const row = await tx.inventoryServiceConfiguration.findFirstOrThrow({ where: { id: configurationId, organizationId: context.organizationId, inventoryItemId }, select: configurationSelect });
  await tx.auditLog.create({ data: { id: randomUUID(), organizationId: context.organizationId, actorId: context.user.id,
    actorName: context.user.name, actorEmail: context.user.email, action: "update", entity: "InventoryItem", entityId: inventoryItemId,
    summary: `Archivó configuración de servicio: ${row.publicName}`, detail: { fields: { configurationId, revision: row.revision, active: false } } } });
  return configurationDto(row);
}

/** Read-only coherent loading. FIN calls this inside withQuoteCommercialEdit;
 * the loader never opens a second transaction, locks, writes or calculates.
 * Catalog is loaded for identity only: historical snapshots are not refreshed.
 */
export async function loadScopedBudgetServices(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId">, budgetId: string) {
  const where = { organizationId: context.organizationId, budgetId };
  const budget = await tx.budget.findFirst({ where: { id: budgetId, organizationId: context.organizationId }, select: { id: true, organizationId: true, ivaType: true, updatedAt: true } });
  if (!budget) throw new QuoteComparisonError(404, "SERVICE_BUDGET_NOT_FOUND");
  const rows = await tx.budgetServiceApplication.findMany({ where, select: applicationSelect, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const configurations = await tx.inventoryServiceConfiguration.findMany({ where: { organizationId: context.organizationId, id: { in: [...new Set(rows.map(row => row.configurationId))] } }, select: configurationSelect });
  const executions = await tx.budgetServiceExecution.findMany({ where, select: { id: true, organizationId: true, budgetId: true } });
  const lineRows = await tx.budgetItem.findMany({ where: { budgetId, budget: { organizationId: context.organizationId } }, select: { id: true, budgetId: true, excluded: true } });
  const lines = lineRows.map(row => ({ ...row, organizationId: context.organizationId }));
  const coverageRows = await tx.budgetServiceCoverage.findMany({ where, select: coverageSelect, orderBy: { id: "asc" } });
  const coverage = coverageRows.map(row => ({ ...row, removedAt: row.removedAt?.toISOString() ?? null }));
  const applications = rows.map(row => adminBudgetServiceApplicationSchema.parse(row));
  if (new Set([...applications.map(row => row.id), ...lines.map(row => row.id)]).size !== applications.length + lines.length) throw new Error("SERVICE_COMPONENT_ID_INVALID");
  const bindings = applications.map(app => {
    const configuration = configurations.find(row => row.id === app.configurationId);
    if (!configuration) throw new Error("SERVICE_COMPANY_BINDING_INVALID");
    persistedInventoryServiceConfigurationSchema.parse(configuration);
    if (app.sourceRevision > configuration.revision) throw new Error("SERVICE_SOURCE_REVISION_INVALID");
    const binding: ServiceBindingContext = { organizationId: context.organizationId, budgetId, configuration, executions, lines };
    // Allow administrative NEEDS_REVIEW loading; emission/mutation guards below
    // enforce active cardinality. All references remain checked on read.
    const terms = serviceApplicationTerms(app);
    validateServiceCompanyBinding(terms, coverage.filter(row => row.applicationId === app.id), binding, false);
    return binding;
  });
  if (coverage.some(row => !applications.some(app => app.id === row.applicationId))) throw new Error("SERVICE_COVERAGE_INVALID");
  const sources = await tx.serviceCostSource.findMany({ where, select: costSourceSelect, orderBy: { id: "asc" } });
  const allocations = await tx.serviceCostAllocation.findMany({ where, select: costAllocationSelect, orderBy: { id: "asc" } });
  const costs = validateServiceCostBindings(sources, allocations, { ...where, applicationIds: applications.map(row => row.id), budgetItemIds: lines.map(row => row.id) });
  const supplierIds = sources.flatMap(row => row.supplierJobId === null ? [] : [row.supplierJobId]);
  if (supplierIds.length && await tx.supplierJob.count({ where: { id: { in: supplierIds }, organizationId: context.organizationId } }) !== supplierIds.length) throw new Error("SERVICE_COST_SOURCE_INVALID");
  return { budget, applications, coverage, bindings, ...costs, authority: {
    servicesContractVersion: 1 as const, budgetId: budget.id, organizationId: budget.organizationId,
    budgetUpdatedAt: budget.updatedAt.toISOString(), applications: applications.map(app => ({ id: app.id, sourceRevision: app.sourceRevision, snapshotVersion: app.tariffSnapshot.version })),
  } };
}

/** Cost-only lock uses the same Budget row as the canonical commercial editor.
 * Re-read ALL balances after waiting. The caller persists the returned allocation
 * in this very transaction; the validator never writes or invokes FIN calculation.
 */
export async function validateLockedServiceCostAllocation(tx: Prisma.TransactionClient, context: Pick<AdminContext, "organizationId" | "role" | "demo">, budgetId: string, input: unknown) {
  if (context.demo || !roleCan(context.role, "budgets.write")) throw new Error("SERVICE_MUTATION_FORBIDDEN");
  const patch = serviceCostAllocationInputSchema.parse(input);
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} AND "organizationId" = ${context.organizationId} FOR UPDATE`;
  if (!locked.length) throw new QuoteComparisonError(404, "SERVICE_BUDGET_NOT_FOUND");
  const loaded = await loadScopedBudgetServices(tx, context, budgetId);
  const existing = patch.id === null ? null : loaded.allocations.find(row => row.id === patch.id);
  if (patch.id !== null && !existing) throw new QuoteComparisonError(404, "SERVICE_ALLOCATION_NOT_FOUND");
  const next = { id: patch.id ?? randomUUID(), organizationId: context.organizationId, budgetId,
    sourceId: patch.sourceId, applicationId: patch.applicationId, budgetItemId: patch.budgetItemId,
    incurredAmount: patch.incurredAmount, pendingAmount: patch.pendingAmount,
    incurredComplete: patch.incurredComplete, pendingComplete: patch.pendingComplete };
  const allocations = [...loaded.allocations.filter(row => row.id !== next.id), next];
  validateServiceCostBindings(loaded.sources, allocations, { organizationId: context.organizationId, budgetId,
    applicationIds: loaded.applications.map(row => row.id), budgetItemIds: loaded.bindings[0]?.lines.map(row => row.id) ??
      (await tx.budgetItem.findMany({ where: { budgetId, budget: { organizationId: context.organizationId } }, select: { id: true } })).map(row => row.id) });
  return { allocation: next, authority: loaded.authority };
}

/** Server construction from strict terms and authoritative scoped catalog.
 * Caller holds commercial lock and persists FIN-returned materializations only.
 */
export function resolveBudgetServiceCoverage(input: unknown, configurationInput: unknown, binding: ServiceBindingContext & { role: AdminRole; demo: boolean }, previousInput: unknown | null, historicalCoverage: unknown, now = new Date()) {
  if (binding.demo || !roleCan(binding.role, "budgets.write")) throw new Error("SERVICE_MUTATION_FORBIDDEN");
  const terms = budgetServiceMutationInputSchema.parse(input);
  const config = persistedInventoryServiceConfigurationSchema.parse(configurationInput);
  if (config.organizationId !== binding.organizationId || config.id !== terms.configurationId) throw new Error("SERVICE_COMPANY_BINDING_INVALID");
  const previous = previousInput === null ? null : persistedBudgetServiceApplicationSchema.parse(previousInput);
  if (previous && previous.sourceRevision > config.revision) throw new Error("SERVICE_SOURCE_REVISION_INVALID");
  if ((terms.id === null) !== (previous === null) || (previous && terms.id !== previous.id)) throw new Error("SERVICE_IDENTITY_IMMUTABLE");
  const snapshot = previous && !terms.refreshSnapshot ? previous.tariffSnapshot : serviceSnapshotFromConfiguration(config, terms.front);
  const app = persistedBudgetServiceApplicationSchema.parse({ id: previous?.id ?? randomUUID(), organizationId: binding.organizationId, budgetId: binding.budgetId,
    configurationId: config.id, kind: config.kind, scope: terms.scope, parentLineId: terms.parentLineId, executionId: terms.executionId,
    sortOrder: terms.sortOrder, publicName: terms.publicName, inclusion: terms.inclusion, reviewState: "RESOLVED", mode: terms.mode, unit: terms.unit,
    people: terms.people, serviceDays: terms.serviceDays, contextualServiceDays: terms.contextualServiceDays, front: terms.front,
    tariffSnapshot: snapshot, priceSource: terms.priceSource, overridePrice: terms.overridePrice, floorApplicability: "CHARGED_ONLY",
    ivaType: terms.ivaType, discountMode: terms.discountMode, discountValue: terms.discountValue,
    sourceRevision: previous && !terms.refreshSnapshot ? previous.sourceRevision : config.revision });
  if (previous) validateServiceSnapshotRetention(previous, app, terms.refreshSnapshot);
  const history = serviceCoverageHistory(historicalCoverage);
  if (previous === null && history.length) throw new Error("SERVICE_COVERAGE_INVALID");
  // Verify historical references before generating activation/removal records.
  if (previous) validateServiceCompanyBinding(previous, history, binding, false);
  const coverage = history.map(row => ({ ...row, active: terms.coverageItemIds.includes(row.parentLineId),
    removedAt: terms.coverageItemIds.includes(row.parentLineId) ? null : row.removedAt ?? now.toISOString() }));
  for (const lineId of terms.coverageItemIds) if (!coverage.some(row => row.parentLineId === lineId)) coverage.push({ id: randomUUID(), organizationId: binding.organizationId, budgetId: binding.budgetId, applicationId: app.id, parentLineId: lineId, active: true, removedAt: null });
  return validateBudgetServiceMutation(app, coverage, binding);
}

function serviceCoverageHistory(input: unknown) {
  // Parse rather than accepting raw DB dates/unknown keys at this boundary.
  return serviceCoverageArraySchema.parse(input);
}
