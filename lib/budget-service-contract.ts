import { z } from "zod";
import { commercialMoneySchema as money, commercialBpsSchema, budgetDiscountModeSchema } from "./budget-commercial-contract";

const id = z.string().min(1).max(200);
const days = z.number().int().min(1).max(9999);
const threshold = z.number().int().min(0).max(9999).nullable();
const revision = z.number().int().min(1).max(2147483647);
export const serviceKindSchema = z.enum(["TRANSPORT", "INSTALLATION", "GUARD", "PROMOTER"]);
export const serviceModeSchema = z.enum(["PERSON_DAY", "FIXED_EVENT"]);
export const serviceUnitSchema = z.enum(["PYG_PER_PERSON_DAY", "PYG_PER_EXECUTION", "PYG_PER_EVENT"]);
export const serviceIvaTypeSchema = z.enum(["GRAVADA_10", "GRAVADA_5", "EXENTA"]);
const front = z.enum(["FINAL", "WHOLESALE"]);
const floor = z.literal("CHARGED_ONLY");
const publicName = z.string().trim().min(1).max(120);
const frontTariff = z.object({ normalPrice: money.nullable(), fromDays: threshold, fromPrice: money.nullable() }).strict();
export const inventoryServiceTariffsSchema = z.object({ version: z.literal(1), FINAL: frontTariff, WHOLESALE: frontTariff }).strict();

type ModeFields = { kind: z.infer<typeof serviceKindSchema>; mode: z.infer<typeof serviceModeSchema>; unit: z.infer<typeof serviceUnitSchema> };
function validMode(value: ModeFields) {
  if (value.kind === "TRANSPORT" || value.kind === "INSTALLATION") return value.mode === "FIXED_EVENT" && value.unit === "PYG_PER_EXECUTION";
  return value.mode === "PERSON_DAY" ? value.unit === "PYG_PER_PERSON_DAY" : value.unit === "PYG_PER_EVENT";
}
const configurationShape = {
  kind: serviceKindSchema, publicName, mode: serviceModeSchema, unit: serviceUnitSchema,
  minimumPrice: money.nullable(), floorApplicability: floor, ivaType: serviceIvaTypeSchema.nullable(), tariffsJson: inventoryServiceTariffsSchema,
};
export const inventoryServiceConfigurationInputSchema = z.object({ version: z.literal(1), id: id.nullable(), expectedRevision: revision.nullable(), ...configurationShape }).strict().superRefine((value, ctx) => {
  if (!validMode(value)) ctx.addIssue({ code: "custom", message: "Clase, modalidad y unidad incompatibles." });
  if ((value.id === null) !== (value.expectedRevision === null)) ctx.addIssue({ code: "custom", message: "ID y revisión deben ser ambos nuevos o ambos explícitos." });
});
export const adminInventoryServiceConfigurationSchema = z.object({ id, inventoryItemId: id, ...configurationShape, active: z.boolean(), revision }).strict().refine(validMode, "Clase, modalidad y unidad incompatibles.");
export const persistedInventoryServiceConfigurationSchema = z.object({ id, organizationId: id, inventoryItemId: id, ...configurationShape, active: z.boolean(), revision }).strict().refine(validMode, "Clase, modalidad y unidad incompatibles.");

export const serviceTariffSnapshotV1Schema = z.object({ version: z.literal(1), front, mode: serviceModeSchema, unit: serviceUnitSchema,
  normalPrice: money.nullable(), fromDays: threshold, fromPrice: money.nullable(), minimumPrice: money.nullable() }).strict().refine(value => value.mode === "PERSON_DAY" ? value.unit === "PYG_PER_PERSON_DAY" : value.unit !== "PYG_PER_PERSON_DAY", "Unidad incompatible con modalidad.");

