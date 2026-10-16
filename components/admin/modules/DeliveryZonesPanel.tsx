"use client";

import { useState, type FormEvent } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatMoney, formatNumber } from "@/lib/admin-format";
import { BUDGET_INT_MAX } from "@/lib/budget-payment-plan";
import { deliveryFee, deliveryRateText, type DeliveryZoneView } from "@/lib/delivery-zones";
import { useAdminSession } from "../AdminShell";
import { MoneyField, NumberField, TextAreaField, TextField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDataState, AdminDialog, AdminEmpty, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Ajustes → Alquileres → «Zonas de flete» (alquileres P2). Cada zona tiene un precio base y, si
 * el pedido supera cierta cantidad de piezas, un recargo. Archivar no borra: los presupuestos
 * que ya usaron la zona conservan su línea de flete. Los montos los edita quien puede tocar
 * presupuestos (el API revalida el rol: OPERATIONS y VIEWER no).
 */

type ZoneForm = { id: string | null; name: string; basePrice: string; volumeThreshold: string; extraPrice: string; notes: string };

const EMPTY: ZoneForm = { id: null, name: "", basePrice: "", volumeThreshold: "", extraPrice: "", notes: "" };
const toForm = (zone: DeliveryZoneView): ZoneForm => ({
  id: zone.id,
  name: zone.name,
  basePrice: String(zone.basePrice),
  volumeThreshold: zone.volumeThreshold === null ? "" : String(zone.volumeThreshold),
  extraPrice: zone.extraPrice === null ? "" : String(zone.extraPrice),
  notes: zone.notes ?? "",
});

export function DeliveryZonesPanel() {
  const { demo, role } = useAdminSession();
  const canEdit = !demo && (role === "OWNER" || role === "ADMIN" || role === "FINANCE");
  const resource = useAdminResource("/api/admin/delivery-zones?archived=1", (payload) => (payload.zones ?? []) as DeliveryZoneView[]);
  const [form, setForm] = useState<ZoneForm | null>(null);
  const [archiving, setArchiving] = useState<DeliveryZoneView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    const body = {
      ...(form.id ? { id: form.id } : {}),
      name: form.name,
      basePrice: form.basePrice === "" ? undefined : Number(form.basePrice),
      volumeThreshold: form.volumeThreshold === "" ? null : Number(form.volumeThreshold),
      extraPrice: form.extraPrice === "" ? null : Number(form.extraPrice),
      notes: form.notes,
    };
    const result = await adminSend("/api/admin/delivery-zones", body, form.id ? "PATCH" : "POST");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(form.id ? "Guardamos la zona." : "Creamos la zona de flete.");
    setForm(null);
    resource.reload();
  }

  async function toggle(zone: DeliveryZoneView, action: "archive" | "restore") {
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/delivery-zones", { id: zone.id, action }, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(action === "archive" ? `Archivamos «${zone.name}». Los presupuestos ya armados no cambian.` : `Restauramos «${zone.name}».`);
    setArchiving(null);
    resource.reload();
  }

  const zones = resource.data ?? [];
  const preview = form && form.basePrice !== "" && Number.isInteger(Number(form.basePrice))
    ? {
        base: Number(form.basePrice),
        threshold: form.volumeThreshold === "" ? null : Number(form.volumeThreshold),
        extra: form.extraPrice === "" ? null : Number(form.extraPrice),
      }
    : null;

  return (
    <AdminPanel
      title="Zonas de flete"
      icon="inventory"
      meta="Se cotiza por zona y cantidad de piezas"
      action={canEdit ? <AdminButton type="button" icon="plus" onClick={() => { setError(""); setNotice(""); setForm({ ...EMPTY }); }}>Nueva zona</AdminButton> : undefined}
    >
      <p className="admin-field-hint">
        El flete es el precio de la zona y, si el pedido tiene más piezas que el umbral, se suma el recargo. En la tienda el cliente elige
        la zona (o «A coordinar») y en el presupuesto aparece una línea «Flete — zona» que podés editar a mano.
      </p>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error && !form ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={3}>
        {zones.length === 0 ? (
          <AdminEmpty title="Todavía no cargaste zonas" hint="Sin zonas, el flete se carga a mano como un ítem libre del presupuesto." />
        ) : (
          <ul className="admin-zone-list" aria-label="Zonas de flete">
            {zones.map((zone) => (
              <li key={zone.id} className="admin-zone" data-archived={zone.archivedAt ? "true" : undefined}>
                <div className="admin-zone-main">
                  <strong>{zone.name}</strong>
                  {zone.archivedAt ? <AdminBadge tone="neutral">Archivada</AdminBadge> : <AdminBadge tone="ok">Activa</AdminBadge>}
                  {zone.notes ? <small className="admin-muted">{zone.notes}</small> : null}
                </div>
                <dl className="admin-zone-rates">
                  <div>
                    <dt>Flete base</dt>
                    <dd>{formatMoney(zone.basePrice)}</dd>
                  </div>
                  <div>
                    <dt>Recargo por volumen</dt>
                    <dd title={deliveryRateText(zone)}>
                      {zone.volumeThreshold !== null && zone.extraPrice !== null
                        ? `+${formatMoney(zone.extraPrice)} desde ${formatNumber(zone.volumeThreshold + 1)} piezas`
                        : "Sin recargo"}
                    </dd>
                  </div>
                </dl>
                <div className="admin-zone-actions">
                  {canEdit ? (
                    <>
                      <AdminButton type="button" icon="edit" onClick={() => { setError(""); setNotice(""); setForm(toForm(zone)); }} aria-label={`Editar ${zone.name}`}>Editar</AdminButton>
                      {zone.archivedAt ? (
                        <AdminButton type="button" icon="refresh" disabled={busy} onClick={() => void toggle(zone, "restore")} aria-label={`Restaurar ${zone.name}`}>Restaurar</AdminButton>
                      ) : (
                        <AdminButton type="button" icon="trash" disabled={busy} onClick={() => setArchiving(zone)} aria-label={`Archivar ${zone.name}`}>Archivar</AdminButton>
                      )}
                    </>
                  ) : (
                    <span className="admin-muted">Solo lectura</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminDataState>

      {form ? (
        <AdminDialog
          title={form.id ? "Editar zona de flete" : "Nueva zona de flete"}
          icon="inventory"
          size="md"
          onClose={() => setForm(null)}
          error={error}
          dirty
          footer={({ requestClose }) => (
            <>
              <AdminButton type="button" onClick={requestClose}>Cancelar</AdminButton>
              <AdminButton type="submit" form="delivery-zone-form" variant="primary" icon="check" busy={busy} busyLabel="Guardando…">Guardar zona</AdminButton>
            </>
          )}
        >
          <form id="delivery-zone-form" className="admin-form-grid" onSubmit={(event) => void save(event)}>
            <TextField label="Zona" required maxLength={80} value={form.name} onChange={(name) => setForm({ ...form, name })} hint="Por ejemplo: Asunción, Gran Asunción, Interior." />
            <MoneyField label="Flete base" required limit={BUDGET_INT_MAX} value={form.basePrice} onChange={(basePrice) => setForm({ ...form, basePrice })} hint="Guaraníes, para cualquier cantidad de piezas." />
            <NumberField strictInteger label="Recargo desde (piezas)" maxLength={6} value={form.volumeThreshold} onChange={(volumeThreshold) => setForm({ ...form, volumeThreshold })} hint="Si el pedido tiene MÁS piezas que este número, se suma el recargo. Vacío = sin recargo." />
            <MoneyField label="Recargo por volumen" limit={BUDGET_INT_MAX} value={form.extraPrice} onChange={(extraPrice) => setForm({ ...form, extraPrice })} hint="Se suma al flete base cuando se supera el umbral." />
            <TextAreaField label="Notas internas" maxLength={300} value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
            {preview ? (
              <AdminNote>
                Vista previa: hasta {preview.threshold ?? "cualquier cantidad de"} piezas {formatMoney(deliveryFee({ basePrice: preview.base, volumeThreshold: preview.threshold, extraPrice: preview.extra }, preview.threshold ?? 1))}
                {preview.threshold !== null && preview.extra ? `; con ${formatNumber(preview.threshold + 1)} o más, ${formatMoney(preview.base + preview.extra)}` : ""}.
              </AdminNote>
            ) : null}
          </form>
        </AdminDialog>
      ) : null}

      {archiving ? (
        <AdminConfirmDialog
          title="Archivar zona"
          message={`«${archiving.name}» deja de ofrecerse en la tienda y en los presupuestos nuevos. Los presupuestos que ya la usan no cambian.`}
          confirmLabel="Archivar"
          busy={busy}
          error={error}
          onConfirm={() => void toggle(archiving, "archive")}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </AdminPanel>
  );
}
