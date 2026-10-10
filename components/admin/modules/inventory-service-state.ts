/** Estado local de formularios OPS (#161). No es un DTO/API ni modelo Prisma.
 * El adaptador a persistencia se conectará sólo al mapping/dependencia PF CLOSED.
 * No calcula descuentos, impuestos, costo efectivo, margen ni reservas financieras.
 */
export type ServiceClass = "TRANSPORT" | "INSTALLATION" | "TECHNICAL_GUARD" | "PROMOTER";
export type ServiceMode = "FIXED_EXECUTION" | "FIXED_EVENT" | "PERSON_DAY";
export type ServiceUnit = "PYG_PER_EXECUTION" | "PYG_PER_EVENT" | "PYG_PER_PERSON_DAY";
export type ServiceFront = "FINAL" | "WHOLESALE";
export type ServiceInclusion = "NOT_INCLUDED" | "INCLUDED_FREE" | "INCLUDED_CHARGED";
export type ServiceTax = "IVA10" | "IVA5" | "EXEMPT";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): Result<never> => ({ ok: false, error });
const MONEY_MAX = 2_147_483_647;
const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= MONEY_MAX;
const validDays = (value: number) => Number.isInteger(value) && value >= 1 && value <= 9999;

export type ServiceTariff = { normalPrice: number | null; fromDays: number | null; fromPrice: number | null };
export type ServiceConfigurationDraft = {
  serviceClass: ServiceClass;
  mode: ServiceMode;
  minimumPrice: string;
  tax: ServiceTax | "";
  final: { normalPrice: string; fromDays: string; fromPrice: string };
  wholesale: { normalPrice: string; fromDays: string; fromPrice: string };
};
export type ServiceConfiguration = {
  serviceClass: ServiceClass;
  mode: ServiceMode;
  unit: ServiceUnit;
  minimumPrice: number | null;
  minimumApplicability: "CHARGED_ONLY";
  tax: ServiceTax | null;
  final: ServiceTariff;
  wholesale: ServiceTariff;
};

function unitOf(serviceClass: ServiceClass, mode: ServiceMode): ServiceUnit | null {
  if (serviceClass === "TRANSPORT" || serviceClass === "INSTALLATION") return mode === "FIXED_EXECUTION" ? "PYG_PER_EXECUTION" : null;
  if (serviceClass !== "TECHNICAL_GUARD" && serviceClass !== "PROMOTER") return null;
  return mode === "PERSON_DAY" ? "PYG_PER_PERSON_DAY" : mode === "FIXED_EVENT" ? "PYG_PER_EVENT" : null;
}

/** Vacío conserva unknown/null; cero sólo surge de un 0 escrito explícitamente. */
function optionalInteger(text: string, max: number): number | null | false {
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return false;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= max ? value : false;
}

export function readServiceConfigurationDraft(draft: ServiceConfigurationDraft): Result<ServiceConfiguration> {
  const unit = unitOf(draft.serviceClass, draft.mode);
  if (!unit) return fail("La clase y la modalidad no son compatibles.");
  const minimumPrice = optionalInteger(draft.minimumPrice, MONEY_MAX);
  if (minimumPrice === false) return fail("Ingresá un mínimo entero válido; vacío no equivale a cero.");
  if (draft.tax !== "" && !["IVA10", "IVA5", "EXEMPT"].includes(draft.tax)) return fail("La condición de IVA no es válida.");
  const tariffs: ServiceTariff[] = [];
  for (const tariff of [draft.final, draft.wholesale]) {
    const normalPrice = optionalInteger(tariff.normalPrice, MONEY_MAX);
    const fromDays = optionalInteger(tariff.fromDays, 9999);
    const fromPrice = optionalInteger(tariff.fromPrice, MONEY_MAX);
    if (normalPrice === false || fromDays === false || fromPrice === false) return fail("Revisá los importes y el umbral de cada frente.");
    if (fromPrice !== null && fromDays === null) return fail("El precio por duración requiere un umbral explícito, incluso 0 para desactivar.");
    tariffs.push({ normalPrice, fromDays, fromPrice });
  }
  return { ok: true, value: { serviceClass: draft.serviceClass, mode: draft.mode, unit, minimumPrice, minimumApplicability: "CHARGED_ONLY", tax: draft.tax || null, final: tariffs[0], wholesale: tariffs[1] } };
}

export type ServiceParameters = { people: number | null; serviceDays: number | null; contextualServiceDays: number | null };
export type ServiceOverride = { amount: number; unit: ServiceUnit };

