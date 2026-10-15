import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_LATE_FEE,
  cancellationPolicyLines,
  cancellationPolicyOf,
  cancellationRetention,
  cancellationTierFor,
  customChargeAmount,
  damageCharge,
  lateFeeAmount,
  lateUnits,
  offeredCustomCharges,
  parseCancellationPolicy,
  settleRental,
  suggestSecurityDeposit,
  type CustomChargeType,
  type DepositPolicy,
} from "../lib/rental-charges";
import { RENTAL_SETTINGS_DEFAULTS, parseRentalSettingsPatch, toRentalSettingsView } from "../lib/server/rental-settings";
import { securityDepositPublic } from "../lib/budget-security-deposit";

const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (minutes: number) => new Date(Date.UTC(2032, 0, 10, 12, 0) + minutes * 60_000);
const due = at(0);

// ── P1-2 · QA 1: sin fila rigen los defaults de §5 ──────────────────────────
test("sin fila de ajustes rigen los defaults: recargo 10 % por día con 2 h, rotura 100 %, cancelación de 3 tramos", () => {
  const view = toRentalSettingsView(null);
  assert.deepEqual(view, RENTAL_SETTINGS_DEFAULTS);
  assert.equal(view.lateFeeKind, "PERCENT");
  assert.equal(view.lateFeeUnit, "DAY");
  assert.equal(view.lateFeeValue, 10);
  assert.equal(view.lateGraceMinutes, 120);
  assert.equal(view.damageChargePercent, 100);
  assert.equal(view.securityDepositMode, "NONE");
  assert.deepEqual(view.cancellationPolicy, DEFAULT_CANCELLATION_POLICY);
  assert.equal(view.rentalTerms, null);
});

// ── P1-2 · QA 2: negativos y % > 100 rechazados ─────────────────────────────
test("el parche rechaza negativos, decimales, % fuera de rango y valores de otro tipo", () => {
  const bad: Array<Record<string, unknown>> = [
    { lateFeeValue: -1 },
    { lateFeeValue: 1.5 },
    { lateGraceMinutes: -5 },
    { lateGraceMinutes: 24 * 60 + 1 },
    { damageChargePercent: -1 },
    { damageChargePercent: 501 },
    { securityDepositPercent: 101 },
    { securityDepositPercent: 0 },
    { securityDepositMode: "SIEMPRE" },
    { securityDepositPurpose: "OTRO" },
    { securityDepositCalc: "RARO" },
    { lateFeeKind: "MITAD" },
    { lateFeeUnit: "SEMANA" },
    { cancellationPolicy: [{ minDaysBefore: 15, retainPercent: 101 }, { minDaysBefore: 0, retainPercent: 100 }] },
    { cancellationPolicy: [{ minDaysBefore: -1, retainPercent: 10 }] },
    { cancellationPolicy: [{ minDaysBefore: 15, retainPercent: 0 }] },
    { cancellationPolicy: [] },
    { customCharges: [{ name: "", amount: 1000, unit: "PIECE" }] },
    { customCharges: [{ name: "Lavado", amount: -5, unit: "PIECE" }] },
    { customCharges: [{ name: "Lavado", amount: 1000, unit: "KILO" }] },
    { securityDepositRules: [{ amount: 1000 }] },
    { securityDepositRules: [{ categoryId: "c1", amount: -1 }] },
    { rentalTerms: "x".repeat(4001) },
  ];
  for (const body of bad) assert.equal(parseRentalSettingsPatch(body).ok, false, JSON.stringify(body));
});