const parameters = { people: days.nullable(), serviceDays: days.nullable(), contextualServiceDays: days.nullable() };
const inclusion = z.enum(["NOT_INCLUDED", "INCLUDED_FREE", "INCLUDED_CHARGED"]);
const discountShape = { discountMode: budgetDiscountModeSchema.nullable(), discountValue: money.nullable() };
const applicationShape = {
  id, organizationId: id, budgetId: id, configurationId: id, kind: serviceKindSchema,
  scope: z.enum(["LINE", "SHARED_EXECUTION"]), parentLineId: id.nullable(), executionId: id.nullable(), sortOrder: z.number().int().nonnegative().max(2147483647),
  publicName, inclusion, reviewState: z.enum(["RESOLVED", "NEEDS_REVIEW"]), mode: serviceModeSchema, unit: serviceUnitSchema,
  ...parameters, front, tariffSnapshot: serviceTariffSnapshotV1Schema, priceSource: z.enum(["TARIFF", "OVERRIDE"]), overridePrice: money.nullable(),
  floorApplicability: floor, ivaType: serviceIvaTypeSchema.nullable(), ...discountShape, sourceRevision: revision,
};
function validateApplication(value: z.infer<z.ZodObject<typeof applicationShape>>, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!validMode(value)) issue("Clase, modalidad y unidad incompatibles.");
  if (value.scope === "LINE" ? !value.parentLineId || value.executionId !== null : !value.executionId || value.parentLineId !== null) issue("El alcance exige una identidad exclusiva.");
  if ((value.kind === "TRANSPORT" || value.kind === "INSTALLATION") && value.scope !== "SHARED_EXECUTION") issue("Traslado e instalación requieren ejecución explícita.");
  if (value.mode === "PERSON_DAY" ? value.people === null || value.serviceDays === null || value.contextualServiceDays !== null : value.people !== null || value.serviceDays !== null) issue("Brazos de parámetros excluyentes.");
  if (value.mode === "FIXED_EVENT" && (value.tariffSnapshot.fromDays ?? 0) > 0 && value.contextualServiceDays === null) issue("Umbral fijo activo requiere contexto explícito.");
  if (value.tariffSnapshot.front !== value.front || value.tariffSnapshot.mode !== value.mode || value.tariffSnapshot.unit !== value.unit) issue("Snapshot efectivo inconsistente.");
  if ((value.discountMode === null) !== (value.discountValue === null) || (value.discountMode === "PERCENT" && !commercialBpsSchema.safeParse(value.discountValue).success)) issue("Descuento inválido.");
  if (value.inclusion !== "NOT_INCLUDED" && value.ivaType === null) issue("Inclusión exige IVA explícito.");
  if (value.inclusion === "INCLUDED_CHARGED") {
    if (value.tariffSnapshot.minimumPrice === null) issue("Cargo exige mínimo explícito.");
    if (value.priceSource === "OVERRIDE") { if (value.overridePrice === null) issue("Override exige importe explícito."); }
    else {
      const selection = resolveServiceTariffSelection(value.tariffSnapshot, value.serviceDays, value.contextualServiceDays);
      if (!selection.known || selection.price === null || selection.price <= 0) issue("Tarifa cargable no acreditada.");
    }
  }
}
export const persistedBudgetServiceApplicationSchema = z.object(applicationShape).strict().superRefine(validateApplication);
/** HTTP terms only. Identity, snapshot, revision and amounts are server-owned. */
export const budgetServiceApplicationInputSchema = z.object({
  version: z.literal(1), id: id.nullable(), configurationId: id,
  scope: applicationShape.scope, parentLineId: id.nullable(), executionId: id.nullable(),
  coverageItemIds: z.array(id).max(100), sortOrder: applicationShape.sortOrder,
  publicName, inclusion, mode: serviceModeSchema, unit: serviceUnitSchema, ...parameters,
  front, priceSource: applicationShape.priceSource, overridePrice: money.nullable(),
  ...discountShape, ivaType: serviceIvaTypeSchema.nullable(), refreshSnapshot: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.coverageItemIds).size !== value.coverageItemIds.length) ctx.addIssue({ code: "custom", message: "Cobertura duplicada." });
  if (value.scope === "LINE" ? value.parentLineId === null || value.executionId !== null : value.executionId === null || value.parentLineId !== null) ctx.addIssue({ code: "custom", message: "Alcance incompatible." });
  if ((value.discountMode === null) !== (value.discountValue === null) || (value.discountMode === "PERCENT" && !commercialBpsSchema.safeParse(value.discountValue).success)) ctx.addIssue({ code: "custom", message: "Descuento inválido." });
});
export const budgetServiceMutationInputSchema = budgetServiceApplicationInputSchema;