/** Preview del frente ya elegido; nunca cambia a otro frente por días/precio. */
export function serviceTariffPreview(configuration: ServiceConfiguration, front: ServiceFront, parameters: ServiceParameters): Result<{ front: ServiceFront; source: "NORMAL" | "FROM_DAYS"; tariff: number | null; selectorDays: number | null }> {
  const unit = unitOf(configuration.serviceClass, configuration.mode);
  if (!unit || configuration.unit !== unit) return fail("La unidad no corresponde a esta modalidad.");
  if (front !== "FINAL" && front !== "WHOLESALE") return fail("Elegí un frente explícito.");
  const tariff = front === "FINAL" ? configuration.final : configuration.wholesale;
  if (configuration.mode === "PERSON_DAY") {
    if (parameters.people === null || parameters.serviceDays === null || !validDays(parameters.people) || !validDays(parameters.serviceDays) || parameters.contextualServiceDays !== null) return fail("Personas y días propios son obligatorios; el contexto fijo debe estar vacío.");
  } else if (parameters.people !== null || parameters.serviceDays !== null || (parameters.contextualServiceDays !== null && !validDays(parameters.contextualServiceDays))) {
    return fail("El fijo no admite personas ni días efectivos del brazo variable.");
  }
  const selectorDays = configuration.mode === "PERSON_DAY" ? parameters.serviceDays : parameters.contextualServiceDays;
  if ((tariff.fromDays ?? 0) > 0 && selectorDays === null) return fail("El fijo con umbral activo requiere días contextuales explícitos.");
  const fromApplies = (tariff.fromDays ?? 0) > 0 && selectorDays !== null && selectorDays >= tariff.fromDays! && (tariff.fromPrice ?? 0) > 0;
  return { ok: true, value: { front, source: fromApplies ? "FROM_DAYS" : "NORMAL", tariff: fromApplies ? tariff.fromPrice : tariff.normalPrice, selectorDays } };
}

/** Sólo verifica que el formulario tenga datos acreditados para cargo. FIN
 * materializa importe/piso/IVA/descuentos/Int bajo su cálculo canónico posterior.
 */
export function serviceChargeInputError(configuration: ServiceConfiguration, front: ServiceFront, parameters: ServiceParameters, inclusion: ServiceInclusion, override: ServiceOverride | null, budgetTax: ServiceTax | null): string | null {
  if (!["NOT_INCLUDED", "INCLUDED_FREE", "INCLUDED_CHARGED"].includes(inclusion)) return "Elegí una inclusión explícita.";
  const preview = serviceTariffPreview(configuration, front, parameters);
  if (!preview.ok) return preview.error;
  if (configuration.minimumApplicability !== "CHARGED_ONLY") return "La aplicabilidad del mínimo debe ser explícita CHARGED_ONLY.";
  if (configuration.tax === null || budgetTax === null || configuration.tax !== budgetTax) return "Confirmá IVA explícito y homogéneo con el presupuesto.";
  if (override && (override.unit !== configuration.unit || !validMoney(override.amount))) return "El override debe conservar la unidad del brazo y un importe Int válido.";
  if (inclusion !== "INCLUDED_CHARGED") return null;
  if (configuration.minimumPrice === null || !validMoney(configuration.minimumPrice)) return "Con cargo requiere un mínimo explícito acreditado.";
  if (!override && (preview.value.tariff === null || preview.value.tariff <= 0)) return "Con cargo requiere tarifa válida u override explícito; vacío/0 no es sin cargo.";
  return null;
}

export type ServiceApplicationState<PrivateCost> = {
  id: string;
  organizationId: string;
  budgetId: string;
  configurationId: string;
  productId: string;
  scope: "LINE" | "SHARED_EXECUTION";
  scopeKey: string;
  executionId: string | null;
  inclusion: ServiceInclusion;
  front: ServiceFront;
  snapshot: ServiceConfiguration;
  parameters: ServiceParameters;
  override: ServiceOverride | null;
  coverageIds: string[];
  historicalCoverageIds: string[];
  coverageState: "RESOLVED" | "NEEDS_REVIEW";
  /** Opaque en OPS: incurrido/pendiente/origen/completeness pertenecen a PF/FIN. */
  privateCost: PrivateCost;
};
export type ServiceBindingContext = {
  organizationId: string;
  budgetId: string;
  configuration: { id: string; organizationId: string; productId: string; serviceClass: ServiceClass };
  executions: Array<{ id: string; organizationId: string; budgetId: string }>;
  lines: Array<{ id: string; organizationId: string; budgetId: string; excluded: boolean }>;
};