test("el parche acepta una configuración completa y la devuelve normalizada", () => {
  const parsed = parseRentalSettingsPatch({
    securityDepositMode: "OPTIONAL",
    securityDepositPurpose: "RESERVE",
    securityDepositCalc: "PER_PRODUCT",
    securityDepositRules: [{ categoryId: "cat-sofa", amount: 300_000 }, { inventoryId: "item-1", amount: 50_000 }],
    lateFeeKind: "FIXED",
    lateFeeUnit: "HOUR",
    lateFeeValue: 100_000,
    lateGraceMinutes: 30,
    damageChargePercent: 80,
    customCharges: [{ name: "Lavado de pieza", amount: 1000, unit: "PIECE", categoryId: "cat-vajilla" }],
    cancellationPolicy: [{ minDaysBefore: 0, retainPercent: 100 }, { minDaysBefore: 30, retainPercent: 0 }, { minDaysBefore: 10, retainPercent: 50 }],
    rentalTerms: "  Se devuelve limpio.  ",
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.data.rentalTerms, "Se devuelve limpio.");
  assert.deepEqual(parsed.data.cancellationPolicy?.map((tier) => tier.minDaysBefore), [30, 10, 0], "los tramos quedan de más a menos anticipación");
  assert.equal(parsed.data.customCharges?.[0].name, "Lavado de pieza");
  assert.ok(parsed.data.customCharges?.[0].id, "cada cargo recibe un id");
});

// ── P1-4 · recargo por demora ───────────────────────────────────────────────
test("recargo por demora por defecto: 2 días tarde con un alquiler de 600.000 = 120.000", () => {
  const late = lateUnits(DEFAULT_LATE_FEE, due, at(2 * 1440));
  assert.equal(late.units, 2);
  const fee = lateFeeAmount(DEFAULT_LATE_FEE, 600_000, late.units);
  assert.deepEqual(fee, { unitAmount: 60_000, amount: 120_000 });
});

test("la tolerancia no cobra: 2 h de gracia", () => {
  assert.equal(lateUnits(DEFAULT_LATE_FEE, due, at(120)).units, 0, "justo 2 h: no se cobra");
  assert.equal(lateUnits(DEFAULT_LATE_FEE, due, at(-30)).units, 0, "a tiempo");
  assert.equal(lateUnits(DEFAULT_LATE_FEE, due, at(121)).units, 1, "pasada la gracia se cobra el día empezado");
  assert.equal(lateUnits(DEFAULT_LATE_FEE, due, at(1441)).units, 2, "un minuto más de 24 h = 2 días");
});

test("recargo por hora con monto fijo: 100.000 por hora, 3 h tarde con 30 min de tolerancia = 300.000", () => {
  const config = { kind: "FIXED" as const, unit: "HOUR" as const, value: 100_000, graceMinutes: 30 };
  const late = lateUnits(config, due, at(3 * 60));
  assert.equal(late.units, 3);
  assert.deepEqual(lateFeeAmount(config, 999_999, late.units), { unitAmount: 100_000, amount: 300_000 }, "el fijo no depende del alquiler");
  assert.equal(lateUnits(config, due, at(30)).units, 0);
  assert.equal(lateUnits(config, due, at(31)).units, 1);
});

test("recargo en % por hora y tope Int", () => {
  const config = { kind: "PERCENT" as const, unit: "HOUR" as const, value: 5, graceMinutes: 0 };
  assert.deepEqual(lateFeeAmount(config, 1_000_000, 4), { unitAmount: 50_000, amount: 200_000 });
  const huge = lateFeeAmount({ kind: "FIXED", unit: "DAY", value: 2_000_000_000, graceMinutes: 0 }, 0, 5);
  assert.ok(huge.amount <= 2_147_483_647);
});

// ── P1-4 · QA 1: roturas y faltantes ────────────────────────────────────────
test("12 copas rotas × 15.000 = 180.000 al 100 %, y el % configurable", () => {
  assert.deepEqual(damageCharge(15_000, 12, 100), { unitAmount: 15_000, amount: 180_000 });
  assert.deepEqual(damageCharge(15_000, 12, 50), { unitAmount: 7_500, amount: 90_000 });
  assert.equal(damageCharge(0, 12, 100).amount, 0, "sin costo de reposición no se inventa un monto");
});

// ── Cargos personalizados por categoría ─────────────────────────────────────
test("cargo personalizado por categoría: se ofrece solo si volvió algo de esa categoría (o su subcategoría)", () => {
  const types: CustomChargeType[] = [
    { id: "t1", name: "Lavado de pieza", amount: 1_000, unit: "PIECE", categoryId: "vajilla" },
    { id: "t2", name: "Mancha de mantel", amount: 30_000, unit: "PIECE", categoryId: "manteleria" },
    { id: "t3", name: "Armado extra", amount: 150_000, unit: "EVENT", categoryId: null },
  ];
  const offers = offeredCustomCharges(types, [
    { categoryIds: ["copas", "vajilla"], quantity: 12 },
    { categoryIds: ["sillas"], quantity: 40 },
  ]);
  assert.deepEqual(offers.map((offer) => [offer.type.id, offer.suggestedQuantity]), [["t1", 12], ["t3", 1]]);
  assert.deepEqual(customChargeAmount(types[0], 12), { quantity: 12, unitAmount: 1_000, amount: 12_000 });
  assert.deepEqual(customChargeAmount(types[2], 9), { quantity: 1, unitAmount: 150_000, amount: 150_000 }, "por evento no multiplica");
});

// ── Garantía: cálculo ───────────────────────────────────────────────────────
test("garantía: monto fijo, % del pedido y por producto o categoría (el producto gana)", () => {
  const base: DepositPolicy = { mode: "ALWAYS", calc: "FIXED", fixedAmount: 500_000, percent: null, rules: [] };
  const order = { total: 2_000_000, lines: [] };
  assert.equal(suggestSecurityDeposit(base, order), 500_000);
  assert.equal(suggestSecurityDeposit({ ...base, mode: "NONE" }, order), null, "no la usa: no propone");
  assert.equal(suggestSecurityDeposit({ ...base, calc: "PERCENT", percent: 25 }, order), 500_000);
  assert.equal(suggestSecurityDeposit({ ...base, calc: "PERCENT", percent: null }, order), null);
  const rules = [
    { categoryId: "lounge", amount: 300_000 },
    { inventoryId: "sofa-xl", amount: 800_000 },
  ];
  const lines = [
    { inventoryId: "sofa-xl", categoryIds: ["lounge"], quantity: 2 },
    { inventoryId: "puff", categoryIds: ["lounge"], quantity: 4 },
    { inventoryId: "copa", categoryIds: ["vajilla"], quantity: 100 },
  ];
  assert.equal(suggestSecurityDeposit({ ...base, calc: "PER_PRODUCT", rules }, { total: 0, lines }), 2 * 800_000 + 4 * 300_000);
  assert.equal(suggestSecurityDeposit({ ...base, calc: "PER_PRODUCT", rules }, { total: 0, lines: [lines[2]] }), null, "sin regla aplicable no hay garantía");
});

// ── Cancelación con 3 tramos ────────────────────────────────────────────────
test("cancelación con 3 tramos: 15+ días 0 %, 7 a 14 días 50 %, menos de 7 días 100 %", () => {
  const policy = DEFAULT_CANCELLATION_POLICY;
  assert.equal(cancellationTierFor(policy, 30).retainPercent, 0);
  assert.equal(cancellationTierFor(policy, 15).retainPercent, 0);
  assert.equal(cancellationTierFor(policy, 14).retainPercent, 50);
  assert.equal(cancellationTierFor(policy, 7).retainPercent, 50);
  assert.equal(cancellationTierFor(policy, 6).retainPercent, 100);
  assert.equal(cancellationTierFor(policy, -2).retainPercent, 100, "ya pasó el evento");
  assert.deepEqual(cancellationRetention(policy, { daysBefore: 10, advancePaid: 1_000_001 }), { percent: 50, retained: 500_001, refundable: 500_000 });
  assert.deepEqual(cancellationRetention(policy, { daysBefore: 20, advancePaid: 1_000_000 }), { percent: 0, retained: 0, refundable: 1_000_000 });
  assert.deepEqual(cancellationRetention(policy, { daysBefore: 2, advancePaid: 1_000_000 }), { percent: 100, retained: 1_000_000, refundable: 0 });
  assert.deepEqual(cancellationRetention(policy, { daysBefore: 2, advancePaid: 0 }), { percent: 100, retained: 0, refundable: 0 });
});

test("la política de cancelación se escribe en texto para el portal y el impreso", () => {
  assert.deepEqual(cancellationPolicyLines(DEFAULT_CANCELLATION_POLICY), [
    "15 días o más antes del evento: no se retiene la seña.",
    "De 7 a 14 días antes del evento: se retiene el 50 % de la seña.",
    "Menos de 7 días antes del evento: se retiene toda la seña.",
  ]);
  assert.equal(parseCancellationPolicy([{ minDaysBefore: 5, retainPercent: 10 }, { minDaysBefore: 5, retainPercent: 20 }, { minDaysBefore: 0, retainPercent: 100 }]).ok, false, "días repetidos");
  assert.deepEqual(cancellationPolicyOf({ roto: true }), DEFAULT_CANCELLATION_POLICY, "una política dañada cae a la de fábrica");
});

// ── P1-4 · liquidación: QA 2 y 3, garantía de daños vs. de reserva ──────────
test("garantía de daños: 500.000 y cargos 180.000 → KEPT_PARTIAL, 320.000 a devolver, nada que cobrar", () => {
  assert.deepEqual(settleRental({ deposit: 500_000, depositHeld: true, purpose: "DAMAGES", chargesTotal: 180_000 }), { retained: 180_000, returned: 320_000, extra: 0, depositStatus: "KEPT_PARTIAL" });
});

test("garantía de daños: cargos 700.000 sobre 500.000 → KEPT + extra 200.000", () => {
  assert.deepEqual(settleRental({ deposit: 500_000, depositHeld: true, purpose: "DAMAGES", chargesTotal: 700_000 }), { retained: 500_000, returned: 0, extra: 200_000, depositStatus: "KEPT" });
  assert.equal(settleRental({ deposit: 500_000, depositHeld: true, purpose: "DAMAGES", chargesTotal: 500_000 }).depositStatus, "KEPT", "justo igual: se queda toda");
});

test("garantía de daños sin cargos: se devuelve entera", () => {
  assert.deepEqual(settleRental({ deposit: 500_000, depositHeld: true, purpose: "DAMAGES", chargesTotal: 0 }), { retained: 0, returned: 500_000, extra: 0, depositStatus: "RETURNED" });
});

test("garantía de reserva: ya se descontó del saldo, todos los cargos van como extra y la garantía no se devuelve", () => {
  assert.deepEqual(settleRental({ deposit: 500_000, depositHeld: true, purpose: "RESERVE", chargesTotal: 180_000 }), { retained: 0, returned: 0, extra: 180_000, depositStatus: null });
});

test("sin garantía en custodia: todo va como extra", () => {
  assert.deepEqual(settleRental({ deposit: 0, depositHeld: false, purpose: "DAMAGES", chargesTotal: 90_000 }), { retained: 0, returned: 0, extra: 90_000, depositStatus: null });
  assert.deepEqual(settleRental({ deposit: 500_000, depositHeld: false, purpose: "DAMAGES", chargesTotal: 90_000 }).extra, 90_000, "garantía pendiente de recibir: no se descuenta");
});

test("retenido + devuelto = garantía y retenido + extra = cargos, al guaraní", () => {
  for (const [deposit, charges] of [[500_001, 0], [500_001, 1], [500_001, 250_000], [500_001, 500_001], [500_001, 900_007], [1, 1_000]] as const) {
    const result = settleRental({ deposit, depositHeld: true, purpose: "DAMAGES", chargesTotal: charges });
    assert.equal(result.retained + result.returned, deposit);
    assert.equal(result.retained + result.extra, charges);
  }
});

test("la garantía de reserva se muestra como recibida y descontada, no «en custodia»", () => {
  const reserve = securityDepositPublic({ securityDeposit: 500_000, securityDepositStatus: "HELD", securityDepositRetained: null, securityDepositPurpose: "RESERVE" });
  assert.equal(reserve?.statusLabel, "Recibida · descontada del saldo");
  assert.equal(reserve?.purpose, "RESERVE");
  assert.equal(securityDepositPublic({ securityDeposit: 500_000, securityDepositStatus: "HELD", securityDepositRetained: null })?.statusLabel, "En custodia");
});

// ── Permisos, portal e impreso (el contrato vive en el código) ──────────────
test("OPERATIONS no ve ni decide plata: la liquidación exige budgets.write y su lectura excluye a OPERATIONS", () => {
  const route = repoFile("app/api/admin/budgets/settlement/route.ts");
  assert.match(route, /requireAdminContext\("budgets\.write"\)/);
  assert.match(route, /role === "OPERATIONS"\) return jsonError\("Forbidden", 403\)/);
  const caps = repoFile("lib/server/permissions.ts");
  const operations = caps.slice(caps.indexOf("OPERATIONS_CAPABILITIES"), caps.indexOf("FINANCE_CAPABILITIES"));
  assert.ok(!operations.includes("budgets.write"), "OPERATIONS no tiene budgets.write");
});