export function serviceSnapshotFromConfiguration(input: unknown, selectedFront: z.infer<typeof front>) {
  const config = persistedInventoryServiceConfigurationSchema.parse(input);
  if (!config.active) throw new Error("SERVICE_CONFIGURATION_INACTIVE");
  const tariff = config.tariffsJson[front.parse(selectedFront)];
  return serviceTariffSnapshotV1Schema.parse({ version: 1, front: selectedFront, mode: config.mode, unit: config.unit,
    normalPrice: tariff.normalPrice, fromDays: tariff.fromDays, fromPrice: tariff.fromPrice, minimumPrice: config.minimumPrice });
}

/** No refresh-by-patch: historical snapshot is changed only by explicit action. */
export function validateServiceSnapshotRetention(previousInput: unknown, nextInput: unknown, refreshSnapshot: boolean) {
  const previous = persistedBudgetServiceApplicationSchema.parse(previousInput), next = persistedBudgetServiceApplicationSchema.parse(nextInput);
  if (previous.id !== next.id || previous.organizationId !== next.organizationId || previous.budgetId !== next.budgetId || previous.configurationId !== next.configurationId || previous.kind !== next.kind) throw new Error("SERVICE_IDENTITY_IMMUTABLE");
  if (next.sourceRevision < previous.sourceRevision) throw new Error("SERVICE_SOURCE_REVISION_INVALID");
  if (!refreshSnapshot && (JSON.stringify(previous.tariffSnapshot) !== JSON.stringify(next.tariffSnapshot) || previous.sourceRevision !== next.sourceRevision)) throw new Error("SERVICE_SNAPSHOT_REFRESH_REQUIRED");
}
const materializedShape = { grossAmount: money, discountAmount: money, netAmount: money, globalDiscountAmount: money, totalAmount: money };
export const adminBudgetServiceApplicationSchema = z.object({ ...applicationShape, ...materializedShape }).strict().superRefine((value, ctx) => {
  validateApplication(value, ctx);
  if (value.inclusion !== "INCLUDED_CHARGED" && Object.keys(materializedShape).some(key => value[key as keyof typeof materializedShape] !== 0)) ctx.addIssue({ code: "custom", message: "Servicio sin cargo no tiene venta materializada." });
});

/** Selector único sin multiplicaciones, descuentos, pisos ni allocator. */
export function resolveServiceTariffSelection(snapshot: z.infer<typeof serviceTariffSnapshotV1Schema>, serviceDays: number | null, contextualServiceDays: number | null): { known: boolean; price: number | null; source: "NORMAL" | "FROM_DAYS" | null } {
  const parsed = serviceTariffSnapshotV1Schema.parse(snapshot);
  if (parsed.fromDays === null) return { known: false, price: null, source: null };
  const selector = parsed.mode === "PERSON_DAY" ? serviceDays : contextualServiceDays;
  if (parsed.fromDays > 0 && !days.safeParse(selector).success) return { known: false, price: null, source: null };
  const source = parsed.fromDays > 0 && selector! >= parsed.fromDays ? "FROM_DAYS" : "NORMAL";
  const price = source === "FROM_DAYS" ? parsed.fromPrice : parsed.normalPrice;
  return { known: price !== null, price, source };
}

