import {
  currentMonthKey,
  isMonthKey,
  monthOf,
  shiftMonthKey,
  type FiscalMonthSummary,
  type InvoiceTaxTotals,
} from "@/lib/fiscal";
import { dayStart } from "./notifications";

/**
 * Capa server-side del registro fiscal interno (issue #41): datos fiscales de la
 * empresa, períodos mensuales y armado del resumen. Las reglas de IVA y de
 * numeración viven en `lib/fiscal.ts` (puras, compartidas con el panel).
 */

/**
 * Campos de los datos fiscales de la empresa (issue #41), mismo criterio que los
 * datos de pago: texto acotado, los vacíos quedan afuera y sin ningún dato la
 * empresa no tiene encabezado fiscal (la UI lo advierte, nunca lo inventa).
 */
export const FISCAL_FIELDS = [
  { key: "ruc", label: "RUC", max: 20 },
  { key: "razonSocial", label: "Razón social", max: 160 },
  { key: "timbrado", label: "Timbrado", max: 30 },
  { key: "establecimiento", label: "Establecimiento", max: 60 },
  { key: "direccion", label: "Dirección", max: 160 },
] as const;

export type FiscalProfile = {
  ruc: string | null;
  razonSocial: string | null;
  timbrado: string | null;
  establecimiento: string | null;
  direccion: string | null;
};

export const EMPTY_FISCAL_PROFILE: FiscalProfile = {
  ruc: null,
  razonSocial: null,
  timbrado: null,
  establecimiento: null,
  direccion: null,
};

/** Normaliza el JSON guardado en `Organization.fiscalDetails`. */
export function parseFiscalDetails(value: unknown): FiscalProfile {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const profile = { ...EMPTY_FISCAL_PROFILE } as FiscalProfile;
  for (const field of FISCAL_FIELDS) {
    const raw = record[field.key];
    const text = typeof raw === "string" ? raw.trim() : "";
    profile[field.key] = text ? text.slice(0, field.max) : null;
  }
  return profile;
}

/** ¿La empresa ya cargó algún dato fiscal? (sin datos no se inventa encabezado). */
export function hasFiscalDetails(profile: FiscalProfile): boolean {
  return FISCAL_FIELDS.some((field) => Boolean(profile[field.key]));
}

/** Mes fiscal (`YYYY-MM`) de un instante, en días de Asunción. */
export { currentMonthKey, monthOf } from "@/lib/fiscal";

/** Clave `YYYY-MM` pedida en un query/body; `null` si viene inválida. */
export function readMonthKey(raw: unknown, fallback: string | null = null): string | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 7);
  return isMonthKey(value) ? value : null;
}

/** Límites del mes de Asunción: `[inicio, inicio del mes siguiente)`. */
export function monthBounds(month: string): { start: Date; end: Date } {
  return { start: dayStart(`${month}-01`), end: dayStart(`${shiftMonthKey(month, 1)}-01`) };
}

/** Snapshot plano de un resumen mensual para `FiscalPeriod.summary` (JSON). */
export type FiscalSummarySnapshot = FiscalMonthSummary & {
  /** Comprobantes del mes considerados (ventas y compras, sin anuladas). */
  counts: { sales: number; purchases: number; voided: number };
};

/** Lee un snapshot guardado; `null` si la forma no es la esperada. */
export function parseFiscalSummary(value: unknown): FiscalSummarySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sales = parseTotals(record.sales);
  const purchases = parseTotals(record.purchases);
  if (!sales || !purchases) return null;
  const counts = record.counts && typeof record.counts === "object" ? (record.counts as Record<string, unknown>) : {};
  return {
    sales,
    purchases,
    debitIva: numberOrZero(record.debitIva),
    creditIva: numberOrZero(record.creditIva),
    balance: numberOrZero(record.balance),
    result: numberOrZero(record.result),
    counts: {
      sales: numberOrZero(counts.sales),
      purchases: numberOrZero(counts.purchases),
      voided: numberOrZero(counts.voided),
    },
  };
}

function parseTotals(value: unknown): InvoiceTaxTotals | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    taxable10: numberOrZero(record.taxable10),
    iva10: numberOrZero(record.iva10),
    taxable5: numberOrZero(record.taxable5),
    iva5: numberOrZero(record.iva5),
    exempt: numberOrZero(record.exempt),
    total: numberOrZero(record.total),
    count: numberOrZero(record.count),
  };
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

/** Ventas del libro: las anuladas no cuentan (el número queda, el monto no). */
export function salesRowsForSummary<T extends { status: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.status !== "VOID");
}
