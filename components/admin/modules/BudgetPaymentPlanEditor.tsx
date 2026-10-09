"use client";
import { useMemo } from "react";
import { Combobox, DateField, MoneyField, PercentField, SelectField, TextField } from "../AdminFields";
import { AdminButton, AdminNote } from "../AdminUI";
import { useAdminResource } from "@/lib/admin-api";
import { formatDayKey, formatMoney } from "@/lib/admin-format";
import { BUDGET_INT_MAX, resolveBudgetPaymentPlan, type BudgetPaymentCondition } from "@/lib/budget-payment-plan";

export type BudgetConditionDraft = { label: string; type: "fixed" | "percent" | "remainder"; value: string; dueAt: string; moment: string; accountId: string };
export function conditionDrafts(rows: readonly BudgetPaymentCondition[]): BudgetConditionDraft[] {
  return rows.map((row) => ({ label: row.label, type: row.type ?? "fixed", value: String(row.value ?? row.amount), dueAt: row.dueAt ?? "", moment: row.moment ?? (!row.dueAt ? "A coordinar" : ""), accountId: row.accountId ?? "" }));
}
export function conditionPayload(rows: BudgetConditionDraft[]) {
  return rows.map((row) => ({ ...row, value: Number(row.value.replace(",", ".")), amount: Number(row.value.replace(",", ".")), dueAt: row.dueAt || null }));
}
export function BudgetPaymentPlanEditor({ total, advance = 0, rows, onChange, disabled }: { total: number; advance?: number; rows: BudgetConditionDraft[]; onChange: (rows: BudgetConditionDraft[]) => void; disabled?: boolean }) {
  const options = useAdminResource("/api/admin/finance/options", (payload) => payload as unknown as { accounts: Array<{ id: string; name: string; bank?: string | null; number?: string | null; type: string; currency: string }> });
  const accounts = useMemo(() => (options.data?.accounts ?? []).filter((account) => account.currency === "PYG").map((account) => ({ value: account.id, label: account.name, description: [account.type, account.bank, account.number].filter(Boolean).join(" · ") })), [options.data]);
  const result = resolveBudgetPaymentPlan(conditionPayload(rows), total, advance);
  const update = (index: number, patch: Partial<BudgetConditionDraft>) => onChange(rows.map((row, position) => position === index ? { ...row, ...patch } : row));
  const fieldError = (index: number, field: string) => !result.ok && result.index === index && result.field === field ? result.error : undefined;
  return <div className="admin-plan-list">
    <dl className="admin-dialog-facts" aria-live="polite">
      <div><dt>Total final</dt><dd className="admin-nowrap">{formatMoney(total)}</dd></div>
      <div><dt>Asignado</dt><dd className="admin-nowrap">{result.ok ? formatMoney(result.assigned) : "Revisá el plan"}</dd></div>
      <div><dt>Restante</dt><dd className="admin-nowrap">{result.ok ? formatMoney(result.remaining) : "—"}</dd></div>
    </dl>
    {rows.map((row, index) => <section className="admin-plan-grid" key={index} aria-label={`Condición ${index + 1}`}>
      <TextField label="Concepto" required value={row.label} maxLength={60} disabled={disabled} error={fieldError(index, "label")} onChange={(label) => update(index, { label })} />
      <SelectField label="Tipo" value={row.type} options={[{ value: "percent", label: "Porcentaje" }, { value: "fixed", label: "Monto fijo" }, { value: "remainder", label: "Saldo restante" }]} disabled={disabled} error={fieldError(index, "type")} onChange={(type) => update(index, { type: type as BudgetConditionDraft["type"], value: "" })} />
      {row.type === "percent" ? <PercentField label="Porcentaje del total final" required value={row.value} disabled={disabled} error={fieldError(index, "value")} onChange={(value) => update(index, { value })} /> : row.type === "fixed" ? <MoneyField label="Monto fijo" required limit={BUDGET_INT_MAX} value={row.value} disabled={disabled} error={fieldError(index, "value")} onChange={(value) => update(index, { value })} /> : null}
      <strong className="admin-nowrap">Importe: {result.ok ? formatMoney(result.rows[index].amount) : "—"}</strong>
      {row.dueAt ? <span className="admin-nowrap">{formatDayKey(row.dueAt)}</span> : null}
      <DateField label="Vencimiento" value={row.dueAt} disabled={disabled} error={fieldError(index, "dueAt")} onChange={(dueAt) => update(index, { dueAt })} />
      <TextField label="Momento de pago" value={row.moment} maxLength={120} placeholder="Al confirmar / antes del montaje" disabled={disabled} error={fieldError(index, "moment")} onChange={(moment) => update(index, { moment })} />
      <Combobox label="Cuenta de cobro" hint="Opcional · cuenta real PYG de la empresa" value={row.accountId} options={accounts} disabled={disabled} onChange={(accountId) => update(index, { accountId })} />
      <AdminButton type="button" icon="trash" title={`Quitar condición ${index + 1}`} aria-label={`Quitar condición ${index + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((_, position) => position !== index))} />
    </section>)}
    {!result.ok ? <AdminNote tone="error">{result.error}</AdminNote> : result.remaining > 0 ? <AdminNote>Saldo sin agendar: {formatMoney(result.remaining)}. Agregá una condición de saldo restante para asignarlo.</AdminNote> : <AdminNote>El plan cierra con el total final, en guaraníes enteros.</AdminNote>}
    {options.error ? <AdminNote tone="error">{options.error}</AdminNote> : null}
    <AdminButton type="button" icon="plus" disabled={disabled || rows.length >= 12} onClick={() => onChange([...rows, { label: "", type: "percent", value: "", dueAt: "", moment: "", accountId: "" }])}>Agregar condición</AdminButton>
  </div>;
}