export const serviceCoverageSchema = z.object({ id, organizationId: id, budgetId: id, applicationId: id, parentLineId: id, active: z.boolean(), removedAt: z.string().datetime().nullable() }).strict().refine(value => value.active === (value.removedAt === null), "Estado histórico de cobertura inconsistente.");
export const serviceCoverageArraySchema = z.array(serviceCoverageSchema);
export type ServiceBindingContext = { organizationId: string; budgetId: string; configuration: { id: string; organizationId: string; kind: string }; executions: { id: string; organizationId: string; budgetId: string }[]; lines: { id: string; organizationId: string; budgetId: string; excluded: boolean }[] };
export function validateServiceCompanyBinding(input: unknown, coverageInput: unknown, context: ServiceBindingContext, requireResolved = true) {
  const app = persistedBudgetServiceApplicationSchema.parse(input);
  const coverage = z.array(serviceCoverageSchema).parse(coverageInput);
  if (app.organizationId !== context.organizationId || app.budgetId !== context.budgetId || app.configurationId !== context.configuration.id || context.configuration.organizationId !== context.organizationId || app.kind !== context.configuration.kind) throw new Error("SERVICE_COMPANY_BINDING_INVALID");
  if (app.executionId && !context.executions.some(row => row.id === app.executionId && row.organizationId === context.organizationId && row.budgetId === context.budgetId)) throw new Error("SERVICE_EXECUTION_INVALID");
  if (app.parentLineId && !context.lines.some(row => row.id === app.parentLineId && row.organizationId === context.organizationId && row.budgetId === context.budgetId)) throw new Error("SERVICE_PARENT_INVALID");
  const seen = new Set<string>(), coverageIds = new Set<string>();
  for (const row of coverage) {
    if (row.organizationId !== context.organizationId || row.budgetId !== context.budgetId || row.applicationId !== app.id || seen.has(row.parentLineId) || coverageIds.has(row.id) || !context.lines.some(line => line.id === row.parentLineId && line.organizationId === context.organizationId && line.budgetId === context.budgetId && (!requireResolved || !row.active || !line.excluded))) throw new Error("SERVICE_COVERAGE_INVALID");
    if (row.active && app.scope === "LINE" && row.parentLineId !== app.parentLineId) throw new Error("SERVICE_COVERAGE_INVALID");
    seen.add(row.parentLineId);
    coverageIds.add(row.id);
  }
  if (requireResolved && app.inclusion !== "NOT_INCLUDED" && (!coverage.some(row => row.active) || app.reviewState !== "RESOLVED")) throw new Error("SERVICE_REVIEW_REQUIRED");
  return { app, coverage };
}

const publicShape = { id, publicName, kind: serviceKindSchema, scope: z.enum(["LINE", "SHARED_EXECUTION"]), coverageItemIds: z.array(id),
  inclusion, mode: serviceModeSchema, unit: serviceUnitSchema, ...parameters, front, tariffSnapshot: serviceTariffSnapshotV1Schema,
  priceSource: z.enum(["TARIFF", "OVERRIDE"]), overridePrice: money.nullable(), floorApplicability: floor, ...discountShape, ...materializedShape, ivaType: serviceIvaTypeSchema.nullable() };
