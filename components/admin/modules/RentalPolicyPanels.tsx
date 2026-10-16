"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatMoney } from "@/lib/admin-format";
import type { AdminInventoryCategoryRow, AdminRentalSettings as RentalSettingsView } from "@/lib/admin-types";
import { BUDGET_INT_MAX } from "@/lib/budget-payment-plan";
import {
  CUSTOM_CHARGE_UNIT_LABEL,
  DEFAULT_CANCELLATION_POLICY,
  DEPOSIT_CALC_LABEL,
  DEPOSIT_MODE_LABEL,
  DEPOSIT_PURPOSE_LABEL,
  cancellationPolicyLines,
  cancellationRetention,
  damageCharge,
  lateFeeAmount,
  lateUnits,
  suggestSecurityDeposit,
  type CustomChargeUnit,
  type DepositCalc,
  type DepositMode,
  type DepositPurpose,
  type LateFeeKind,
  type LateFeeUnit,
} from "@/lib/rental-charges";
import { Combobox, MoneyField, NumberField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { AdminButton, AdminDisclosure, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Ajustes → Alquileres: garantía, recargo por demora, roturas y faltantes, cargos personalizados,
 * política de cancelación y condiciones (alquileres P1-2). Todo es configurable por empresa y se
 * puede cambiar en cada caso (presupuesto, cargo). Cada bloque muestra el monto en vivo, por
 * ejemplo «2 días tarde = 120.000». El API revalida rol y valores; OPERATIONS no guarda montos.
 */

type DepositRuleRow = { key: string; kind: "category" | "product"; refId: string; amount: string };
type ChargeRow = { id: string; name: string; amount: string; unit: CustomChargeUnit; categoryId: string };
type TierRow = { days: string; percent: string };

type Form = {
  mode: DepositMode;
  purpose: DepositPurpose;
  calc: DepositCalc;
  fixed: string;
  percent: string;
  rules: DepositRuleRow[];
  lateKind: LateFeeKind;
  lateUnit: LateFeeUnit;
  lateValue: string;
  lateGrace: string;
  damagePercent: string;
  charges: ChargeRow[];
  tiers: TierRow[];
  terms: string;
};

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));

function toForm(settings: RentalSettingsView): Form {
  return {
    mode: settings.securityDepositMode,
    purpose: settings.securityDepositPurpose,
    calc: settings.securityDepositCalc,
    fixed: settings.securityDepositDefault === null ? "" : String(settings.securityDepositDefault),
    percent: settings.securityDepositPercent === null ? "" : String(settings.securityDepositPercent),
    rules: settings.securityDepositRules.map((rule, index) => ({ key: `r${index}`, kind: rule.inventoryId ? "product" : "category", refId: rule.inventoryId ?? rule.categoryId ?? "", amount: String(rule.amount) })),
    lateKind: settings.lateFeeKind,
    lateUnit: settings.lateFeeUnit,
    lateValue: String(settings.lateFeeValue),
    lateGrace: String(settings.lateGraceMinutes),
    damagePercent: String(settings.damageChargePercent),
    charges: settings.customCharges.map((charge) => ({ id: charge.id, name: charge.name, amount: String(charge.amount), unit: charge.unit, categoryId: charge.categoryId ?? "" })),
    tiers: settings.cancellationPolicy.map((tier) => ({ days: String(tier.minDaysBefore), percent: String(tier.retainPercent) })),
    terms: settings.rentalTerms ?? "",
  };
}

function toBody(form: Form): Record<string, unknown> {
  return {
    securityDepositMode: form.mode,
    securityDepositPurpose: form.purpose,
    securityDepositCalc: form.calc,
    securityDepositDefault: form.fixed === "" ? null : Number(form.fixed),
    securityDepositPercent: form.percent === "" ? null : Number(form.percent),
    securityDepositRules: form.rules.map((rule) => ({ ...(rule.kind === "product" ? { inventoryId: rule.refId } : { categoryId: rule.refId }), amount: Number(rule.amount) })),
    lateFeeKind: form.lateKind,
    lateFeeUnit: form.lateUnit,
    lateFeeValue: num(form.lateValue),
    lateGraceMinutes: num(form.lateGrace),
    damageChargePercent: num(form.damagePercent),
    customCharges: form.charges.map((charge) => ({ id: charge.id, name: charge.name, amount: Number(charge.amount), unit: charge.unit, categoryId: charge.categoryId || null })),
    cancellationPolicy: form.tiers.map((tier) => ({ minDaysBefore: num(tier.days), retainPercent: num(tier.percent) })),
    rentalTerms: form.terms.trim() === "" ? null : form.terms,
  };
}

