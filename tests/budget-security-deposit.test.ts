import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { budgetPaymentConditionPayload, defaultDepositPlanRows, resolveBudgetPaymentPlan } from "../lib/budget-payment-plan";
import { newBudgetDefaults, securityDepositPublic, securityDepositTransition } from "../lib/budget-security-deposit";
import { depositPlan } from "../lib/server/catalog-convert";
import { parseRentalSettingsPatch } from "../lib/server/rental-settings";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("seña 50 % de 1.000.001 Gs cierra al guaraní con el saldo", () => {
  const rows = defaultDepositPlanRows(50, 1_000_001);
  assert.ok(rows);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "Seña 50 %");
  assert.equal(rows[1].label, "Saldo");
  assert.equal(rows[0].amount + rows[1].amount, 1_000_001);
  assert.equal(rows[0].amount, 500_001);
  assert.equal(rows[1].amount, 500_000);
  // El plan guardado se vuelve a resolver idéntico (recalcula si cambia el total).
  const again = resolveBudgetPaymentPlan(rows, 1_000_001);
  assert.ok(again.ok);
  assert.deepEqual(again.rows.map(budgetPaymentConditionPayload), rows);
  const edited = resolveBudgetPaymentPlan(rows, 1_000_003);
  assert.ok(edited.ok);
  assert.equal(edited.rows[0].amount + edited.rows[1].amount, 1_000_003);
});

test("la seña cierra al guaraní para totales y porcentajes raros", () => {
  for (const total of [1, 7, 99, 333_333, 1_000_001, 2_147_483_647]) {
    for (const percent of [1, 30, 33, 50, 67, 99, 100]) {
      const rows = defaultDepositPlanRows(percent, total);
      assert.ok(rows, `${percent}% de ${total}`);
      assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), total, `${percent}% de ${total}`);
    }
  }
});

test("sin depositPercent (o total 0) no hay seña", () => {
  for (const percent of [null, undefined, 0]) assert.equal(defaultDepositPlanRows(percent, 1_000_000), null);
  assert.equal(defaultDepositPlanRows(50, 0), null);
  assert.equal(defaultDepositPlanRows(101, 1000), null);
  assert.equal(defaultDepositPlanRows(12.5, 1000), null);
});

test("la conversión de preórdenes usa la misma función que el alta", () => {
  const converted = depositPlan(50, 1_000_001);
  assert.equal(converted.amount, 500_001);
  assert.deepEqual(converted.installments, defaultDepositPlanRows(50, 1_000_001));
  assert.equal(depositPlan(null, 1_000_001).amount, 0);
});

test("transiciones válidas de la garantía y montos exactos", () => {
  const held = { amount: 1_500_001, status: "HELD", retained: null };
  assert.deepEqual(securityDepositTransition({ amount: 1_500_001, status: "PENDING", retained: null }, "HELD"), { ok: true, status: "HELD", retained: null, returned: 0 });
  assert.deepEqual(securityDepositTransition(held, "RETURNED"), { ok: true, status: "RETURNED", retained: 0, returned: 1_500_001 });
  assert.deepEqual(securityDepositTransition(held, "KEPT"), { ok: true, status: "KEPT", retained: 1_500_001, returned: 0 });
  const partial = securityDepositTransition(held, "KEPT_PARTIAL", 400_001);
  assert.deepEqual(partial, { ok: true, status: "KEPT_PARTIAL", retained: 400_001, returned: 1_100_000 });
});

test("transiciones inválidas de la garantía", () => {
  const held = { amount: 1000, status: "HELD", retained: null };
  const pending = { amount: 1000, status: "PENDING", retained: null };
  for (const [state, to] of [[pending, "RETURNED"], [pending, "KEPT"], [held, "PENDING"], [held, "HELD"], [{ ...held, status: "RETURNED" }, "KEPT"], [{ ...held, status: "KEPT" }, "RETURNED"], [{ ...held, status: "KEPT_PARTIAL" }, "RETURNED"]] as const) {
    assert.equal(securityDepositTransition(state, to).ok, false, `${state.status} → ${to}`);
  }
  for (const retained of [undefined, 0, -1, 1000, 1001, 10.5, "500", null]) assert.equal(securityDepositTransition(held, "KEPT_PARTIAL", retained).ok, false, String(retained));
  assert.equal(securityDepositTransition(held, "RETURNED", 5).ok, false);
  assert.equal(securityDepositTransition({ amount: null, status: null, retained: null }, "HELD").ok, false);
  assert.equal(securityDepositTransition(held, "EXPLOTA").ok, false);
});