export const publicServiceV1Schema = z.object(publicShape).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!validMode(value) || value.tariffSnapshot.front !== value.front || value.tariffSnapshot.mode !== value.mode || value.tariffSnapshot.unit !== value.unit) issue("Dominio público inconsistente.");
  if (new Set(value.coverageItemIds).size !== value.coverageItemIds.length || (value.inclusion !== "NOT_INCLUDED" && value.coverageItemIds.length === 0)) issue("Cobertura pública inválida.");
  if (value.scope === "LINE" && value.coverageItemIds.length > 1) issue("LINE no cubre múltiples líneas.");
  if ((value.kind === "TRANSPORT" || value.kind === "INSTALLATION") && value.scope !== "SHARED_EXECUTION") issue("El fijo requiere ejecución.");
  if (value.mode === "PERSON_DAY" ? value.people === null || value.serviceDays === null || value.contextualServiceDays !== null : value.people !== null || value.serviceDays !== null) issue("Parámetros públicos incompatibles.");
  if (value.mode === "FIXED_EVENT" && (value.tariffSnapshot.fromDays ?? 0) > 0 && value.contextualServiceDays === null) issue("Contexto público del fijo no acreditado.");
  if ((value.discountMode === null) !== (value.discountValue === null) || (value.discountMode === "PERCENT" && !commercialBpsSchema.safeParse(value.discountValue).success)) issue("Descuento público inválido.");
  if (value.inclusion !== "INCLUDED_CHARGED" && (Object.keys(materializedShape).some(key => value[key as keyof typeof materializedShape] !== 0) || value.discountMode !== null)) issue("Sin cargo no es descuento aplicado.");
  if (value.inclusion !== "NOT_INCLUDED" && value.ivaType === null) issue("IVA público no acreditado.");
  if (value.inclusion === "INCLUDED_CHARGED") {
    if (value.tariffSnapshot.minimumPrice === null) issue("Piso público no acreditado.");
    if (value.priceSource === "OVERRIDE" ? value.overridePrice === null : (() => { const selected = resolveServiceTariffSelection(value.tariffSnapshot, value.serviceDays, value.contextualServiceDays); return !selected.known || selected.price === null || selected.price <= 0; })()) issue("Precio público no acreditado.");
  }
});

/** Reconstruct allowlist from a validated company-bound DTO. Never spread rows. */
export function publicBudgetServiceTerms(input: unknown, coverage: unknown, context: ServiceBindingContext): z.infer<typeof publicServiceV1Schema> {
  const app = adminBudgetServiceApplicationSchema.parse(input);
  const termsInput = Object.fromEntries(Object.keys(applicationShape).map(key => [key, app[key as keyof typeof app]]));
  const bound = validateServiceCompanyBinding(termsInput, coverage, context);
  return publicServiceV1Schema.parse({ id: app.id, publicName: app.publicName, kind: app.kind, scope: app.scope,
    coverageItemIds: bound.coverage.filter(row => row.active).map(row => row.parentLineId).sort(), inclusion: app.inclusion,
    mode: app.mode, unit: app.unit, people: app.people, serviceDays: app.serviceDays, contextualServiceDays: app.contextualServiceDays,
    front: app.front, tariffSnapshot: app.tariffSnapshot, priceSource: app.priceSource, overridePrice: app.overridePrice,
    floorApplicability: app.floorApplicability, discountMode: app.inclusion === "INCLUDED_CHARGED" ? app.discountMode : null, discountValue: app.inclusion === "INCLUDED_CHARGED" ? app.discountValue : null,
    grossAmount: app.grossAmount, discountAmount: app.discountAmount, netAmount: app.netAmount, globalDiscountAmount: app.globalDiscountAmount, totalAmount: app.totalAmount, ivaType: app.ivaType });
}

