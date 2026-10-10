import assert from "node:assert/strict";
import test from "node:test";
import { duplicateServiceApplicationError, readServiceConfigurationDraft, resolveServiceCoverage, serviceApplicationKey, serviceBindingError, serviceChargeInputError, serviceTariffPreview, transitionServiceMode, type ServiceApplicationState, type ServiceBindingContext, type ServiceConfiguration, type ServiceConfigurationDraft } from "../components/admin/modules/inventory-service-state";

const draft = (): ServiceConfigurationDraft => ({ serviceClass: "TECHNICAL_GUARD", mode: "PERSON_DAY", minimumPrice: "500", tax: "IVA10", final: { normalPrice: "1200", fromDays: "3", fromPrice: "900" }, wholesale: { normalPrice: "800", fromDays: "5", fromPrice: "600" } });
function configuration(input = draft()): ServiceConfiguration {
  const result = readServiceConfigurationDraft(input);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const privateCost = { incurred: 10000, remainingCommitment: 20000, known: false, obligationId: "private-obligation" };
function application(): ServiceApplicationState<typeof privateCost> {
  return { id: "app", organizationId: "org-a", budgetId: "budget-a", configurationId: "config", productId: "product", scope: "SHARED_EXECUTION", scopeKey: "execution", executionId: "execution", inclusion: "INCLUDED_CHARGED", front: "FINAL", snapshot: configuration({ ...draft(), serviceClass: "TRANSPORT", mode: "FIXED_EXECUTION" }), parameters: { people: null, serviceDays: null, contextualServiceDays: 3 }, override: null, coverageIds: ["line-a", "line-b"], historicalCoverageIds: [], coverageState: "RESOLVED", privateCost };
}
function context(): ServiceBindingContext {
  return { organizationId: "org-a", budgetId: "budget-a", configuration: { id: "config", organizationId: "org-a", productId: "product", serviceClass: "TRANSPORT" }, executions: [{ id: "execution", organizationId: "org-a", budgetId: "budget-a" }], lines: ["line-a", "line-b"].map(id => ({ id, organizationId: "org-a", budgetId: "budget-a", excluded: false })) };
}

test("configuración distingue mínimo explícito0 de unknown y separa clases/unidades admitidas", () => {
  assert.equal(configuration({ ...draft(), minimumPrice: "" }).minimumPrice, null);
  assert.equal(configuration({ ...draft(), minimumPrice: "0" }).minimumPrice, 0);
  assert.equal(configuration({ ...draft(), tax: "" }).tax, null);
  for (const value of ["-1", "1.5", "2147483648", "NaN", " 0", "false"]) assert.equal(readServiceConfigurationDraft({ ...draft(), minimumPrice: value }).ok, false);
  for (const serviceClass of ["TRANSPORT", "INSTALLATION"] as const) {
    assert.equal(configuration({ ...draft(), serviceClass, mode: "FIXED_EXECUTION" }).unit, "PYG_PER_EXECUTION");
    for (const mode of ["PERSON_DAY", "FIXED_EVENT"] as const) assert.equal(readServiceConfigurationDraft({ ...draft(), serviceClass, mode }).ok, false);
  }
  assert.equal(readServiceConfigurationDraft({ ...draft(), mode: "FIXED_EXECUTION" }).ok, false);
});

test("X−1/X/X+1 y0 resuelven sólo el frente elegido, sin inferir mayorista por duración", () => {
  const config = configuration();
  for (const [days, finalPrice, wholesalePrice] of [[2, 1200, 800], [3, 900, 800], [4, 900, 800], [5, 900, 600], [6, 900, 600]]) {
    for (const [front, expected] of [["FINAL", finalPrice], ["WHOLESALE", wholesalePrice]] as const) {
      const result = serviceTariffPreview(config, front, { people: 2, serviceDays: days, contextualServiceDays: null });
      assert.equal(result.ok, true);
      if (result.ok) { assert.equal(result.value.front, front); assert.equal(result.value.tariff, expected); }
    }
  }
  const disabled = configuration({ ...draft(), final: { ...draft().final, fromDays: "0" } });
  const result = serviceTariffPreview(disabled, "FINAL", { people: 2, serviceDays: 9999, contextualServiceDays: null });
  assert.ok(result.ok); assert.equal(result.value.tariff, 1200);
});

test("fijo exige contexto sólo con umbral, nunca brazo variable ni días de alquiler implícitos", () => {
  const fixed = application();
  assert.equal(serviceTariffPreview(fixed.snapshot, "FINAL", { people: null, serviceDays: null, contextualServiceDays: null }).ok, false);
  for (const value of [0, -1, 1.5, 10000]) assert.equal(serviceTariffPreview(fixed.snapshot, "FINAL", { people: null, serviceDays: null, contextualServiceDays: value }).ok, false);
  assert.equal(serviceTariffPreview(fixed.snapshot, "FINAL", { people: 2, serviceDays: 3, contextualServiceDays: 3 }).ok, false);
  const noRule = configuration({ ...draft(), serviceClass: "TRANSPORT", mode: "FIXED_EXECUTION", final: { ...draft().final, fromDays: "0" } });
  assert.equal(serviceTariffPreview(noRule, "FINAL", { people: null, serviceDays: null, contextualServiceDays: null }).ok, true);
});

test("sin cargo no borra mínimo/costo y con cargo exige mínimo acreditado e IVA homogéneo", () => {
  const config = configuration({ ...draft(), minimumPrice: "" });
  const parameters = { people: 2, serviceDays: 3, contextualServiceDays: null };
  assert.equal(serviceChargeInputError(config, "FINAL", parameters, "INCLUDED_FREE", null, "IVA10"), null);
  assert.ok(serviceChargeInputError(config, "FINAL", parameters, "INCLUDED_CHARGED", null, "IVA10"));
  assert.ok(serviceChargeInputError(config, "FINAL", parameters, "INCLUDED_FREE", null, "IVA5"));
  const missing = configuration({ ...draft(), minimumPrice: "0", final: { normalPrice: "", fromDays: "0", fromPrice: "" } });
  assert.ok(serviceChargeInputError(missing, "FINAL", parameters, "INCLUDED_CHARGED", null, "IVA10"));
  assert.equal(serviceChargeInputError(missing, "FINAL", parameters, "INCLUDED_CHARGED", { amount: 1000, unit: "PYG_PER_PERSON_DAY" }, "IVA10"), null);
  assert.ok(serviceChargeInputError(missing, "FINAL", parameters, "INCLUDED_CHARGED", { amount: 1000, unit: "PYG_PER_EVENT" }, "IVA10"));
  const original = application();
  const free = resolveServiceCoverage(original, { coverageIds: original.coverageIds, inclusion: "INCLUDED_FREE" }, context());
  assert.ok(free.ok); assert.equal(free.value.privateCost, privateCost); assert.equal(free.value.snapshot, original.snapshot); assert.equal(free.value.snapshot.minimumPrice, 500);
});

test("ejecución identifica cargo compartido único, traslado/instalación separados sin aliasLINE", () => {
  const current = application(), bindings = context();
  assert.equal(serviceBindingError(current, bindings), null);
  assert.equal(serviceApplicationKey(current), serviceApplicationKey({ ...current, id: "second-render", coverageIds: ["line-a"] }));
  const installation = { ...current, configurationId: "installation-config", snapshot: { ...current.snapshot, serviceClass: "INSTALLATION" as const } };
  assert.notEqual(serviceApplicationKey(current), serviceApplicationKey(installation));
  assert.equal(duplicateServiceApplicationError([current, { ...installation, id: "installation" }]), null);
  assert.ok(duplicateServiceApplicationError([current, { ...current, id: "duplicate", coverageIds: ["line-a"] }]));
  assert.equal(duplicateServiceApplicationError([current, { ...current, id: "second", executionId: "execution-2", scopeKey: "execution-2" }]), null);
  assert.notEqual(serviceApplicationKey(current), serviceApplicationKey({ ...current, executionId: "execution-2", scopeKey: "execution-2" }));
  assert.ok(serviceBindingError({ ...current, scope: "LINE", scopeKey: "line-a", executionId: null }, bindings));
  assert.ok(serviceBindingError({ ...current, executionId: null }, bindings));
  assert.equal(Object.hasOwn(current, "inventoryId"), false);
});

test("bindings rechazan cobertura/configuración/ejecución de otra empresa o presupuesto y IDs duplicados", () => {
  const original = application(), bindings = context();
  for (const field of ["organizationId", "budgetId"] as const) {
    assert.ok(serviceBindingError(original, { ...bindings, lines: bindings.lines.map(row => ({ ...row, [field]: "foreign" })) }));
    assert.ok(serviceBindingError(original, { ...bindings, executions: bindings.executions.map(row => ({ ...row, [field]: "foreign" })) }));
  }
  assert.ok(serviceBindingError(original, { ...bindings, configuration: { ...bindings.configuration, organizationId: "foreign" } }));
  assert.ok(serviceBindingError({ ...original, coverageIds: ["line-a", "line-a"] }, bindings));
  assert.ok(serviceBindingError({ ...original, coverageIds: ["missing"] }, bindings));
  assert.ok(serviceBindingError(original, { ...bindings, configuration: { ...bindings.configuration, serviceClass: "INSTALLATION" } }));
});

test("retiro parcial resuelve en una acción; retiro total sólo explícito noincluido, sin mutar costo/origen", () => {
  const current = application(), before = structuredClone(current), bindings = context();
  const afterRetiringA = { ...bindings, lines: bindings.lines.map(row => ({ ...row, excluded: row.id === "line-a" })) };
  const partial = resolveServiceCoverage(current, { coverageIds: ["line-b"], inclusion: current.inclusion }, afterRetiringA);
  assert.ok(partial.ok); assert.equal(partial.value.coverageState, "RESOLVED"); assert.equal(partial.value.id, current.id); assert.equal(partial.value.snapshot, current.snapshot); assert.equal(partial.value.privateCost, privateCost);
  const invalid = resolveServiceCoverage(current, { coverageIds: [], inclusion: "INCLUDED_CHARGED" }, bindings);
  assert.equal(invalid.ok, false); assert.equal(invalid.status, 400); assert.deepEqual(current, before);
  const removed = resolveServiceCoverage(current, { coverageIds: [], inclusion: "NOT_INCLUDED" }, bindings);
  assert.ok(removed.ok); assert.equal(removed.value.privateCost, privateCost); assert.deepEqual(removed.value.historicalCoverageIds, ["line-a", "line-b"]);
  // Restaurar líneas del contexto no invoca una transición ni rehabilita el cargo.
  assert.equal(serviceBindingError(removed.value, bindings), null); assert.equal(removed.value.inclusion, "NOT_INCLUDED");
  const protectedResult = resolveServiceCoverage(current, { coverageIds: [], inclusion: "NOT_INCLUDED" }, bindings, true);
  assert.equal(protectedResult.ok, false); assert.equal(protectedResult.status, 409);
});

test("cambio de brazo preserva costo/cobertura y exige override compatible explícito, sin doble brazo", () => {
  const current = { ...application(), snapshot: configuration(), parameters: { people: 2, serviceDays: 3, contextualServiceDays: null }, override: { amount: 1100, unit: "PYG_PER_PERSON_DAY" as const } };
  const fixed = configuration({ ...draft(), mode: "FIXED_EVENT" });
  const parameters = { people: null, serviceDays: null, contextualServiceDays: 3 };
  assert.equal(transitionServiceMode(current, { configuration: fixed, parameters }).ok, false);
  assert.equal(transitionServiceMode(current, { configuration: fixed, parameters: { ...parameters, people: 2 }, override: null }).ok, false);
  const next = transitionServiceMode(current, { configuration: fixed, parameters, override: { amount: 2500, unit: "PYG_PER_EVENT" } });
  assert.ok(next.ok); assert.equal(next.value.privateCost, privateCost); assert.equal(next.value.coverageIds, current.coverageIds); assert.equal(next.value.front, current.front); assert.equal(current.snapshot.mode, "PERSON_DAY");
});
