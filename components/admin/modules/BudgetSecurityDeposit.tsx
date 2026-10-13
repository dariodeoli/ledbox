"use client";

import { useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { formatMoney, type AdminTone } from "@/lib/admin-format";
import type { AdminBudgetRow } from "@/lib/admin-types";
import { BUDGET_INT_MAX, defaultDepositPlanRows } from "@/lib/budget-payment-plan";
import { isSecurityDepositStatus, securityDepositPublic } from "@/lib/budget-security-deposit";
import { MoneyField, NumberField, TextField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminDialog, AdminDialogSection, AdminNote } from "../AdminUI";

/** Tono del estado de la garantía (pendiente: aviso; en custodia: info; devuelta: ok; retenida: alerta). */
export function securityDepositTone(status: string | null | undefined): AdminTone {
  if (status === "RETURNED") return "ok";
  if (status === "KEPT" || status === "KEPT_PARTIAL") return "danger";
  if (status === "HELD") return "info";
  return "warn";
}

/**
 * Seña y garantía en el alta del presupuesto. Sin tocar nada rige el default de
 * la empresa (Ajustes > Alquileres); lo que la persona escribe se respeta, y
 * vaciar el campo significa «sin seña» / «sin garantía». La garantía no se suma
 * al total.
 */
export type CreationDeposit = { percent: string | null; deposit: string | null };
export const EMPTY_CREATION_DEPOSIT: CreationDeposit = { percent: null, deposit: null };

export function creationDepositBody(state: CreationDeposit): Record<string, unknown> {
  return {
    ...(state.percent !== null ? { depositPercent: state.percent === "" ? null : Number(state.percent) } : {}),
    ...(state.deposit !== null ? { securityDeposit: state.deposit === "" ? null : Number(state.deposit) } : {}),
  };
}

export function BudgetCreationDeposit({ state, onChange, defaults, subtotal, disabled }: {
  state: CreationDeposit;
  onChange: (state: CreationDeposit) => void;
  defaults: { depositPercent: number | null; securityDepositDefault: number | null };
  subtotal: number;
  disabled?: boolean;
}) {
  const percentValue = state.percent ?? (defaults.depositPercent === null ? "" : String(defaults.depositPercent));
  const depositValue = state.deposit ?? (defaults.securityDepositDefault === null ? "" : String(defaults.securityDepositDefault));
  const percent = percentValue === "" ? null : Number(percentValue);
  const rows = defaultDepositPlanRows(percent, subtotal);
  const fromSettings = state.percent === null && defaults.depositPercent !== null;
  return (
    <div className="admin-form-grid" aria-label="Seña y garantía">
      <NumberField
        label="Seña (%)"
        value={percentValue}
        maxLength={3}
        disabled={disabled}
        onChange={(value) => onChange({ ...state, percent: value })}
        hint={
          percent && percent > 0
            ? `Seña ${percent} %${fromSettings ? " (según Ajustes)" : ""}${rows ? ` · ${formatMoney(rows[0].amount)} + saldo ${formatMoney(rows[1].amount)}` : ""}. Editable; vacío = sin seña.`
            : "Sin seña. Se puede definir después en el plan de pagos."
        }
      />
      <MoneyField
        label="Depósito de garantía"
        value={depositValue}
        limit={BUDGET_INT_MAX}
        disabled={disabled}
        onChange={(value) => onChange({ ...state, deposit: value })}
        hint={`${state.deposit === null && defaults.securityDepositDefault !== null ? "Según Ajustes. " : ""}Opcional · no se suma al total ni cuenta como cobro.`}
      />
    </div>
  );
}

type Mode = "idle" | "partial";

/**
 * Garantía de un presupuesto: monto mientras no se recibió y, después, los
 * cambios de estado (devolver, retener parcial, retener todo). Cada cambio lo
 * valida y lo audita el servidor; con el evento sin incidentes se ofrece
 * «Devolver garantía» y con incidentes «Retener parcial».
 */
export function SecurityDepositDialog({ budget, onClose, onSaved }: { budget: AdminBudgetRow; onClose: () => void; onSaved: (message: string) => void }) {
  const status = isSecurityDepositStatus(budget.securityDepositStatus) ? budget.securityDepositStatus : null;
  const summary = securityDepositPublic({ securityDeposit: budget.securityDeposit ?? null, securityDepositStatus: budget.securityDepositStatus ?? null, securityDepositRetained: budget.securityDepositRetained ?? null });
  const [amount, setAmount] = useState(budget.securityDeposit ? String(budget.securityDeposit) : "");
  const [retained, setRetained] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/budgets", { budgetId: budget.id, ...body }, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(message);
    onClose();
  }

  const open = status === null || status === "PENDING";
  const held = status === "HELD";
  const advice = budget.equipmentReturn === "clean"
    ? "Los equipos volvieron sin incidentes: corresponde devolver la garantía."
    : budget.equipmentReturn === "incidents"
      ? "Hay equipos dañados o faltantes: retené el costo del incidente y devolvé el resto."
      : budget.equipmentReturn === "pending"
        ? "Todavía faltan equipos por devolver."
        : null;

  return (
    <AdminDialog
      title={`Depósito de garantía · ${budget.title}`}
      icon="wallet"
      size="md"
      description={`No se suma al total del presupuesto (${formatMoney(budget.total)}) ni cuenta como cobro o seña.`}
      error={error}
      onClose={onClose}
      footer={
        <>
          <AdminButton type="button" icon="close" disabled={busy} onClick={onClose}>Cerrar</AdminButton>
          {open ? (
            <>
              <AdminButton type="button" busy={busy} disabled={amount === String(budget.securityDeposit ?? "")} onClick={() => void send({ kind: "security-deposit", securityDeposit: amount === "" ? null : Number(amount) }, amount === "" ? "Quitamos la garantía." : "Guardamos la garantía.")}>Guardar monto</AdminButton>
              {status === "PENDING" ? <AdminButton type="button" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" onClick={() => void send({ kind: "security-deposit-status", to: "HELD" }, "Garantía recibida: queda en custodia.")}>Marcar recibida</AdminButton> : null}
            </>
          ) : null}
          {held && mode === "idle" ? (
            <>
              <AdminButton type="button" variant={budget.equipmentReturn === "incidents" ? undefined : "primary"} icon="check" busy={busy} busyLabel="Guardando…" onClick={() => void send({ kind: "security-deposit-status", to: "RETURNED" }, "Garantía devuelta.")}>Devolver garantía</AdminButton>
              <AdminButton type="button" variant={budget.equipmentReturn === "incidents" ? "primary" : undefined} busy={busy} onClick={() => setMode("partial")}>Retener parcial</AdminButton>
              <AdminButton type="button" busy={busy} onClick={() => void send({ kind: "security-deposit-status", to: "KEPT" }, "Garantía retenida.")}>Retener todo</AdminButton>
            </>
          ) : null}
          {held && mode === "partial" ? (
            <>
              <AdminButton type="button" disabled={busy} onClick={() => setMode("idle")}>Volver</AdminButton>
              <AdminButton type="button" variant="primary" busy={busy} busyLabel="Guardando…" disabled={!retained || Number(retained) <= 0} onClick={() => void send({ kind: "security-deposit-status", to: "KEPT_PARTIAL", retainedAmount: Number(retained), reason }, "Garantía retenida parcialmente.")}>Retener {retained ? formatMoney(Number(retained)) : ""}</AdminButton>
            </>
          ) : null}
        </>
      }
    >
      <AdminDialogSection title="Garantía">
      {summary ? (
        <p className="admin-dialog-text admin-field--wide">
          <AdminBadge tone={securityDepositTone(summary.status)}>{summary.statusLabel}</AdminBadge>{" "}
          <strong className="admin-nowrap">{formatMoney(summary.amount)}</strong>
          {summary.retained > 0 ? <> · retenido <span className="admin-nowrap">{formatMoney(summary.retained)}</span></> : null}
          {status === "RETURNED" || status === "KEPT_PARTIAL" ? <> · devuelto <span className="admin-nowrap">{formatMoney(summary.returned)}</span></> : null}
        </p>
      ) : null}
      {held && advice ? <AdminNote tone={budget.equipmentReturn === "incidents" ? "warn" : undefined}>{advice}</AdminNote> : null}
      {open ? (
        <MoneyField label="Monto de la garantía" value={amount} limit={BUDGET_INT_MAX} disabled={busy} onChange={setAmount} hint="Vacío = sin garantía." />
      ) : null}
      {held && mode === "partial" ? (
        <>
          <MoneyField label="Monto a retener" required value={retained} limit={BUDGET_INT_MAX} disabled={busy} onChange={setRetained} hint={`Menor a ${formatMoney(budget.securityDeposit ?? 0)}; el resto se devuelve al cliente.`} />
          <TextField label="Motivo" value={reason} maxLength={300} disabled={busy} onChange={setReason} placeholder="Ej.: daño del equipo X" />
        </>
      ) : null}
      </AdminDialogSection>
    </AdminDialog>
  );
}
