import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { portalBudgetView } from "../lib/server/budget-portal";

/**
 * El cliente nunca ve los costos internos ni el margen (issue #65). Acá se
 * arma la vista pública con un presupuesto **con costos cargados** y se verifica
 * que la respuesta serializada no tenga ninguna clave de costo/margen; además se
 * revisa la fuente del imprimible y del portal para que no aparezcan campos
 * internos. Si alguien agrega un costo a la vista pública, este test falla.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** Presupuesto con todos los costos internos cargados (materiales, mano de obra e ítems). */
function budgetWithCosts() {
  return {
    id: "bud_costs",
    organizationId: "org_1",
    title: "Paneles para estudio",
    status: "SENT",
    subtotal: 12_000_000,
    discount: 500_000,
    total: 11_500_000,
    costEstimate: 2_222_222,
    materialCost: 5_105_000,
    laborCost: 3_111_111,
    advanceAmount: 3_450_000,
    paymentTerms: "Anticipo del 30 %; saldo a 30 días.",
    installmentsJson: [{ label: "Saldo", amount: 8_050_000, dueAt: "2026-10-23" }],
    validUntil: new Date("2026-10-01T12:00:00.000Z"),
    deliveryAt: new Date("2026-10-10T12:00:00.000Z"),
    ivaType: "IVA10",
    warranty: "12 meses por defectos de fabricación.",
    notes: "Montaje incluido.",
    createdAt: new Date("2026-09-23T12:00:00.000Z"),
    viewedAt: null,
    approvedAt: null,
    approvedByName: null,
    approvalMethod: null,
    approvalNote: null,
    revisionRequestedAt: null,
    revisionNote: null,
    organization: { name: "LedBox Demo", slug: "ledbox", paymentDetails: { bank: "Ueno Bank" } },
    client: { name: "Ana", company: "Scale Strategy Group EAS", contactName: "Ana", contactRole: "Compras" },
    event: null,
    items: [
      { id: "it_1", name: "Panel LED", quantity: 4, days: 1, unitPrice: 3_000_000, costPrice: 1_234_567, subtotal: 12_000_000, notes: null },
    ],
    payments: [],
    expectedPayments: [],
    paymentProofs: [],
    changeRequests: [],
  };
}

function keysDeep(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const row of value) keysDeep(row, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    for (const [key, row] of Object.entries(value)) {
      acc.add(key);
      keysDeep(row, acc);
    }
  }
  return acc;
}

test("la vista pública no expone ningún costo ni margen", () => {
  const view = portalBudgetView(budgetWithCosts() as never, []);
  const keys = [...keysDeep(view)];
  const forbidden = keys.filter((key) => /cost|margin|material|labor|profit/i.test(key));
  assert.deepEqual(forbidden, [], `claves internas en la vista pública: ${forbidden.join(", ")}`);
  // Y los montos internos tampoco viajan como números en ningún campo.
  const numbers = new Set<number>();
  const collect = (value: unknown) => {
    if (typeof value === "number") numbers.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(view);
  for (const internal of [5_105_000, 3_111_111, 2_222_222, 1_234_567, 8_105_000]) {
    assert.ok(!numbers.has(internal), `el monto interno ${internal} no debe viajar al cliente`);
  }
  // Los campos del cliente sí viajan (issue #65).
  assert.equal(view.deliveryAt, "2026-10-10T12:00:00.000Z");
  assert.equal(view.ivaType, "IVA10");
  assert.equal(view.warranty, "12 meses por defectos de fabricación.");
});

test("el portal y el imprimible no nombran campos internos de costo", () => {
  for (const file of [
    "app/(portal)/_components/PortalBudgetView.tsx",
    "app/(admin)/(print)/imprimir/presupuesto/[id]/page.tsx",
    "app/(portal)/_components/PortalBudgetStatic.tsx",
  ]) {
    const source = repoFile(file);
    for (const field of ["materialCost", "laborCost", "costEstimate", "costPrice"]) {
      assert.doesNotMatch(source, new RegExp(field), `${file} no debe referirse a ${field}`);
    }
  }
});

test("la vista pública arma los ítems solo con precio de venta", () => {
  const source = repoFile("lib/server/budget-portal.ts");
  // El mapeo de ítems de `portalBudgetView` no puede incluir el costo unitario.
  const itemMapping = source.match(/items: budget\.items\.map\(\(item\) => \(\{[\s\S]*?\}\)\),/)?.[0] ?? "";
  assert.ok(itemMapping, "el mapeo de ítems de la vista pública existe");
  assert.doesNotMatch(itemMapping, /costPrice|costEstimate/);
});