const MODE_OPTIONS = (Object.keys(DEPOSIT_MODE_LABEL) as DepositMode[]).map((value) => ({ value, label: DEPOSIT_MODE_LABEL[value] }));
const PURPOSE_OPTIONS = (Object.keys(DEPOSIT_PURPOSE_LABEL) as DepositPurpose[]).map((value) => ({ value, label: DEPOSIT_PURPOSE_LABEL[value] }));
const CALC_OPTIONS = (Object.keys(DEPOSIT_CALC_LABEL) as DepositCalc[]).map((value) => ({ value, label: DEPOSIT_CALC_LABEL[value] }));
const UNIT_OPTIONS = (Object.keys(CUSTOM_CHARGE_UNIT_LABEL) as CustomChargeUnit[]).map((value) => ({ value, label: CUSTOM_CHARGE_UNIT_LABEL[value] }));

export function RentalPolicyPanels({ settings, onSaved, readOnly }: { settings: RentalSettingsView; onSaved: () => void; readOnly: boolean }) {
  const initial = useMemo(() => toForm(settings), [settings]);
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Valores de ejemplo para la vista previa: no se guardan.
  const [sample, setSample] = useState({ rental: "600000", lateCount: "2", lateUnit: "DAY" as LateFeeUnit, pieces: "12", replacement: "15000", order: "2000000", advance: "1000000", cancelDays: "10" });

  const categories = useAdminResource("/api/admin/inventory/categories", (payload) => ((payload as { categories?: AdminInventoryCategoryRow[] }).categories ?? []));
  const products = useAdminResource("/api/admin/inventory", (payload) => ((payload as { inventory?: Array<{ id: string; name: string }> }).inventory ?? []), { enabled: form.calc === "PER_PRODUCT" });

  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const disabled = readOnly || busy;
  const patch = (changes: Partial<Form>) => setForm((current) => ({ ...current, ...changes }));

  const categoryOptions = useMemo(() => {
    const rows = categories.data ?? [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rows.filter((row) => !row.archivedAt).map((row) => ({ value: row.id, label: row.parentId && byId.get(row.parentId) ? `${byId.get(row.parentId)?.name} › ${row.name}` : row.name }));
  }, [categories.data]);

  // ── Vistas previas en vivo ──
  const lateConfig = { kind: form.lateKind, unit: form.lateUnit, value: num(form.lateValue), graceMinutes: num(form.lateGrace) };
  const lateMinutes = num(sample.lateCount) * (sample.lateUnit === "DAY" ? 1440 : 60);
  const dueAt = new Date(0);
  const late = lateUnits(lateConfig, dueAt, new Date(lateMinutes * 60_000));
  const lateAmount = lateFeeAmount(lateConfig, num(sample.rental), late.units);
  const lateLabel = `${num(sample.lateCount)} ${sample.lateUnit === "DAY" ? (num(sample.lateCount) === 1 ? "día" : "días") : num(sample.lateCount) === 1 ? "hora" : "horas"} tarde`;
  const damage = damageCharge(num(sample.replacement), num(sample.pieces), num(form.damagePercent));
  const depositPreview = suggestSecurityDeposit(
    { mode: form.mode === "NONE" ? "OPTIONAL" : form.mode, calc: form.calc, fixedAmount: form.fixed === "" ? null : Number(form.fixed), percent: form.percent === "" ? null : Number(form.percent), rules: [] },
    { total: num(sample.order), lines: [] },
  );
  const tiersValid = form.tiers.length > 0 && form.tiers.every((tier) => tier.days !== "" && tier.percent !== "");
  const policy = tiersValid ? form.tiers.map((tier) => ({ minDaysBefore: num(tier.days), retainPercent: num(tier.percent) })) : DEFAULT_CANCELLATION_POLICY;
  const cancel = cancellationRetention(policy, { daysBefore: num(sample.cancelDays), advancePaid: num(sample.advance) });

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const result = await adminSend<{ settings: RentalSettingsView }>("/api/admin/settings/rental", toBody(form), "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Guardamos la garantía, los cargos y las condiciones.");
    onSaved();
  }

  return (
    <form className="admin-settings admin-settings-sections admin-rental-policies" onSubmit={(event) => void save(event)}>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}

      <AdminPanel title="Garantía" icon="wallet" meta="Se puede cambiar en cada presupuesto">
        <div className="admin-settings-grid">
          <SelectField label="¿Usás garantía?" value={form.mode} onChange={(value) => patch({ mode: value as DepositMode })} options={MODE_OPTIONS} disabled={disabled} hint="Opcional: se elige en cada presupuesto. Siempre: se propone sola al crearlo." />
          <SelectField label="¿Para qué es?" value={form.purpose} onChange={(value) => patch({ purpose: value as DepositPurpose })} options={PURPOSE_OPTIONS} disabled={disabled || form.mode === "NONE"} hint="Reserva: asegura la fecha y se descuenta del saldo. Daños: se devuelve si no hay cargos. No se suma al total." />
          <SelectField label="¿Cómo se calcula?" value={form.calc} onChange={(value) => patch({ calc: value as DepositCalc })} options={CALC_OPTIONS} disabled={disabled || form.mode === "NONE"} />
          {form.calc === "FIXED" ? <MoneyField label="Monto fijo" value={form.fixed} onChange={(value) => patch({ fixed: value })} limit={BUDGET_INT_MAX} disabled={disabled || form.mode === "NONE"} hint="Vacío = sin monto por defecto." /> : null}
          {form.calc === "PERCENT" ? <NumberField label="% del pedido" value={form.percent} onChange={(value) => patch({ percent: value })} maxLength={3} disabled={disabled || form.mode === "NONE"} hint="De 1 a 100 sobre el total del presupuesto." /> : null}
        </div>
        {form.calc === "PER_PRODUCT" && form.mode !== "NONE" ? (
          <div className="rental-rows">
            <p className="admin-field-hint">Monto por pieza. Un producto con su propia regla gana a la regla de su categoría. Lo que no tiene regla no suma.</p>
            {form.rules.map((rule, index) => (
              <div className="rental-row admin-settings-grid" key={rule.key}>
                <SelectField label={`Regla ${index + 1} · aplica a`} value={rule.kind} disabled={disabled} onChange={(kind) => patch({ rules: form.rules.map((row, i) => (i === index ? { ...row, kind: kind === "product" ? "product" : "category", refId: "" } : row)) })} options={[{ value: "category", label: "Una categoría" }, { value: "product", label: "Un producto" }]} />
                {rule.kind === "category" ? (
                  <SelectField label={`Categoría · regla ${index + 1}`} value={rule.refId} disabled={disabled} onChange={(refId) => patch({ rules: form.rules.map((row, i) => (i === index ? { ...row, refId } : row)) })} options={[{ value: "", label: "Elegí una categoría" }, ...categoryOptions]} />
                ) : (
                  <Combobox label={`Producto · regla ${index + 1}`} value={rule.refId} disabled={disabled} onChange={(refId) => patch({ rules: form.rules.map((row, i) => (i === index ? { ...row, refId } : row)) })} options={(products.data ?? []).map((product) => ({ value: product.id, label: product.name }))} placeholder="Buscá el producto" />
                )}
                <MoneyField label={`Monto por pieza · regla ${index + 1}`} value={rule.amount} limit={BUDGET_INT_MAX} disabled={disabled} onChange={(amount) => patch({ rules: form.rules.map((row, i) => (i === index ? { ...row, amount } : row)) })} />
                <AdminButton type="button" icon="trash" disabled={disabled} aria-label={`Quitar la regla ${index + 1}`} onClick={() => patch({ rules: form.rules.filter((_, i) => i !== index) })} />
              </div>
            ))}
            <AdminButton type="button" icon="plus" disabled={disabled || form.rules.length >= 200} onClick={() => patch({ rules: [...form.rules, { key: `n${Date.now()}`, kind: "category", refId: "", amount: "" }] })}>Agregar regla</AdminButton>
          </div>
        ) : null}
        {form.mode !== "NONE" && form.calc !== "PER_PRODUCT" ? (
          <AdminDisclosure title="Probar garantía" hint="Ejemplo, no se guarda"><div className="rental-preview" aria-live="polite">
            <MoneyField label="Pedido de ejemplo" value={sample.order} limit={BUDGET_INT_MAX} onChange={(order) => setSample({ ...sample, order })} />
            <p><strong>{depositPreview === null ? "Sin garantía con estos valores" : `Garantía = ${formatMoney(depositPreview)}`}</strong></p>
          </div></AdminDisclosure>
        ) : null}
      </AdminPanel>

      <AdminPanel title="Recargo por demora" icon="clock" meta="Cuando el equipo vuelve después de lo pactado">
        <div className="admin-settings-grid">
          <SelectField label="Se cobra como" value={form.lateKind} onChange={(value) => patch({ lateKind: value as LateFeeKind })} options={[{ value: "PERCENT", label: "% del alquiler" }, { value: "FIXED", label: "Monto fijo" }]} disabled={disabled} />
          <SelectField label="Por" value={form.lateUnit} onChange={(value) => patch({ lateUnit: value as LateFeeUnit })} options={[{ value: "DAY", label: "Día de demora" }, { value: "HOUR", label: "Hora de demora" }]} disabled={disabled} />
          {form.lateKind === "PERCENT" ? (
            <NumberField label="% del alquiler" value={form.lateValue} onChange={(value) => patch({ lateValue: value })} maxLength={4} disabled={disabled} hint="Por cada unidad de demora (día u hora)." />
          ) : (
            <MoneyField label="Monto fijo" value={form.lateValue} onChange={(value) => patch({ lateValue: value })} limit={BUDGET_INT_MAX} disabled={disabled} hint="Por cada unidad de demora. Ej.: 100.000 o 200.000." />
          )}
          <NumberField strictInteger label="Tolerancia (minutos)" value={form.lateGrace} onChange={(value) => patch({ lateGrace: value })} maxLength={4} disabled={disabled} hint="Hasta este tiempo de demora no se cobra nada." />
        </div>
        <AdminDisclosure title="Probar recargo" hint="Ejemplo, no se guarda"><div className="rental-preview admin-settings-grid" aria-live="polite">
          {form.lateKind === "PERCENT" ? <MoneyField label="Alquiler de ejemplo" value={sample.rental} limit={BUDGET_INT_MAX} onChange={(rental) => setSample({ ...sample, rental })} /> : null}
          <NumberField label="Demora de ejemplo" value={sample.lateCount} maxLength={3} onChange={(lateCount) => setSample({ ...sample, lateCount })} />
          <SelectField label="Unidad de la demora" value={sample.lateUnit} onChange={(value) => setSample({ ...sample, lateUnit: value as LateFeeUnit })} options={[{ value: "DAY", label: "Días" }, { value: "HOUR", label: "Horas" }]} />
          <p className="rental-preview-result"><strong>{lateLabel} = {formatMoney(lateAmount.amount)}</strong>{late.units === 0 && lateMinutes > 0 ? " (dentro de la tolerancia)" : late.units > 0 ? ` · ${late.units} ${form.lateUnit === "DAY" ? "día" : "hora"}${late.units === 1 ? "" : "s"} × ${formatMoney(lateAmount.unitAmount)}` : ""}</p>
        </div></AdminDisclosure>
      </AdminPanel>

      <AdminPanel title="Roturas y faltantes" icon="alert" meta="Sobre el costo de reposición del producto">
        <div className="admin-settings-grid">
          <NumberField label="% del costo de reposición" value={form.damagePercent} onChange={(value) => patch({ damagePercent: value })} maxLength={3} disabled={disabled} hint="100 = el costo completo. Cada cargo se puede editar antes de aplicarlo." />
        </div>
        <AdminDisclosure title="Probar roturas y faltantes" hint="Ejemplo, no se guarda"><div className="rental-preview admin-settings-grid" aria-live="polite">
          <NumberField strictInteger label="Piezas de ejemplo" value={sample.pieces} maxLength={4} onChange={(pieces) => setSample({ ...sample, pieces })} />
          <MoneyField label="Costo de reposición de ejemplo" value={sample.replacement} limit={BUDGET_INT_MAX} onChange={(replacement) => setSample({ ...sample, replacement })} />
          <p className="rental-preview-result"><strong>{num(sample.pieces)} × {formatMoney(damage.unitAmount)} = {formatMoney(damage.amount)}</strong></p>
        </div></AdminDisclosure>
      </AdminPanel>

      <AdminPanel title="Cargos personalizados" icon="receipt" meta="Se ofrecen al devolver según lo que vuelve">
        <div className="rental-rows">
          {form.charges.length === 0 ? <p className="admin-field-hint">Sin cargos. Agregá, por ejemplo, lavado de pieza, mancha de mantel o armado extra.</p> : null}
          {form.charges.map((charge, index) => (
            <div className="rental-row admin-settings-grid" key={charge.id}>
              <TextField label={`Nombre · cargo ${index + 1}`} value={charge.name} maxLength={80} disabled={disabled} onChange={(name) => patch({ charges: form.charges.map((row, i) => (i === index ? { ...row, name } : row)) })} />
              <MoneyField label={`Monto · cargo ${index + 1}`} value={charge.amount} limit={BUDGET_INT_MAX} disabled={disabled} onChange={(amount) => patch({ charges: form.charges.map((row, i) => (i === index ? { ...row, amount } : row)) })} />
              <SelectField label={`Se cobra · cargo ${index + 1}`} value={charge.unit} disabled={disabled} onChange={(unit) => patch({ charges: form.charges.map((row, i) => (i === index ? { ...row, unit: unit === "EVENT" ? "EVENT" : "PIECE" } : row)) })} options={UNIT_OPTIONS} />
              <SelectField label={`Categoría · cargo ${index + 1}`} value={charge.categoryId} disabled={disabled} onChange={(categoryId) => patch({ charges: form.charges.map((row, i) => (i === index ? { ...row, categoryId } : row)) })} options={[{ value: "", label: "Todas (siempre se ofrece)" }, ...categoryOptions]} />
              <AdminButton type="button" icon="trash" disabled={disabled} aria-label={`Quitar el cargo ${index + 1}`} onClick={() => patch({ charges: form.charges.filter((_, i) => i !== index) })} />
            </div>
          ))}
          <AdminButton type="button" icon="plus" disabled={disabled || form.charges.length >= 100} onClick={() => patch({ charges: [...form.charges, { id: `c${Date.now()}`, name: "", amount: "", unit: "PIECE", categoryId: "" }] })}>Agregar cargo</AdminButton>
        </div>
      </AdminPanel>

      <AdminPanel title="Política de cancelación" icon="calendar" meta="Se muestra al cliente en el portal y en el impreso">
        <div className="rental-rows">
          {form.tiers.map((tier, index) => (
            <div className="rental-row admin-settings-grid" key={index}>
              <NumberField strictInteger label={`Desde (días antes) · tramo ${index + 1}`} value={tier.days} maxLength={3} disabled={disabled} onChange={(days) => patch({ tiers: form.tiers.map((row, i) => (i === index ? { ...row, days } : row)) })} hint={tier.days === "0" ? "Último tramo: menos días que el anterior." : undefined} />
              <NumberField label={`Se retiene (% de la seña) · tramo ${index + 1}`} value={tier.percent} maxLength={3} disabled={disabled} onChange={(percent) => patch({ tiers: form.tiers.map((row, i) => (i === index ? { ...row, percent } : row)) })} />
              <AdminButton type="button" icon="trash" disabled={disabled || form.tiers.length <= 1} aria-label={`Quitar el tramo ${index + 1}`} onClick={() => patch({ tiers: form.tiers.filter((_, i) => i !== index) })} />
            </div>
          ))}
          <div className="rental-row-actions">
            <AdminButton type="button" icon="plus" disabled={disabled || form.tiers.length >= 10} onClick={() => patch({ tiers: [...form.tiers, { days: "", percent: "" }] })}>Agregar tramo</AdminButton>
            <AdminButton type="button" icon="refresh" disabled={disabled} onClick={() => patch({ tiers: DEFAULT_CANCELLATION_POLICY.map((tier) => ({ days: String(tier.minDaysBefore), percent: String(tier.retainPercent) })) })}>Usar la de fábrica</AdminButton>
          </div>
        </div>
        <AdminDisclosure title="Probar cancelación" hint="Ejemplo, no se guarda"><div className="rental-preview" aria-live="polite">
          {tiersValid ? <ul className="rental-policy-lines">{cancellationPolicyLines(policy).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="admin-field-hint">Completá los días y el porcentaje de cada tramo.</p>}
          <div className="admin-settings-grid">
            <NumberField strictInteger label="Cancelación de ejemplo (días antes)" value={sample.cancelDays} maxLength={3} onChange={(cancelDays) => setSample({ ...sample, cancelDays })} />
            <MoneyField label="Seña de ejemplo" value={sample.advance} limit={BUDGET_INT_MAX} onChange={(advance) => setSample({ ...sample, advance })} />
          </div>
          {tiersValid ? <p className="rental-preview-result"><strong>Con {num(sample.cancelDays)} días: se propone retener {formatMoney(cancel.retained)} ({cancel.percent} %) y devolver {formatMoney(cancel.refundable)}.</strong> Solo es una propuesta: nunca se reembolsa solo.</p> : null}
        </div></AdminDisclosure>
      </AdminPanel>

      <AdminPanel title="Condiciones del alquiler" icon="plan" meta="Se muestran en el portal y en el impreso">
        <TextAreaField label="Texto de las condiciones" value={form.terms} onChange={(terms) => patch({ terms })} maxLength={4000} rows={6} counter disabled={disabled} hint="Retiro y devolución, cuidado de las piezas, qué se cobra por roturas, etc. Vacío = no se muestra." wide />
      </AdminPanel>

      <div className="admin-settings-actions">
        <AdminButton type="submit" variant="primary" icon="check" busy={busy} disabled={readOnly || !dirty}>Guardar garantía y cargos</AdminButton>
        {dirty ? <AdminButton type="button" disabled={busy} onClick={() => setForm(initial)}>Descartar cambios</AdminButton> : null}
      </div>
    </form>
  );
}
