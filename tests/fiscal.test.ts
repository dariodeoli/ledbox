import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fiscalSummaryOf,
  grossToNet,
  invoiceLineSubtotal,
  invoiceNumberLabel,
  isMonthKey,
  monthKeyLabel,
  purchaseTaxTypeOf,
  shiftMonthKey,
  taxTotalsOf,
} from "../lib/fiscal";

/**
 * Reglas del registro fiscal (issue #41): IVA incluido desagregado sobre
 * enteros, totales del libro y numeración. Son puras: el panel, el API y el
 * comprobante imprimible usan exactamente estas funciones.
 *
 * Invariante central: `base + IVA = bruto` en toda línea (el redondeo queda en
 * el IVA), y los totales del encabezado son la suma de las líneas.
 */

test("IVA 10 % incluido: desagrega la base y deja el redondeo en el IVA", () => {
  assert.deepEqual(grossToNet(110_000, "IVA10"), { taxable: 100_000, taxAmount: 10_000 });
  assert.deepEqual(grossToNet(1_210_000, "IVA10"), { taxable: 1_100_000, taxAmount: 110_000 });
  // 100 × 10/11 = 90,9… → 91 de base y 9 de IVA (cierra exacto).
  assert.deepEqual(grossToNet(100, "IVA10"), { taxable: 91, taxAmount: 9 });
  // Un guaraní: no se inventa IVA (redondeo medio hacia arriba).
  assert.deepEqual(grossToNet(1, "IVA10"), { taxable: 1, taxAmount: 0 });
});

test("IVA 5 % incluido: base = bruto × 20/21", () => {
  assert.deepEqual(grossToNet(105_000, "IVA5"), { taxable: 100_000, taxAmount: 5_000 });
  assert.deepEqual(grossToNet(100, "IVA5"), { taxable: 95, taxAmount: 5 });
});

test("exenta: la base es el bruto y no hay IVA", () => {
  assert.deepEqual(grossToNet(250_000, "EXEMPT"), { taxable: 250_000, taxAmount: 0 });
});

test("invariante: base + IVA = bruto en todo el rango probado", () => {
  for (const type of ["IVA10", "IVA5", "EXEMPT"] as const) {
    for (let gross = 0; gross <= 1_000; gross += 1) {
      const { taxable, taxAmount } = grossToNet(gross, type);
      assert.equal(taxable + taxAmount, gross, `${type} con ${gross}`);
      assert.ok(taxable >= 0 && taxAmount >= 0);
    }
  }
});

test("importe de línea: cantidad × precio, nunca negativo ni NaN", () => {
  assert.equal(invoiceLineSubtotal(2, 550_000), 1_100_000);
  assert.equal(invoiceLineSubtotal(0, 550_000), 0);
  assert.equal(invoiceLineSubtotal(Number.NaN, 1_000), 0);
  assert.equal(invoiceLineSubtotal(3, -1_000), 0);
});

test("totales de ventas: suma bases e IVA por tipo y conserva el total bruto", () => {
  const totals = taxTotalsOf([
    { subtotal: 1_100_000, taxType: "IVA10" },
    { subtotal: 105_000, taxType: "IVA5" },
    { subtotal: 50_000, taxType: "EXEMPT" },
  ]);
  assert.deepEqual(totals, {
    taxable10: 1_000_000,
    iva10: 100_000,
    taxable5: 100_000,
    iva5: 5_000,
    exempt: 50_000,
    total: 1_255_000,
    count: 3,
  });
  assert.equal(totals.taxable10 + totals.iva10 + totals.taxable5 + totals.iva5 + totals.exempt, totals.total);
});

test("totales de compras: usa los montos cargados del comprobante", () => {
  const totals = taxTotalsOf([
    { taxable10: 1_000_000, iva10: 100_000, total: 1_100_000 },
    { taxable5: 200_000, iva5: 10_000, total: 210_000 },
    { exempt: 30_000, total: 30_000 },
  ]);
  assert.equal(totals.taxable10, 1_000_000);
  assert.equal(totals.iva10, 100_000);
  assert.equal(totals.taxable5, 200_000);
  assert.equal(totals.iva5, 10_000);
  assert.equal(totals.exempt, 30_000);
  assert.equal(totals.total, 1_340_000);
  assert.equal(totals.count, 3);
});

test("resumen del período: débito, crédito, saldo y resultado", () => {
  const summary = fiscalSummaryOf(
    [
      { subtotal: 1_100_000, taxType: "IVA10" },
      { subtotal: 105_000, taxType: "IVA5" },
    ],
    [{ taxable10: 550_000, iva10: 55_000, total: 605_000 }],
  );
  assert.equal(summary.sales.total, 1_205_000);
  assert.equal(summary.purchases.total, 605_000);
  assert.equal(summary.debitIva, 105_000);
  assert.equal(summary.creditIva, 55_000);
  assert.equal(summary.balance, 50_000);
  assert.equal(summary.result, 600_000);
});

test("tipo de IVA de una compra: sale de los montos cargados", () => {
  assert.equal(purchaseTaxTypeOf({ taxable10: 1, iva10: 0 }), "IVA10");
  assert.equal(purchaseTaxTypeOf({ taxable5: 0, iva5: 1 }), "IVA5");
  assert.equal(purchaseTaxTypeOf({}), "EXEMPT");
  assert.equal(purchaseTaxTypeOf(null as unknown as Record<string, never>), "EXEMPT");
});

test("numeración visible: correlativo de 7 posiciones", () => {
  assert.equal(invoiceNumberLabel(1), "0000001");
  assert.equal(invoiceNumberLabel(12_345), "0012345");
  assert.equal(invoiceNumberLabel(0), "—");
  assert.equal(invoiceNumberLabel(null), "—");
});

test("mes fiscal: validación, corrimiento y etiqueta", () => {
  assert.equal(isMonthKey("2026-09"), true);
  assert.equal(isMonthKey("2026-13"), false);
  assert.equal(isMonthKey("2026-9"), false);
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  assert.match(monthKeyLabel("2026-09"), /septiembre/i);
  assert.equal(monthKeyLabel("nada"), "—");
});