/** Contexto ya resuelto: no sustituye consultas, autorización, FK ni lock PF. */
export function serviceBindingError<Cost>(application: ServiceApplicationState<Cost>, context: ServiceBindingContext): string | null {
  if (!application.id || !application.scopeKey || application.organizationId !== context.organizationId || application.budgetId !== context.budgetId || application.configurationId !== context.configuration.id || context.configuration.organizationId !== context.organizationId || application.productId !== context.configuration.productId || application.snapshot.serviceClass !== context.configuration.serviceClass) return "La aplicación, configuración y presupuesto deben pertenecer a la misma empresa y origen.";
  const fixedExecution = application.snapshot.serviceClass === "TRANSPORT" || application.snapshot.serviceClass === "INSTALLATION";
  if (fixedExecution && application.scope !== "SHARED_EXECUTION") return "Traslado e instalación identifican una ejecución, no un alias LINE.";
  if (application.scope === "SHARED_EXECUTION") {
    if (!application.executionId || application.scopeKey !== application.executionId || !context.executions.some(row => row.id === application.executionId && row.organizationId === context.organizationId && row.budgetId === context.budgetId)) return "La ejecución debe tener identidad explícita del mismo presupuesto.";
  } else if (application.scope === "LINE") {
    if (application.executionId !== null || !context.lines.some(row => row.id === application.scopeKey && row.organizationId === context.organizationId && row.budgetId === context.budgetId)) return "El alcance LINE debe identificar su línea sin ejecución alias.";
  } else return "El alcance no está admitido; no existe EVENT sin cobertura.";
  if (new Set(application.coverageIds).size !== application.coverageIds.length || application.coverageIds.some(id => !context.lines.some(row => row.id === id && row.organizationId === context.organizationId && row.budgetId === context.budgetId && !row.excluded))) return "La cobertura contiene una línea ajena, retirada o duplicada.";
  if (application.inclusion !== "NOT_INCLUDED" && (!application.coverageIds.length || application.coverageState !== "RESOLVED")) return "El servicio incluido requiere cobertura no vacía y resuelta.";
  if (application.scope === "LINE" && application.coverageIds.some(id => id !== application.scopeKey)) return "Un alcance LINE no cubre otra línea.";
  return null;
}

/** Clave local para detectar doble cargo, nunca identidad pública/constraint DB. */
export function serviceApplicationKey<Cost>(application: ServiceApplicationState<Cost>): string {
  return JSON.stringify([application.organizationId, application.budgetId, application.configurationId, application.snapshot.serviceClass, application.scope, application.scopeKey]);
}

export function duplicateServiceApplicationError<Cost>(applications: ServiceApplicationState<Cost>[]): string | null {
  const keys = new Set<string>(), ids = new Set<string>();
  for (const application of applications) {
    const key = serviceApplicationKey(application);
    if (ids.has(application.id) || keys.has(key)) return "No dupliques la identidad ni el cargo de la misma configuración y ejecución/alcance.";
    ids.add(application.id); keys.add(key);
  }
  return null;
}

/** Decisión explícita y completa; error no altera el estado previo. Retiro total
 * sólo se resuelve con NOT_INCLUDED. Restaurar padre no invoca esta acción.
 */
export function resolveServiceCoverage<Cost>(current: ServiceApplicationState<Cost>, next: { coverageIds: string[]; inclusion: ServiceInclusion }, context: ServiceBindingContext, protectedTerms = false): Result<ServiceApplicationState<Cost>> & { status?: 400 | 409 } {
  if (protectedTerms) return { ok: false, error: "Los términos protegidos requieren el ciclo de revisión existente.", status: 409 };
  if (!["NOT_INCLUDED", "INCLUDED_FREE", "INCLUDED_CHARGED"].includes(next.inclusion)) return { ok: false, error: "Elegí una inclusión explícita.", status: 400 };
  const candidate = { ...current, inclusion: next.inclusion, coverageIds: [...next.coverageIds], historicalCoverageIds: [...new Set([...current.historicalCoverageIds, ...current.coverageIds])], coverageState: "RESOLVED" as const };
  const error = serviceBindingError(candidate, context);
  return error ? { ok: false, error, status: 400 } : { ok: true, value: candidate };
}

/** Cambio de brazo explícito: conserva costo/cobertura, exige todos sus
 * parámetros y obliga a reemplazar override si cambia la unidad. No refresh.
 */
export function transitionServiceMode<Cost>(current: ServiceApplicationState<Cost>, next: { configuration: ServiceConfiguration; parameters: ServiceParameters; override?: ServiceOverride | null }): Result<ServiceApplicationState<Cost>> {
  if (next.configuration.serviceClass !== current.snapshot.serviceClass) return fail("La clase no cambia al cambiar modalidad.");
  const override = next.override === undefined ? current.override : next.override;
  const preview = serviceTariffPreview(next.configuration, current.front, next.parameters);
  if (!preview.ok) return preview;
  if (override && (override.unit !== next.configuration.unit || !validMoney(override.amount))) return fail("Reemplazá explícitamente el override al cambiar su unidad.");
  return { ok: true, value: { ...current, snapshot: next.configuration, parameters: { ...next.parameters }, override } };
}
