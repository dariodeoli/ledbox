import { BUDGET_INT_MAX } from "./budget-payment-plan";

/**
 * Reglas puras de alquiler (docs/ALQUILERES-OPERACION.md §4 P1-2 y P1-4): garantía,
 * recargo por demora, roturas y faltantes, cargos personalizados, política de
 * cancelación y liquidación contra la garantía. Sin base de datos: el servidor y
 * la pantalla de Ajustes (vista previa «2 días tarde = 120.000») usan la misma cuenta.
 * Todo en guaraníes enteros; los redondeos son por unidad para que cantidad × unitario
 * sea exacto al guaraní.
 */

// ── Garantía ─────────────────────────────────────────────────────────────────

export const DEPOSIT_MODES = ["NONE", "OPTIONAL", "ALWAYS"] as const;
export type DepositMode = (typeof DEPOSIT_MODES)[number];
export const DEPOSIT_MODE_LABEL: Record<DepositMode, string> = {
  NONE: "No uso garantía",
  OPTIONAL: "Opcional en cada presupuesto",
  ALWAYS: "Siempre",
};

export const DEPOSIT_PURPOSES = ["RESERVE", "DAMAGES"] as const;
export type DepositPurpose = (typeof DEPOSIT_PURPOSES)[number];
export const DEPOSIT_PURPOSE_LABEL: Record<DepositPurpose, string> = {
  RESERVE: "Reserva",
  DAMAGES: "Daños",
};

export const DEPOSIT_CALCS = ["FIXED", "PERCENT", "PER_PRODUCT"] as const;
export type DepositCalc = (typeof DEPOSIT_CALCS)[number];
export const DEPOSIT_CALC_LABEL: Record<DepositCalc, string> = {
  FIXED: "Monto fijo",
  PERCENT: "% del pedido",
  PER_PRODUCT: "Por producto o categoría",
};

export const isDepositMode = (value: unknown): value is DepositMode => typeof value === "string" && (DEPOSIT_MODES as readonly string[]).includes(value);
export const isDepositPurpose = (value: unknown): value is DepositPurpose => typeof value === "string" && (DEPOSIT_PURPOSES as readonly string[]).includes(value);
export const isDepositCalc = (value: unknown): value is DepositCalc => typeof value === "string" && (DEPOSIT_CALCS as readonly string[]).includes(value);

/** Regla por pieza: el producto gana a la categoría. */
export type DepositRule = { inventoryId?: string | null; categoryId?: string | null; amount: number };

export type DepositPolicy = {
  mode: DepositMode;
  calc: DepositCalc;
  fixedAmount: number | null;
  percent: number | null;
  rules: DepositRule[];
};

export type DepositLine = { inventoryId: string | null; categoryIds: string[]; quantity: number };

const clampInt = (value: number) => Math.max(0, Math.min(BUDGET_INT_MAX, Math.round(value)));

/**
 * Garantía sugerida para un pedido. `NONE` no propone nada; `OPTIONAL` y `ALWAYS`
 * calculan igual (la diferencia es si se aplica sola al crear el presupuesto).
 * PER_PRODUCT suma cantidad × monto de la regla (producto primero, después la
 * categoría más específica = la primera de `categoryIds`). Devuelve `null` si no hay base.
 */
export function suggestSecurityDeposit(policy: DepositPolicy, order: { total: number; lines: DepositLine[] }): number | null {
  if (policy.mode === "NONE") return null;
  let amount: number | null = null;
  if (policy.calc === "FIXED") amount = policy.fixedAmount;
  else if (policy.calc === "PERCENT") amount = policy.percent && policy.percent > 0 ? clampInt((order.total * policy.percent) / 100) : null;
  else {
    let sum = 0;
    let matched = false;
    for (const line of order.lines) {
      const byProduct = line.inventoryId ? policy.rules.find((rule) => rule.inventoryId && rule.inventoryId === line.inventoryId) : undefined;
      const byCategory = byProduct ?? line.categoryIds.map((id) => policy.rules.find((rule) => !rule.inventoryId && rule.categoryId === id)).find(Boolean);
      if (!byCategory) continue;
      matched = true;
      sum += byCategory.amount * Math.max(0, line.quantity);
    }
    amount = matched ? clampInt(sum) : null;
  }
  return amount !== null && amount > 0 ? Math.min(amount, BUDGET_INT_MAX) : null;
}

// ── Recargo por demora ──────────────────────────────────────────────────────

export const LATE_FEE_KINDS = ["PERCENT", "FIXED"] as const;
export type LateFeeKind = (typeof LATE_FEE_KINDS)[number];
export const LATE_FEE_UNITS = ["DAY", "HOUR"] as const;
export type LateFeeUnit = (typeof LATE_FEE_UNITS)[number];
export const isLateFeeKind = (value: unknown): value is LateFeeKind => typeof value === "string" && (LATE_FEE_KINDS as readonly string[]).includes(value);
export const isLateFeeUnit = (value: unknown): value is LateFeeUnit => typeof value === "string" && (LATE_FEE_UNITS as readonly string[]).includes(value);