test("la vista del cliente de la garantía no lleva nada interno", () => {
  assert.equal(securityDepositPublic({ securityDeposit: null, securityDepositStatus: null, securityDepositRetained: null }), null);
  const view = securityDepositPublic({ securityDeposit: 2_000_000, securityDepositStatus: "KEPT_PARTIAL", securityDepositRetained: 300_000 });
  assert.deepEqual(view, { amount: 2_000_000, status: "KEPT_PARTIAL", statusLabel: "Retenida parcialmente", retained: 300_000, returned: 1_700_000 });
  assert.deepEqual(Object.keys(view!).sort(), ["amount", "retained", "returned", "status", "statusLabel"]);
  assert.equal(securityDepositPublic({ securityDeposit: 500, securityDepositStatus: "HELD", securityDepositRetained: null })!.returned, 0);
});

test("ajustes: la garantía por defecto es un monto entero positivo o vacía", () => {
  assert.deepEqual(parseRentalSettingsPatch({ securityDepositDefault: 1_500_000 }), { ok: true, data: { securityDepositDefault: 1_500_000 } });
  assert.deepEqual(parseRentalSettingsPatch({ securityDepositDefault: null }), { ok: true, data: { securityDepositDefault: null } });
  assert.deepEqual(parseRentalSettingsPatch({ securityDepositDefault: "" }), { ok: true, data: { securityDepositDefault: null } });
  for (const bad of [-1, 10.5, "1500000", true, 2_147_483_648]) assert.equal(parseRentalSettingsPatch({ securityDepositDefault: bad }).ok, false, String(bad));
});

test("la garantía no entra en la firma, en el total ni en los cobros", () => {
  assert.doesNotMatch(read("lib/server/signature/document.ts"), /securityDeposit/);
  assert.doesNotMatch(read("lib/budget-commercial.ts"), /securityDeposit/);
  assert.doesNotMatch(read("lib/server/expected-payments.ts"), /securityDeposit/);
  const route = read("app/api/admin/budgets/route.ts");
  assert.match(route, /requireAdminContext\("budgets\.write"\)/);
  // El portal solo recibe la vista pública (sin notas ni motivos internos).
  assert.match(read("lib/server/budget-portal.ts"), /securityDepositPublic\(/);
});

test("la migración es aditiva e idempotente", () => {
  const sql = read("prisma/migrations/202610150001_budget_security_deposit/migration.sql");
  assert.doesNotMatch(sql, /DROP |NOT NULL|DELETE |UPDATE /i);
  for (const line of sql.split("\n").filter((l) => /ADD COLUMN/.test(l))) assert.match(line, /IF NOT EXISTS/);
  assert.equal((sql.match(/ADD CONSTRAINT/g) ?? []).length, (sql.match(/duplicate_object/g) ?? []).length);
});

test("alta de presupuesto: seña de la empresa, sin política y plan editado", () => {
  const company = { depositPercent: 50, securityDepositDefault: 1_500_000 };
  const none = { depositPercent: null, securityDepositDefault: null };
  const byDefault = newBudgetDefaults({}, 1_000_001, company);
  assert.ok(byDefault.ok);
  assert.deepEqual(byDefault.installments, defaultDepositPlanRows(50, 1_000_001));
  assert.equal(byDefault.securityDeposit, 1_500_000);
  // Sin depositPercent ni garantía en la empresa: todo sigue como hoy.
  assert.deepEqual(newBudgetDefaults({}, 1_000_001, none), { ok: true, installments: null, securityDeposit: null });
  // La persona elige otro porcentaje, ninguno o quita la garantía.
  assert.deepEqual((newBudgetDefaults({ depositPercent: 30 }, 1000, company) as { installments: Array<{ label: string }> }).installments[0].label, "Seña 30 %");
  assert.equal((newBudgetDefaults({ depositPercent: null }, 1000, company) as { installments: unknown }).installments, null);
  assert.equal((newBudgetDefaults({ securityDeposit: null }, 1000, company) as { securityDeposit: unknown }).securityDeposit, null);
  // Un plan explícito se respeta y no se pisa con la seña; null = sin plan.
  const custom = [{ label: "Cuota única", type: "remainder", moment: "Contra entrega" }];
  const explicit = newBudgetDefaults({ installmentsJson: custom }, 1000, company);
  assert.ok(explicit.ok);
  assert.equal((explicit.installments as Array<{ label: string }>).length, 1);
  assert.equal((explicit.installments as Array<{ label: string }>)[0].label, "Cuota única");
  assert.equal((newBudgetDefaults({ installmentsJson: null }, 1000, company) as { installments: unknown }).installments, null);
  // Entradas inválidas se rechazan.
  for (const bad of [{ depositPercent: 101 }, { depositPercent: 12.5 }, { depositPercent: "50" }, { securityDeposit: -5 }, { securityDeposit: "x" }, { installmentsJson: [{ label: "", amount: 1 }] }]) {
    assert.equal(newBudgetDefaults(bad, 1000, company).ok, false, JSON.stringify(bad));
  }
});
