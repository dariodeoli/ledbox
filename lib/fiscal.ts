/**
 * Reglas puras del registro fiscal interno (issue #41): tipos de IVA, cálculo
 * del IVA incluido, totales y numeración. Una sola fuente para el panel, el API
 * y el comprobante imprimible.
 *
 * **Alcance honesto**: este módulo es el registro fiscal interno de la empresa,
 * no la factura electrónica de SIFEN/DNIT (ver `docs/FISCAL-SIFEN.md`).
 *
 * Dinero: enteros en guaraníes (PYG, sin decimales). El precio pactado con el
 * cliente es **bruto** (IVA incluido), así que la base imponible se desagrega
 * hacia atrás y el resto del redondeo queda en el IVA de la línea, garantizando
 * siempre `base + IVA = bruto` (nunca se pierde ni se inventa un guaraní).
 */

export const INVOICE_TAX_TYPES = ["IVA10", "IVA5", "EXEMPT"] as const;
export type InvoiceTaxTypeValue = (typeof INVOICE_TAX_TYPES)[number];

export const INVOICE_CONDITIONS = ["CASH", "CREDIT"] as const;
export type InvoiceConditionValue = (typeof INVOICE_CONDITIONS)[number];

export const INVOICE_STATUSES = ["ISSUED", "PAID", "VOID"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];

export const FISCAL_PERIOD_STATUSES = ["OPEN", "CLOSED"] as const;
export type FiscalPeriodStatusValue = (typeof FISCAL_PERIOD_STATUSES)[number];

/** Fila de la que se calculan totales: línea bruta (ventas) o comprobante cargado (compras). */
export type TaxRow = {
  subtotal?: number;
  total?: number;
  taxable10?: number;
  iva10?: number;
  taxable5?: number;
  iva5?: number;
  exempt?: number;
  taxType?: InvoiceTaxTypeValue;
};

export type InvoiceTaxTotals = {
  /** Base gravada al 10 %. */
  taxable10: number;
  /** IVA 10 % del registro. */
  iva10: number;
  /** Base gravada al 5 %. */
  taxable5: number;
  /** IVA 5 % del registro. */
  iva5: number;
  /** Monto exento. */
  exempt: number;
  /** Total bruto del registro (suma de las líneas o comprobantes). */
  total: number;
  /** Cantidad de comprobantes considerados. */
  count: number;
};

export type FiscalMonthSummary = {
  sales: InvoiceTaxTotals;
  purchases: InvoiceTaxTotals;
  /** IVA débito del período (IVA de ventas). */
  debitIva: number;
  /** IVA crédito del período (IVA de compras). */
  creditIva: number;
  /**
   * Saldo de IVA del período (`débito − crédito`): positivo es a pagar,
   * negativo es saldo a favor.
   */
  balance: number;
  /** Resultado del registro (ventas − compras), sin juicio contable. */
  result: number;
};

export function isInvoiceTaxType(value: unknown): value is InvoiceTaxTypeValue {
  return typeof value === "string" && (INVOICE_TAX_TYPES as readonly string[]).includes(value);
}

export function isInvoiceCondition(value: unknown): value is InvoiceConditionValue {
  return typeof value === "string" && (INVOICE_CONDITIONS as readonly string[]).includes(value);
}

/**
 * Desagrega un importe **bruto** (IVA incluido) en base + IVA.
 *
 * - 10 %: `base = redondeo(bruto × 10/11)`, `iva = bruto − base`.
 * - 5 %: `base = redondeo(bruto × 20/21)`, `iva = bruto − base`.
 * - Exenta: `base = bruto`, `iva = 0`.
 *
 * El redondeo es medio hacia arriba sobre enteros positivos (`Math.round`), a
 * nivel de línea: lo que sobra o falta por redondear queda en el IVA, así la
 * suma siempre cierra (`base + iva = bruto`). Documentado en `docs/FISCAL-SIFEN.md`.
 */
export function grossToNet(gross: number, taxType: InvoiceTaxTypeValue): { taxable: number; taxAmount: number } {
  const amount = toAmount(gross);
  if (taxType === "IVA10") {
    const taxable = Math.round((amount * 10) / 11);
    return { taxable, taxAmount: amount - taxable };
  }
  if (taxType === "IVA5") {
    const taxable = Math.round((amount * 20) / 21);
    return { taxable, taxAmount: amount - taxable };
  }
  return { taxable: amount, taxAmount: 0 };
}

/** Importe bruto de una línea: `cantidad × precio unitario`, acotado a enteros válidos. */
export function invoiceLineSubtotal(quantity: number, unitPrice: number): number {
  const qty = toAmount(quantity);
  const price = toAmount(unitPrice);
  const subtotal = Math.round(qty) * Math.round(price);
  return Number.isSafeInteger(subtotal) && subtotal >= 0 ? subtotal : 0;
}

/**
 * Totales del registro a partir de líneas brutas (ventas) o comprobantes
 * cargados (compras). Las líneas sin importe no suman pero cuentan para el
 * total de comprobantes si vienen de una fila de la base.
 */
