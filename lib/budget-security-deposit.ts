import { BUDGET_INT_MAX, defaultDepositPlanRows, resolveBudgetPaymentPlan } from "./budget-payment-plan";

/**
 * Depósito de garantía del alquiler. Es un monto APARTE del presupuesto: no
 * entra en `total`, no se factura y no cuenta como cobro ni como seña.
 *
 *   PENDING ──recibida──▶ HELD ──▶ RETURNED       (devolución completa)
 *                           ├────▶ KEPT_PARTIAL   (retiene 0 < monto < garantía)
 *                           └────▶ KEPT           (retiene todo)
 *
 * RETURNED, KEPT_PARTIAL y KEPT son finales. Un PENDING sin recibir puede
 * anularse (se quita la garantía) o cambiar de monto.
 */
export const SECURITY_DEPOSIT_STATUSES = ["PENDING", "HELD", "RETURNED", "KEPT_PARTIAL", "KEPT"] as const;
export type SecurityDepositStatus = (typeof SECURITY_DEPOSIT_STATUSES)[number];

export const SECURITY_DEPOSIT_LABEL: Record<SecurityDepositStatus, string> = {
  PENDING: "Pendiente de recibir",
  HELD: "En custodia",
  RETURNED: "Devuelta",
  KEPT_PARTIAL: "Retenida parcialmente",
  KEPT: "Retenida",
};

export function isSecurityDepositStatus(value: unknown): value is SecurityDepositStatus {
  return typeof value === "string" && (SECURITY_DEPOSIT_STATUSES as readonly string[]).includes(value);
}

const NEXT: Record<SecurityDepositStatus, readonly SecurityDepositStatus[]> = {
  PENDING: ["HELD"],
  HELD: ["RETURNED", "KEPT_PARTIAL", "KEPT"],
  RETURNED: [],
  KEPT_PARTIAL: [],
  KEPT: [],
};

export function securityDepositNextStatuses(status: SecurityDepositStatus): readonly SecurityDepositStatus[] {
  return NEXT[status];
}

/** Monto de la garantía: entero en guaraníes, mayor a cero y dentro del límite Int. */
export function securityDepositAmountValid(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 && amount <= BUDGET_INT_MAX;
}

export type SecurityDepositState = { amount: number | null; status: string | null; retained: number | null };
export type SecurityDepositTransition =
  | { ok: true; status: SecurityDepositStatus; retained: number | null; returned: number }
  | { ok: false; error: string };

/**
 * Valida un cambio de estado y calcula cuánto se retiene y cuánto vuelve al
 * cliente (retenido + devuelto = garantía, al guaraní). `retainedAmount` solo
 * aplica a KEPT_PARTIAL; RETURNED retiene 0 y KEPT retiene todo.
 */
export function securityDepositTransition(current: SecurityDepositState, to: unknown, retainedAmount?: unknown): SecurityDepositTransition {
  if (!securityDepositAmountValid(current.amount) || !isSecurityDepositStatus(current.status)) {
    return { ok: false, error: "Este presupuesto no tiene depósito de garantía." };
  }
  if (!isSecurityDepositStatus(to)) return { ok: false, error: "El estado de la garantía no es válido." };
  if (!NEXT[current.status].includes(to)) {
    return { ok: false, error: `La garantía ${SECURITY_DEPOSIT_LABEL[current.status].toLowerCase()} no puede pasar a ${SECURITY_DEPOSIT_LABEL[to].toLowerCase()}.` };
  }
  if (to === "KEPT_PARTIAL") {
    if (typeof retainedAmount !== "number" || !Number.isSafeInteger(retainedAmount) || retainedAmount <= 0 || retainedAmount >= current.amount) {
      return { ok: false, error: "El monto a retener debe ser un entero mayor a cero y menor a la garantía; para retener todo usá «Retener todo»." };
    }
    return { ok: true, status: to, retained: retainedAmount, returned: current.amount - retainedAmount };
  }
  if (retainedAmount !== undefined && retainedAmount !== null && retainedAmount !== 0 && to !== "KEPT") {
    return { ok: false, error: "Solo una retención parcial lleva monto." };
  }
  if (to === "KEPT") return { ok: true, status: to, retained: current.amount, returned: 0 };
  if (to === "RETURNED") return { ok: true, status: to, retained: 0, returned: current.amount };
  return { ok: true, status: to, retained: null, returned: 0 };
}

/** Lo que el cliente ve de su garantía (sin notas ni costos internos). */
export type SecurityDepositPublic = { amount: number; status: SecurityDepositStatus; statusLabel: string; retained: number; returned: number } | null;

export function securityDepositPublic(row: { securityDeposit: number | null; securityDepositStatus: string | null; securityDepositRetained: number | null }): SecurityDepositPublic {
  if (!securityDepositAmountValid(row.securityDeposit) || !isSecurityDepositStatus(row.securityDepositStatus)) return null;
  const retained = row.securityDepositStatus === "KEPT" ? row.securityDeposit : row.securityDepositStatus === "KEPT_PARTIAL" ? row.securityDepositRetained ?? 0 : 0;
  const closed = row.securityDepositStatus === "RETURNED" || row.securityDepositStatus === "KEPT" || row.securityDepositStatus === "KEPT_PARTIAL";
  return {
    amount: row.securityDeposit,
    status: row.securityDepositStatus,
    statusLabel: SECURITY_DEPOSIT_LABEL[row.securityDepositStatus],
    retained,
    returned: closed ? row.securityDeposit - retained : 0,
  };
}

export type NewBudgetDefaults =
  | { ok: true; installments: unknown[] | null; securityDeposit: number | null }
  | { ok: false; error: string };

/**
 * Seña y garantía de un presupuesto NUEVO (alta manual, desde lead o API).
 * - Plan: un `installmentsJson` explícito se respeta tal cual (`null` = sin plan);
 *   si no viene, nace «Seña N %» + «Saldo» con el `depositPercent` del body o, en su
 *   defecto, el de la empresa. Sin porcentaje no hay seña.
 * - Garantía: `securityDeposit` del body o el default de la empresa; `null`/0 = sin.
 */
export function newBudgetDefaults(
  body: { installmentsJson?: unknown; depositPercent?: unknown; securityDeposit?: unknown },
  total: number,
  company: { depositPercent: number | null; securityDepositDefault: number | null },
): NewBudgetDefaults {
  let installments: unknown[] | null = null;
  if (body.installmentsJson !== undefined && body.installmentsJson !== null) {
    const checked = resolveBudgetPaymentPlan(body.installmentsJson, total, 0);
    if (!checked.ok) return { ok: false, error: checked.error };
    installments = checked.rows;
  } else if (body.installmentsJson === undefined) {
    const percent = body.depositPercent === undefined ? company.depositPercent : body.depositPercent;
    if (percent !== null && (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 100)) {
      return { ok: false, error: "La seña debe ser un porcentaje entero entre 0 y 100." };
    }
    installments = defaultDepositPlanRows(percent, total);
  }
  const deposit = body.securityDeposit === undefined ? company.securityDepositDefault : body.securityDeposit;
  if (deposit !== null && deposit !== 0 && !securityDepositAmountValid(deposit)) {
    return { ok: false, error: "La garantía debe ser un monto entero en guaraníes mayor a cero." };
  }
  return { ok: true, installments, securityDeposit: typeof deposit === "number" && deposit > 0 ? deposit : null };
}
