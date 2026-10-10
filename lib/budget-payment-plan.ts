import { z } from "zod";

/** JSON-only extension of the historical [{label, amount, dueAt}] contract. */
export const BUDGET_INT_MAX = 2_147_483_647;
export type BudgetPaymentCondition = {
  label: string;
  amount: number;
  dueAt: string | null;
  type?: "fixed" | "percent" | "remainder";
  value?: number;
  moment?: string | null;
  accountId?: string | null;
};

/** Contrato público resuelto, sin nueva aritmética ni datos internos de cuenta. */
export const budgetPaymentConditionSnapshotSchema = z.object({
  label: z.string(), amount: z.number().int().min(0).max(BUDGET_INT_MAX), dueAt: z.string().nullable(),
  type: z.enum(["fixed", "percent", "remainder"]).optional(),
  value: z.number().min(0).max(BUDGET_INT_MAX).optional(),
  moment: z.string().nullable().optional(), accountId: z.string().nullable().optional(),
}).strict() satisfies z.ZodType<BudgetPaymentCondition>;

/** JSON explícito: omitir undefined antes de hashear evita diferencias al persistir. */
export function budgetPaymentConditionPayload(row: BudgetPaymentCondition): BudgetPaymentCondition {
  return { label: row.label, amount: row.amount, dueAt: row.dueAt,
    ...(row.type !== undefined ? { type: row.type } : {}),
    ...(row.value !== undefined ? { value: row.value } : {}),
    ...(row.moment !== undefined ? { moment: row.moment } : {}),
    ...(row.accountId !== undefined ? { accountId: row.accountId } : {}),
  };
}
export type BudgetPlanResult = { ok: true; rows: BudgetPaymentCondition[]; assigned: number; remaining: number } | { ok: false; error: string; index?: number; field?: string };
export function budgetDayValid(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}
export function budgetMoneyValid(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= BUDGET_INT_MAX;
}

/** Evaluate against the final total. Largest-remainder rounding is deterministic,
 * leaves fixed amounts untouched and closes 100% plans exactly, even for Gs 1.
 * Historical partial plans retain an explicit unassigned balance.
 */