export const serviceCostSourceSchema = z.object({ id, organizationId: id, budgetId: id, sourceKind: z.enum(["SERVICE", "LABOR", "SUPPLIER", "EQUIPMENT"]), sourceKey: id,
  supplierJobId: id.nullable(), aggregationOwner: z.enum(["SERVICE", "LABOR", "SUPPLIER", "EQUIPMENT"]), executionState: z.enum(["NOT_EXECUTED", "COMMITTED", "PARTIAL", "EXECUTED", "UNKNOWN"]),
  incurredAmount: money.nullable(), pendingAmount: money.nullable(), incurredComplete: z.boolean(), pendingComplete: z.boolean() }).strict().superRefine((value, ctx) => {
  if ((value.incurredComplete && value.incurredAmount === null) || (value.pendingComplete && value.pendingAmount === null) || (value.sourceKind === "SUPPLIER") !== (value.supplierJobId !== null)) ctx.addIssue({ code: "custom", message: "Origen/completitud de costo inconsistente." });
});
export const serviceCostAllocationSchema = z.object({ id, organizationId: id, budgetId: id, sourceId: id, applicationId: id.nullable(), budgetItemId: id.nullable(),
  incurredAmount: money.nullable(), pendingAmount: money.nullable(), incurredComplete: z.boolean(), pendingComplete: z.boolean() }).strict().superRefine((value, ctx) => {
  if ((value.applicationId === null) === (value.budgetItemId === null) || (value.incurredComplete && value.incurredAmount === null) || (value.pendingComplete && value.pendingAmount === null)) ctx.addIssue({ code: "custom", message: "Destino/completitud de asignación inconsistente." });
});
/** Private allocation edit: scope comes from tenancy/locked budget, never body. */
export const serviceCostAllocationInputSchema = z.object({ version: z.literal(1), id: id.nullable(), sourceId: id,
  applicationId: id.nullable(), budgetItemId: id.nullable(), incurredAmount: money.nullable(), pendingAmount: money.nullable(),
  incurredComplete: z.boolean(), pendingComplete: z.boolean() }).strict().superRefine((value, ctx) => {
  if ((value.applicationId === null) === (value.budgetItemId === null) || (value.incurredComplete && value.incurredAmount === null) || (value.pendingComplete && value.pendingAmount === null)) ctx.addIssue({ code: "custom", message: "Asignación privada inválida." });
});

/** Validation only: BigInt sums enforce recognized allocation bounds, no margins. */
export function validateServiceCostBindings(sourcesInput: unknown, allocationsInput: unknown, context: { organizationId: string; budgetId: string; applicationIds: string[]; budgetItemIds: string[] }) {
  const sources = z.array(serviceCostSourceSchema).parse(sourcesInput), allocations = z.array(serviceCostAllocationSchema).parse(allocationsInput);
  const ids = new Set<string>(), keys = new Set<string>(), commitments = new Set<string>();
  for (const source of sources) {
    const key = JSON.stringify([source.sourceKind, source.sourceKey]);
    if (source.organizationId !== context.organizationId || source.budgetId !== context.budgetId || ids.has(source.id) || keys.has(key) || (source.supplierJobId !== null && commitments.has(source.supplierJobId))) throw new Error("SERVICE_COST_SOURCE_INVALID");
    ids.add(source.id); keys.add(key);
    if (source.supplierJobId !== null) commitments.add(source.supplierJobId);
  }
  const destinations = new Set<string>(), allocationIds = new Set<string>();
  for (const allocation of allocations) {
    const key = JSON.stringify([allocation.sourceId, allocation.applicationId, allocation.budgetItemId]);
    if (allocation.organizationId !== context.organizationId || allocation.budgetId !== context.budgetId || !ids.has(allocation.sourceId) || allocationIds.has(allocation.id) || destinations.has(key) || (allocation.applicationId ? !context.applicationIds.includes(allocation.applicationId) : !context.budgetItemIds.includes(allocation.budgetItemId!))) throw new Error("SERVICE_COST_ALLOCATION_INVALID");
    destinations.add(key); allocationIds.add(allocation.id);
  }
  for (const source of sources) for (const field of ["incurredAmount", "pendingAmount"] as const) {
    const sum = allocations.filter(row => row.sourceId === source.id).reduce((total, row) => total + BigInt(row[field] ?? 0), BigInt(0));
    if (source[field] === null ? allocations.some(row => row.sourceId === source.id && row[field] !== null) : sum > BigInt(source[field]!)) throw new Error("SERVICE_COST_OVERALLOCATED");
  }
  return { sources, allocations };
}

export type AdminInventoryServiceConfiguration = z.infer<typeof adminInventoryServiceConfigurationSchema>;
export type AdminBudgetServiceApplication = z.infer<typeof adminBudgetServiceApplicationSchema>;
export type PublicBudgetServiceV1 = z.infer<typeof publicServiceV1Schema>;
