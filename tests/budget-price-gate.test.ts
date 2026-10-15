import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { lineMissingPrice, missingPriceMessage, missingPriceNames } from "../lib/budget-price-gate";
import { catalogLineAmounts } from "../lib/server/line-pricing";
import { isSquareEnough } from "../lib/server/category-image";

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("«falta precio»: precio 0 sin confirmar bloquea; gratis a propósito, excluida y precio real no", () => {
  assert.equal(lineMissingPrice({ unitPrice: 0 }), true);
  assert.equal(lineMissingPrice({ unitPrice: 0, freeOnPurpose: false }), true);
  assert.equal(lineMissingPrice({ unitPrice: 0, freeOnPurpose: true }), false);
  assert.equal(lineMissingPrice({ unitPrice: 0, excluded: true }), false);
  assert.equal(lineMissingPrice({ unitPrice: 15000 }), false);
  assert.deepEqual(missingPriceNames([{ name: "Plato", unitPrice: 0 }, { name: "Copa", unitPrice: 800 }, { name: "Flete", unitPrice: 0, freeOnPurpose: true }]), ["Plato"]);
});

test("el mensaje nombra las líneas y la acción que se frena", () => {
  const one = missingPriceMessage(["Plato"], "aprobar");
  assert.match(one, /Falta precio en esta línea: «Plato»/);
  assert.match(one, /antes de aprobar el presupuesto/);
  const many = missingPriceMessage(["A", "B", "C", "D", "E"], "cobrar");
  assert.match(many, /«A», «B», «C» y 2 más/);
  assert.match(many, /antes de cobrar/);
});

test("catalogLineAmounts conserva su contrato y suma missingPrice cuando no hay ningún precio", () => {
  const noPrice = catalogLineAmounts(undefined, null, 3, 2, "RETAIL");
  assert.deepEqual([noPrice.unitPrice, noPrice.subtotal, noPrice.missingPrice], [0, 0, true]);
  assert.equal(noPrice.fromStore, null);
  const seen = catalogLineAmounts(undefined, 5000, 3, 2, "RETAIL");
  assert.deepEqual([seen.unitPrice, seen.days, seen.subtotal, seen.missingPrice], [5000, 2, 30000, false]);
});

test("la foto de categoría tiene que ser cuadrada (2 % de tolerancia)", () => {
  assert.equal(isSquareEnough(1200, 1200), true);
  assert.equal(isSquareEnough(1200, 1180), true);
  assert.equal(isSquareEnough(1600, 1200), false);
  assert.equal(isSquareEnough(0, 0), false);
});

test("la regla está cableada en enviar, aprobar (panel, portal, comparación, firma) y cobrar", () => {
  assert.match(repoFile("app/api/admin/budgets/send/route.ts"), /missingPriceNames\(budget\.items\)[\s\S]{0,160}"enviar"/);
  assert.match(repoFile("app/api/admin/budgets/approval/route.ts"), /budgetPriceGate\(organizationId, budget\.id, "aprobar"\)/);
  assert.match(repoFile("app/api/admin/budgets/route.ts"), /status === "APPROVED" \|\| status === "SENT"/);
  assert.match(repoFile("app/api/portal/budget/[token]/approve/route.ts"), /budgetPriceGate\(/);
  assert.match(repoFile("app/api/portal/comparison/[token]/approve/route.ts"), /budgetPriceGate\(/);
  assert.match(repoFile("lib/server/signature/admin.ts"), /budgetPriceGate\(/);
  assert.match(repoFile("lib/server/signature/portal.ts"), /budgetPriceGate\(/);
  assert.match(repoFile("app/api/admin/finance/route.ts"), /budgetPriceGate\(organizationId, budget\.id, "cobrar", tx\)/);
  assert.match(repoFile("lib/server/expected-payments.ts"), /budgetPriceGate\(input\.organizationId, expected\.budgetId, "cobrar"\)/);
});