export function resolveBudgetPaymentPlan(raw: unknown, total: number, advance = 0): BudgetPlanResult {
  if (!budgetMoneyValid(total) || !budgetMoneyValid(advance) || advance > total) return { ok: false, error: "Total o anticipo fuera del límite en guaraníes." };
  if (!Array.isArray(raw) || raw.length > 12) return { ok: false, error: "El plan admite hasta 12 condiciones." };
  const rows: BudgetPaymentCondition[] = [];
  let fixed = advance, percent = 0, remainder = -1;
  for (const [index, input] of raw.entries()) {
    const fail = (field: string, error: string): BudgetPlanResult => ({ ok: false, index, field, error: `Condición ${index + 1}: ${error}` });
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail("label", "formato inválido.");
    const r = input as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label || label.length > 60) return fail("label", "escribí un concepto de hasta 60 caracteres.");
    const type = r.type ?? "fixed";
    if (type !== "fixed" && type !== "percent" && type !== "remainder") return fail("type", "tipo inválido.");
    const source = r.value ?? r.amount;
    if ((type !== "remainder" || source !== undefined) && typeof source !== "number") return fail("value", "el valor debe ser numérico; no texto ni booleano.");
    const value = typeof source === "number" ? source : 0;
    if (type === "fixed" && (!budgetMoneyValid(value) || value <= 0)) return fail("value", "el monto debe ser un entero mayor a cero dentro del límite Int.");
    if (type === "percent" && (!Number.isFinite(value) || value <= 0 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)) return fail("value", "el porcentaje debe estar entre 0,01 y 100, con hasta dos decimales.");
    if (type === "remainder" && remainder >= 0) return fail("type", "solo puede haber un saldo restante.");
    if (r.dueAt !== undefined && r.dueAt !== null && typeof r.dueAt !== "string") return fail("dueAt", "vencimiento inválido.");
    if (r.moment !== undefined && r.moment !== null && typeof r.moment !== "string") return fail("moment", "momento inválido.");
    if (r.accountId !== undefined && r.accountId !== null && typeof r.accountId !== "string") return fail("accountId", "cuenta inválida.");
    const dueAt = typeof r.dueAt === "string" && r.dueAt.trim() ? r.dueAt.trim() : null;
    const moment = typeof r.moment === "string" && r.moment.trim() ? r.moment.trim() : null;
    if (dueAt && !budgetDayValid(dueAt)) return fail("dueAt", "vencimiento inválido.");
    if (moment && moment.length > 120) return fail("moment", "el momento admite hasta 120 caracteres.");
    // Legacy rows without dates remain readable; new structured rows need a moment or date.
    if (r.type !== undefined && !dueAt && !moment) return fail("dueAt", "elegí una fecha o un momento de pago.");
    rows.push({ label, ...(r.type !== undefined ? { type: type as BudgetPaymentCondition["type"] } : {}), value: type === "remainder" ? 0 : value, amount: type === "fixed" ? value : 0, dueAt, moment, accountId: typeof r.accountId === "string" && r.accountId ? r.accountId : null });
    if (type === "fixed") fixed += value;
    if (type === "percent") percent += Math.round(value * 100);
    if (type === "remainder") remainder = index;
  }
  if (percent > 10000) return { ok: false, error: "La suma de porcentajes no puede superar 100 %." };
  const exactPercent = total * percent / 10000;
  if (fixed + exactPercent > total + 1e-7) return { ok: false, error: "Los montos fijos, anticipo y porcentajes superan el total final." };
  const fractions: { index: number; fraction: number }[] = [];
  let floorSum = 0;
  rows.forEach((row, index) => {
    if (row.type !== "percent") return;
    const exact = total * Math.round(row.value! * 100) / 10000;
    row.amount = Math.floor(exact);
    floorSum += row.amount;
    fractions.push({ index, fraction: exact - row.amount });
  });
  const target = Math.min(total - fixed, Math.round(exactPercent));
  fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let n = 0; n < target - floorSum; n++) rows[fractions[n].index].amount++;
  const assigned = fixed + target;
  if (remainder >= 0) rows[remainder].amount = total - assigned;
  return { ok: true, rows, assigned: remainder >= 0 ? total : assigned, remaining: remainder >= 0 ? 0 : total - assigned };
}

/** Recalculate only extended plans; never reinterpret old stored amounts. */
export function hasDynamicBudgetPlan(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some((row) => row?.type === "percent" || row?.type === "remainder");
}

/** Reject incompatible revisions explicitly rather than silently leaving a
 * protected paid/proof concept at 50 while the new plan claims it is 70.
 */
export function budgetPlanLedgerError(desired: ReadonlyArray<{ slot: string; amount: number }>, existing: ReadonlyArray<{ slot: string; amount: number; paidAmount?: number; status: string; proofId?: string | null; paymentId?: string | null; label?: string }>): string | null {
  const bySlot = new Map(desired.map((row) => [row.slot, row.amount]));
  for (const row of existing) {
    if (row.status === "CANCELLED") continue;
    if (row.slot.startsWith("split:")) continue;
    const protectedRow = ["CONFIRMED", "PARTIAL", "PROOF"].includes(row.status) || (row.paidAmount ?? 0) > 0 || Boolean(row.proofId) || Boolean(row.paymentId) || Boolean(row.label?.includes(" · parte "));
    const baseLabel = row.label?.split(" · parte ")[0];
    const splitAmount = row.label?.includes(" · parte ") ? existing.filter((part) => part.status !== "CANCELLED" && part.slot.startsWith("split:") && part.label?.split(" · parte ")[0] === baseLabel).reduce((sum, part) => sum + part.amount, 0) : 0;
    if (protectedRow && bySlot.get(row.slot) !== row.amount + splitAmount) return "El plan cambia un concepto con cobros, comprobantes o saldo dividido. Conservá ese importe y revisá los pendientes por separado.";
  }
  return null;
}