export type LateFeeConfig = { kind: LateFeeKind; unit: LateFeeUnit; value: number; graceMinutes: number };

export const DEFAULT_LATE_FEE: LateFeeConfig = { kind: "PERCENT", unit: "DAY", value: 10, graceMinutes: 120 };

/**
 * Unidades de demora a cobrar. Hasta la tolerancia no se cobra nada; pasada la
 * tolerancia se cobra cada unidad empezada (1 minuto de más sobre 1 día = 2 días
 * cuando el atraso total supera 24 h).
 */
export function lateUnits(config: LateFeeConfig, dueAt: Date, returnedAt: Date): { lateMinutes: number; units: number } {
  const lateMinutes = Math.floor((returnedAt.getTime() - dueAt.getTime()) / 60_000);
  if (!Number.isFinite(lateMinutes) || lateMinutes <= Math.max(0, config.graceMinutes)) return { lateMinutes: Math.max(0, lateMinutes || 0), units: 0 };
  const size = config.unit === "DAY" ? 1440 : 60;
  return { lateMinutes, units: Math.ceil(lateMinutes / size) };
}

/** Monto por unidad y total del recargo. `base` = lo que costó el alquiler (solo para el modo %). */
export function lateFeeAmount(config: LateFeeConfig, base: number, units: number): { unitAmount: number; amount: number } {
  if (units <= 0) return { unitAmount: 0, amount: 0 };
  const unitAmount = config.kind === "PERCENT" ? clampInt((Math.max(0, base) * config.value) / 100) : clampInt(config.value);
  return { unitAmount, amount: Math.min(BUDGET_INT_MAX, unitAmount * units) };
}

// ── Roturas, faltantes y cargos personalizados ──────────────────────────────

export const DEFAULT_DAMAGE_PERCENT = 100;

/** Cargo por pieza dañada o faltante: % del costo de reposición. */
export function damageCharge(replacementCost: number, quantity: number, percent: number): { unitAmount: number; amount: number } {
  const unitAmount = clampInt((Math.max(0, replacementCost) * percent) / 100);
  return { unitAmount, amount: Math.min(BUDGET_INT_MAX, unitAmount * Math.max(0, quantity)) };
}

export const CUSTOM_CHARGE_UNITS = ["PIECE", "EVENT"] as const;
export type CustomChargeUnit = (typeof CUSTOM_CHARGE_UNITS)[number];
export const CUSTOM_CHARGE_UNIT_LABEL: Record<CustomChargeUnit, string> = { PIECE: "por pieza", EVENT: "por evento" };

export type CustomChargeType = { id: string; name: string; amount: number; unit: CustomChargeUnit; categoryId: string | null };

export function customChargeAmount(type: Pick<CustomChargeType, "amount" | "unit">, quantity: number): { quantity: number; unitAmount: number; amount: number } {
  const count = type.unit === "PIECE" ? Math.max(1, Math.floor(quantity)) : 1;
  return { quantity: count, unitAmount: type.amount, amount: Math.min(BUDGET_INT_MAX, type.amount * count) };
}

/**
 * Cargos personalizados que se ofrecen al devolver, según lo que vuelve: uno sin
 * categoría se ofrece siempre; uno con categoría solo si volvió alguna pieza de esa
 * categoría (o de una subcategoría suya). La cantidad sugerida es la de esas piezas.
 */
export function offeredCustomCharges(types: CustomChargeType[], returned: Array<{ categoryIds: string[]; quantity: number }>): Array<{ type: CustomChargeType; suggestedQuantity: number }> {
  const total = returned.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
  const offers: Array<{ type: CustomChargeType; suggestedQuantity: number }> = [];
  for (const type of types) {
    if (!type.categoryId) {
      offers.push({ type, suggestedQuantity: type.unit === "PIECE" ? total : 1 });
      continue;
    }
    const pieces = returned.filter((line) => line.categoryIds.includes(type.categoryId as string)).reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
    if (pieces > 0) offers.push({ type, suggestedQuantity: type.unit === "PIECE" ? pieces : 1 });
  }
  return offers;
}

// ── Política de cancelación ─────────────────────────────────────────────────

export type CancellationTier = { minDaysBefore: number; retainPercent: number };

/** §5: ≥ 15 días 0 %, 7 a 14 días 50 % de la seña, menos de 7 días 100 %. */
export const DEFAULT_CANCELLATION_POLICY: CancellationTier[] = [
  { minDaysBefore: 15, retainPercent: 0 },
  { minDaysBefore: 7, retainPercent: 50 },
  { minDaysBefore: 0, retainPercent: 100 },
];

export const MAX_CANCELLATION_TIERS = 10;