export function taxTotalsOf(rows: ReadonlyArray<TaxRow>): InvoiceTaxTotals {
  const totals: InvoiceTaxTotals = { taxable10: 0, iva10: 0, taxable5: 0, iva5: 0, exempt: 0, total: 0, count: 0 };
  for (const row of rows) {
    totals.count += 1;
    // Fila con montos desagregados (compras o factura ya emitida).
    if (row.taxable10 !== undefined || row.iva10 !== undefined || row.taxable5 !== undefined || row.iva5 !== undefined || row.exempt !== undefined) {
      totals.taxable10 += toAmount(row.taxable10);
      totals.iva10 += toAmount(row.iva10);
      totals.taxable5 += toAmount(row.taxable5);
      totals.iva5 += toAmount(row.iva5);
      totals.exempt += toAmount(row.exempt);
      totals.total += toAmount(row.total ?? row.subtotal);
      continue;
    }
    // Línea bruta con su tipo de IVA (alta de factura).
    const { taxable, taxAmount } = grossToNet(toAmount(row.subtotal ?? row.total), row.taxType ?? "IVA10");
    if ((row.taxType ?? "IVA10") === "IVA10") {
      totals.taxable10 += taxable;
      totals.iva10 += taxAmount;
    } else if ((row.taxType ?? "IVA10") === "IVA5") {
      totals.taxable5 += taxable;
      totals.iva5 += taxAmount;
    } else {
      totals.exempt += taxable;
    }
    totals.total += toAmount(row.subtotal ?? row.total);
  }
  return totals;
}

/** Resumen del período: ventas, compras, IVA débito/crédito y resultado. */
export function fiscalSummaryOf(sales: ReadonlyArray<TaxRow>, purchases: ReadonlyArray<TaxRow>): FiscalMonthSummary {
  const salesTotals = taxTotalsOf(sales);
  const purchaseTotals = taxTotalsOf(purchases);
  const debitIva = salesTotals.iva10 + salesTotals.iva5;
  const creditIva = purchaseTotals.iva10 + purchaseTotals.iva5;
  return {
    sales: salesTotals,
    purchases: purchaseTotals,
    debitIva,
    creditIva,
    balance: debitIva - creditIva,
    result: salesTotals.total - purchaseTotals.total,
  };
}

/** Tipo de IVA de un comprobante de compra a partir de sus montos cargados. */
export function purchaseTaxTypeOf(
  row:
    | {
        taxable10?: number | null;
        iva10?: number | null;
        taxable5?: number | null;
        iva5?: number | null;
      }
    | null
    | undefined,
): InvoiceTaxTypeValue {
  if (row && (toAmount(row.taxable10) > 0 || toAmount(row.iva10) > 0)) return "IVA10";
  if (row && (toAmount(row.taxable5) > 0 || toAmount(row.iva5) > 0)) return "IVA5";
  return "EXEMPT";
}

/**
 * Referencia visible de una factura: número correlativo de 7 posiciones
 * (`0000001`). El establecimiento y el timbrado son datos de la empresa y se
 * dibujan aparte en el comprobante; acá queda el correlativo estable.
 */
export function invoiceNumberLabel(number: number | null | undefined): string {
  const value = Number(number);
  if (!Number.isSafeInteger(value) || value <= 0) return "—";
  return String(value).padStart(7, "0");
}

/** Mes fiscal `YYYY-MM` (mismo formato que guarda `FiscalPeriod.month`). */
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string | null | undefined): boolean {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

const MONTH_PARTS_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Asuncion",
  year: "numeric",
  month: "2-digit",
});

/**
 * Mes fiscal (`YYYY-MM`) de un instante, en días de Asunción. La misma zona que
 * el resto de la app: el mes no se corre de noche ni cambia por el navegador.
 */
export function monthOf(date: Date): string {
  const parts = MONTH_PARTS_FORMAT.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}`;
}

/** Mes fiscal en curso (día de Asunción). */
export function currentMonthKey(now = new Date()): string {
  return monthOf(now);
}

/** Mes anterior/siguiente de una clave `YYYY-MM`. */
export function shiftMonthKey(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year * 12 + (monthNumber - 1) + delta;
  const index = ((total % 12) + 12) % 12;
  return `${Math.floor(total / 12)}-${String(index + 1).padStart(2, "0")}`;
}

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", month: "long", year: "numeric" });

/** «septiembre 2026» para una clave `YYYY-MM`. */
export function monthKeyLabel(month: string | null | undefined): string {
  if (!month || !isMonthKey(month)) return "—";
  const [year, monthNumber] = month.split("-").map(Number);
  return MONTH_LABEL_FORMAT.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

/** Entero no negativo; cualquier otra cosa cuenta como 0 (nunca NaN en los totales). */
function toAmount(value: number | null | undefined): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(Math.round(amount), Number.MAX_SAFE_INTEGER);
}