test("OPERATIONS propone al devolver pero no liquida: returnAssignment solo escribe cargos PROPOSED", () => {
  const source = repoFile("lib/server/rental-settlement.ts");
  const propose = source.slice(source.indexOf("export async function proposeReturnCharges"), source.indexOf("function describeLate"));
  assert.ok(!propose.includes('"APPLIED"') && !propose.includes("status:"), "proponer nunca aplica");
  assert.match(repoFile("lib/server/inventory-operations.ts"), /proposeReturnCharges\(tx,/);
});

test("las condiciones y la política de cancelación llegan al portal y al impreso", () => {
  assert.match(repoFile("app/(portal)/_components/PortalBudgetView.tsx"), /Condiciones del alquiler/);
  assert.match(repoFile("app/(portal)/_components/PortalBudgetView.tsx"), /Política de cancelación/);
  assert.match(repoFile("app/(admin)/(print)/imprimir/presupuesto/[id]/page.tsx"), /Condiciones del alquiler/);
  assert.match(repoFile("lib/server/budget-portal.ts"), /loadPortalRental/);
});

test("la migración es aditiva e idempotente", () => {
  const sql = repoFile("prisma/migrations/202610250001_rental_charges_settlement/migration.sql");
  assert.ok(!/DROP\s|DELETE\s+FROM|TRUNCATE/i.test(sql));
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'extra'/);
  for (const line of sql.split("\n").filter((l) => /^ALTER TABLE .* ADD COLUMN/.test(l))) assert.match(line, /IF NOT EXISTS/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "RentalCharge"/);
});