/** Valida y ordena (de más anticipación a menos). Exige un tramo en 0 días para que toda fecha tenga regla. */
export function parseCancellationPolicy(value: unknown): { ok: true; tiers: CancellationTier[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "La política de cancelación necesita al menos un tramo." };
  if (value.length > MAX_CANCELLATION_TIERS) return { ok: false, error: `La política de cancelación admite hasta ${MAX_CANCELLATION_TIERS} tramos.` };
  const tiers: CancellationTier[] = [];
  for (const row of value) {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const days = record.minDaysBefore;
    const percent = record.retainPercent;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 365) return { ok: false, error: "Los días de cada tramo deben ser un entero entre 0 y 365." };
    if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 100) return { ok: false, error: "El porcentaje a retener de cada tramo debe ser un entero entre 0 y 100." };
    tiers.push({ minDaysBefore: days, retainPercent: percent });
  }
  if (new Set(tiers.map((tier) => tier.minDaysBefore)).size !== tiers.length) return { ok: false, error: "Dos tramos no pueden tener los mismos días." };
  if (!tiers.some((tier) => tier.minDaysBefore === 0)) return { ok: false, error: "Falta el último tramo: «menos de N días» (0 días)." };
  return { ok: true, tiers: tiers.sort((a, b) => b.minDaysBefore - a.minDaysBefore) };
}

/** Política guardada, o la de fábrica si falta o está dañada. */
export function cancellationPolicyOf(stored: unknown): CancellationTier[] {
  if (stored === null || stored === undefined) return DEFAULT_CANCELLATION_POLICY.map((tier) => ({ ...tier }));
  const parsed = parseCancellationPolicy(stored);
  return parsed.ok ? parsed.tiers : DEFAULT_CANCELLATION_POLICY.map((tier) => ({ ...tier }));
}

/** Tramo que corresponde a una cancelación con `daysBefore` días de anticipación (negativo = ya pasó). */
export function cancellationTierFor(policy: CancellationTier[], daysBefore: number): CancellationTier {
  const sorted = [...policy].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const days = Math.max(0, Math.floor(daysBefore));
  return sorted.find((tier) => days >= tier.minDaysBefore) ?? sorted[sorted.length - 1] ?? { minDaysBefore: 0, retainPercent: 100 };
}

/** Retención PROPUESTA de la seña al cancelar. No devuelve plata: el equipo decide. */
export function cancellationRetention(policy: CancellationTier[], input: { daysBefore: number; advancePaid: number }): { percent: number; retained: number; refundable: number } {
  const tier = cancellationTierFor(policy, input.daysBefore);
  const paid = Math.max(0, input.advancePaid);
  const retained = Math.min(paid, clampInt((paid * tier.retainPercent) / 100));
  return { percent: tier.retainPercent, retained, refundable: paid - retained };
}

/** Texto para el portal y el impreso. */
export function cancellationPolicyLines(policy: CancellationTier[]): string[] {
  const sorted = [...policy].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const what = (percent: number) => (percent === 0 ? "no se retiene la seña" : percent === 100 ? "se retiene toda la seña" : `se retiene el ${percent} % de la seña`);
  return sorted.map((tier, index) => {
    const upper = index === 0 ? null : sorted[index - 1].minDaysBefore - 1;
    if (index === 0) return `${tier.minDaysBefore} días o más antes del evento: ${what(tier.retainPercent)}.`;
    if (tier.minDaysBefore === 0) return `Menos de ${sorted[index - 1].minDaysBefore} días antes del evento: ${what(tier.retainPercent)}.`;
    return `De ${tier.minDaysBefore} a ${upper} días antes del evento: ${what(tier.retainPercent)}.`;
  });
}

// ── Liquidación ─────────────────────────────────────────────────────────────

export type SettlementInput = {
  /** Garantía del presupuesto (0 si no tiene) y si está en custodia (HELD). */
  deposit: number;
  depositHeld: boolean;
  purpose: DepositPurpose;
  /** Suma de los cargos APLICADOS (los condonados no cuentan). */
  chargesTotal: number;
};

export type SettlementResult = {
  /** Lo que se queda la empresa de la garantía (entra como cobro confirmado). */
  retained: number;
  /** Lo que vuelve al cliente de la garantía. */
  returned: number;
  /** Lo que el cliente todavía debe (ExpectedPayment `extra`). */
  extra: number;
  /** Estado final de la garantía: `null` = no cambia (sin garantía en custodia o reserva). */
  depositStatus: "RETURNED" | "KEPT_PARTIAL" | "KEPT" | null;
};

/**
 * Cargos contra garantía, al guaraní: retenido + devuelto = garantía y retenido + extra = cargos
 * (garantía de daños). Con garantía de reserva la plata ya se descontó del saldo al recibirla:
 * todos los cargos van como `extra`. Sin garantía en custodia también.
 */
export function settleRental(input: SettlementInput): SettlementResult {
  const charges = Math.max(0, input.chargesTotal);
  if (!input.depositHeld || input.deposit <= 0 || input.purpose === "RESERVE") return { retained: 0, returned: 0, extra: charges, depositStatus: null };
  const retained = Math.min(charges, input.deposit);
  const depositStatus = retained === 0 ? "RETURNED" : retained >= input.deposit ? "KEPT" : "KEPT_PARTIAL";
  return { retained, returned: input.deposit - retained, extra: charges - retained, depositStatus };
}
