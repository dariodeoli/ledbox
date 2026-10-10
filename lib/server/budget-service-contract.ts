import { randomUUID } from "node:crypto";
import type { Prisma, AdminRole } from "@prisma/client";
import { roleCan } from "./permissions";
import { QuoteComparisonError } from "./quote-comparison";
import type { AdminContext } from "./tenancy";
import { adminInventoryServiceConfigurationSchema, persistedInventoryServiceConfigurationSchema,
  inventoryServiceConfigurationInputSchema, adminBudgetServiceApplicationSchema, serviceConfigurationRevisionSchema,
  persistedBudgetServiceApplicationSchema, budgetServiceMutationInputSchema, serviceSnapshotFromConfiguration,
  validateServiceSnapshotRetention, validateServiceCompanyBinding, validateServiceCostBindings, serviceCoverageArraySchema, serviceCostAllocationInputSchema, serviceApplicationTerms,
  type ServiceBindingContext } from "../budget-service-contract";

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
