"use client";

import { useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime, formatMoney, type AdminTone } from "@/lib/admin-format";
import { BUDGET_INT_MAX } from "@/lib/budget-payment-plan";
import type { RentalChargeRow, SettlementView } from "@/lib/server/rental-settlement";
import { MoneyField, NumberField, TextField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminDataState, AdminDialogSection, AdminNote } from "../AdminUI";

/**
 * Evento → Devolución → «Liquidación» (alquileres P1-4), dentro del diálogo de la garantía. La
 * devolución propone los cargos (demora, roturas, faltantes); acá quien factura (OWNER, ADMIN,
 * FINANCE) los aplica, los edita o los condona con motivo, agrega los de la lista de la empresa y
 * liquida contra la garantía. «Liquidar» corre una sola vez en el servidor: repetirlo no duplica nada.
 */

const STATUS_LABEL: Record<RentalChargeRow["status"], string> = { PROPOSED: "Propuesto", APPLIED: "Aplicado", WAIVED: "Condonado" };
const STATUS_TONE: Record<RentalChargeRow["status"], AdminTone> = { PROPOSED: "warn", APPLIED: "ok", WAIVED: "neutral" };

type Mode = { type: "waive" | "edit"; id: string } | null;

export function RentalSettlementSection({ budgetId, canEdit, onChanged }: { budgetId: string; canEdit: boolean; onChanged: (message: string) => void }) {
  const resource = useAdminResource(`/api/admin/budgets/settlement?budgetId=${encodeURIComponent(budgetId)}&cancellation=1`, (payload) => ({
    settlement: (payload.settlement ?? null) as SettlementView | null,
    cancellation: (payload.cancellation ?? null) as { daysBefore: number | null; percent: number | null; retained: number; refundable: number; advancePaid: number } | null,
  }));
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitAmount, setUnitAmount] = useState("");
  const [offerQuantity, setOfferQuantity] = useState<Record<string, string>>({});
  const [manual, setManual] = useState({ label: "", amount: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const view = resource.data?.settlement ?? null;
  const cancellation = resource.data?.cancellation ?? null;

  async function post(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/budgets/settlement", { budgetId, ...body }, "POST");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setMode(null);
    setReason("");
    resource.reload();
    onChanged(message);
    return true;
  }

  const settled = view?.settled ?? null;
  const locked = !canEdit || Boolean(settled);
  const preview = view?.preview;

  return (
    <AdminDialogSection title="Liquidación de la devolución">
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={2}>
        {view ? (
          <div className="settlement" aria-live="polite">
            {error ? <AdminNote tone="error">{error}</AdminNote> : null}
            {view.equipmentReturn === "pending" ? <AdminNote tone="warn">Todavía faltan equipos por devolver: los cargos de roturas y demoras aparecen cuando se registra cada devolución.</AdminNote> : null}
            {view.charges.length === 0 ? <p className="admin-field-hint">Sin cargos. Si todo vuelve a tiempo y sin daños, no hay nada que cobrar.</p> : null}
            <ul className="settlement-list">
              {view.charges.map((charge) => (
                <li key={charge.id} className="settlement-charge">
                  <div className="settlement-charge-head">
                    <strong>{charge.label}</strong>
                    <AdminBadge tone={STATUS_TONE[charge.status]}>{STATUS_LABEL[charge.status]}</AdminBadge>
                  </div>
                  <p className="settlement-charge-amount">
                    {charge.quantity} × {formatMoney(charge.unitAmount)} = <strong className="admin-nowrap">{formatMoney(charge.amount)}</strong>
                  </p>
                  {charge.note ? <p className="admin-field-hint">{charge.note}</p> : null}
                  {charge.status === "WAIVED" && charge.reason ? <p className="admin-field-hint">Condonado por {charge.decidedByName ?? "el equipo"}: {charge.reason}</p> : null}
                  {!locked && mode?.id === charge.id && mode.type === "waive" ? (
                    <div className="settlement-inline">
                      <TextField label="Motivo de la condonación" required value={reason} maxLength={300} disabled={busy} onChange={setReason} />
                      <AdminButton type="button" disabled={busy} onClick={() => setMode(null)}>Cancelar</AdminButton>
                      <AdminButton type="button" variant="primary" busy={busy} disabled={reason.trim().length < 3} onClick={() => void post({ action: "charge", chargeId: charge.id, decision: "waive", reason }, "Condonamos el cargo.")}>Condonar</AdminButton>
                    </div>
                  ) : null}
                  {!locked && mode?.id === charge.id && mode.type === "edit" ? (
                    <div className="settlement-inline">
                      <NumberField strictInteger label="Cantidad" value={quantity} maxLength={5} disabled={busy} onChange={setQuantity} />
                      <MoneyField label="Monto unitario" value={unitAmount} limit={BUDGET_INT_MAX} disabled={busy} onChange={setUnitAmount} />
                      <AdminButton type="button" disabled={busy} onClick={() => setMode(null)}>Cancelar</AdminButton>
                      <AdminButton type="button" variant="primary" busy={busy} disabled={quantity === "" || unitAmount === ""} onClick={() => void post({ action: "charge", chargeId: charge.id, decision: "update", quantity: Number(quantity), unitAmount: Number(unitAmount) }, "Guardamos el cargo.")}>Guardar</AdminButton>
                    </div>
                  ) : null}
                  {!locked && mode?.id !== charge.id ? (
                    <div className="settlement-actions">
                      {charge.status === "PROPOSED" ? (
                        <>
                          <AdminButton type="button" variant="primary" disabled={busy} onClick={() => void post({ action: "charge", chargeId: charge.id, decision: "apply" }, "Aplicamos el cargo.")}>Aplicar</AdminButton>
                          <AdminButton type="button" disabled={busy} onClick={() => { setMode({ type: "edit", id: charge.id }); setQuantity(String(charge.quantity)); setUnitAmount(String(charge.unitAmount)); }}>Editar</AdminButton>
                          <AdminButton type="button" disabled={busy} onClick={() => { setMode({ type: "waive", id: charge.id }); setReason(""); }}>Condonar</AdminButton>
                        </>
                      ) : (
                        <AdminButton type="button" disabled={busy} onClick={() => void post({ action: "charge", chargeId: charge.id, decision: "reopen" }, "Reabrimos el cargo.")}>Reabrir</AdminButton>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {!locked && view.offers.length > 0 ? (
              <div className="settlement-offers">
                <p className="admin-field-hint">Cargos de la empresa según lo que volvió:</p>
                {view.offers.map((offer) => (
                  <div className="settlement-inline" key={offer.typeId}>
                    <span className="settlement-offer-name">{offer.name} · {formatMoney(offer.amount)} {offer.unit === "PIECE" ? "por pieza" : "por evento"}</span>
                    {offer.unit === "PIECE" ? <NumberField strictInteger label={`Piezas · ${offer.name}`} value={offerQuantity[offer.typeId] ?? String(offer.suggestedQuantity)} maxLength={5} disabled={busy} onChange={(value) => setOfferQuantity({ ...offerQuantity, [offer.typeId]: value })} /> : null}
                    <AdminButton type="button" icon="plus" disabled={busy} onClick={() => void post({ action: "add-charge", typeId: offer.typeId, quantity: offer.unit === "PIECE" ? Number(offerQuantity[offer.typeId] ?? offer.suggestedQuantity) : 1 }, `Agregamos «${offer.name}».`)}>Agregar</AdminButton>
                  </div>
                ))}
              </div>
            ) : null}

            {!locked ? (
              <div className="settlement-inline">
                <TextField label="Otro cargo" value={manual.label} maxLength={160} disabled={busy} onChange={(label) => setManual({ ...manual, label })} placeholder="Ej.: armado extra" />
                <MoneyField label="Monto" value={manual.amount} limit={BUDGET_INT_MAX} disabled={busy} onChange={(amount) => setManual({ ...manual, amount })} />
                <AdminButton type="button" icon="plus" disabled={busy || !manual.label.trim() || !manual.amount} onClick={() => void post({ action: "add-charge", kind: "OTHER", label: manual.label, quantity: 1, unitAmount: Number(manual.amount) }, "Agregamos el cargo.").then((ok) => ok && setManual({ label: "", amount: "" }))}>Agregar cargo</AdminButton>
              </div>
            ) : null}

            {cancellation && cancellation.percent !== null && cancellation.daysBefore !== null && cancellation.daysBefore >= 0 && !settled && cancellation.advancePaid > 0 ? (
              <p className="admin-field-hint">
                Si se cancelara hoy ({cancellation.daysBefore} días antes del evento), la política propone retener {formatMoney(cancellation.retained)} ({cancellation.percent} % de lo cobrado) y devolver {formatMoney(cancellation.refundable)}. Es solo una propuesta: no se reembolsa solo.
              </p>
            ) : null}
            <dl className="settlement-summary">
              <div><dt>Cargos aplicados</dt><dd className="admin-nowrap">{formatMoney(settled ? settled.chargesTotal : view.appliedTotal)}</dd></div>
              {view.deposit ? <div><dt>Garantía {view.purpose === "RESERVE" ? "(reserva, ya descontada del saldo)" : "(daños)"}</dt><dd className="admin-nowrap">{formatMoney(view.deposit.amount)}</dd></div> : null}
              {settled ? (
                <>
                  <div><dt>Retenido de la garantía</dt><dd className="admin-nowrap">{formatMoney(settled.retained)}</dd></div>
                  <div><dt>Devuelto al cliente</dt><dd className="admin-nowrap">{formatMoney(settled.returned)}</dd></div>
                  <div><dt>Queda por cobrar</dt><dd className="admin-nowrap">{formatMoney(settled.extra)}</dd></div>
                </>
              ) : preview ? (
                <>
                  <div><dt>Se retiene de la garantía</dt><dd className="admin-nowrap">{formatMoney(preview.retained)}</dd></div>
                  <div><dt>Se devuelve al cliente</dt><dd className="admin-nowrap">{formatMoney(preview.returned)}</dd></div>
                  <div><dt>Quedaría por cobrar</dt><dd className="admin-nowrap">{formatMoney(preview.extra)}</dd></div>
                </>
              ) : null}
            </dl>

            {settled ? (
              <AdminNote tone="ok">Liquidada el {formatDateTime(settled.at)} por {settled.byName || "el equipo"}. No se puede repetir.</AdminNote>
            ) : canEdit ? (
              <div className="settlement-actions">
                <AdminButton
                  type="button"
                  variant="primary"
                  icon="check"
                  busy={busy}
                  busyLabel="Liquidando…"
                  disabled={view.proposedCount > 0 || view.equipmentReturn === "pending"}
                  onClick={() => void post({ action: "settle" }, "Liquidamos la devolución.")}
                >
                  Liquidar
                </AdminButton>
                {view.proposedCount > 0 ? <span className="admin-field-hint">Decidí los {view.proposedCount} cargo{view.proposedCount === 1 ? "" : "s"} propuesto{view.proposedCount === 1 ? "" : "s"} (aplicar o condonar).</span> : null}
              </div>
            ) : (
              <p className="admin-field-hint">Solo el equipo de finanzas puede aplicar, condonar y liquidar.</p>
            )}
          </div>
        ) : null}
      </AdminDataState>
    </AdminDialogSection>
  );
}
