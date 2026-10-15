"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import type { AdminRentalSettings as RentalSettingsView } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { BUDGET_INT_MAX } from "@/lib/budget-payment-plan";
import { MoneyField, NumberField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";
import { DeliveryZonesPanel } from "./DeliveryZonesPanel";

/**
 * Alquileres (fase 2b): seña, vigencia de la retención y tiempos de preparación.
 * El catálogo público, los precios y el WhatsApp viven ahora en Ajustes → Tienda web. Los tiempos se cargan en horas y se
 * guardan en minutos; solo se envía lo que la persona cambió, así un valor en
 * minutos no enteros no se pisa. OWNER/ADMIN: el API revalida el rol.
 */

type Form = {
  depositPercent: string;
  securityDepositDefault: string;
  holdHours: string;
  prepHours: string;
  transportHours: string;
  deliveryHours: string;
  returnHours: string;
  cleaningHours: string;
};

const hours = (minutes: number) => String(Math.ceil(minutes / 60));

function toForm(settings: RentalSettingsView): Form {
  return {
    depositPercent: settings.depositPercent === null ? "" : String(settings.depositPercent),
    securityDepositDefault: settings.securityDepositDefault === null ? "" : String(settings.securityDepositDefault),
    holdHours: hours(settings.holdTtlMinutes),
    prepHours: hours(settings.prepBufferMin),
    transportHours: hours(settings.transportBufferMin),
    deliveryHours: hours(settings.deliveryBufferMin),
    returnHours: hours(settings.returnBufferMin),
    cleaningHours: hours(settings.cleaningBufferMin),
  };
}

const HOUR_FIELDS = [
  { key: "prepHours", api: "prepBufferMin", label: "Preparación (horas)", hint: "Antes del evento: dejar el equipo listo." },
  { key: "transportHours", api: "transportBufferMin", label: "Transporte (horas)", hint: "Se cuenta antes y después del evento." },
  { key: "deliveryHours", api: "deliveryBufferMin", label: "Entrega (horas)", hint: "Antes del evento: llegar y entregar." },
  { key: "returnHours", api: "returnBufferMin", label: "Devolución (horas)", hint: "Después del evento: recibir el equipo." },
  { key: "cleaningHours", api: "cleaningBufferMin", label: "Limpieza (horas)", hint: "Después del evento: revisar y limpiar." },
] as const;

export function AlquileresSettings() {
  const { demo } = useAdminSession();
  const resource = useAdminResource("/api/admin/settings/rental", (payload) => (payload.settings ?? null) as RentalSettingsView | null);
  const initial = useMemo(() => (resource.data ? toForm(resource.data) : null), [resource.data]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const dirty = Boolean(form && initial && JSON.stringify(form) !== JSON.stringify(initial));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !initial) return;
    setError("");
    setNotice("");
    const body: Record<string, unknown> = {};
    if (form.depositPercent !== initial.depositPercent) body.depositPercent = form.depositPercent === "" ? null : Number(form.depositPercent);
    if (form.securityDepositDefault !== initial.securityDepositDefault) body.securityDepositDefault = form.securityDepositDefault === "" ? null : Number(form.securityDepositDefault);
    if (form.holdHours !== initial.holdHours) body.holdTtlMinutes = Number(form.holdHours) * 60;
    for (const field of HOUR_FIELDS) {
      if (form[field.key] !== initial[field.key]) body[field.api] = Number(form[field.key] || "0") * 60;
    }
    setBusy(true);
    const result = await adminSend<{ settings: RentalSettingsView }>("/api/admin/settings/rental", body, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Guardamos los ajustes de alquiler.");
    resource.reload();
  }

  return (
    <div className="admin-module-page">
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={4}>
        {form ? (
          <form className="admin-settings" onSubmit={(event) => void save(event)}>
            <AdminPanel title="Seña y retenciones" icon="calendar">
              <div className="admin-settings-grid">
                <NumberField
                  label="Seña (%)"
                  value={form.depositPercent}
                  onChange={(value) => setForm({ ...form, depositPercent: value })}
                  maxLength={3}
                  hint="De 0 a 100. Vacío = la empresa no tiene una política de seña."
                  disabled={demo || busy}
                />
                <MoneyField
                  label="Depósito de garantía por defecto"
                  value={form.securityDepositDefault}
                  onChange={(value) => setForm({ ...form, securityDepositDefault: value })}
                  limit={BUDGET_INT_MAX}
                  hint="Monto que se propone en cada alquiler nuevo. No se suma al total ni cuenta como cobro. Vacío = sin garantía."
                  disabled={demo || busy}
                />
                <NumberField
                  label="Vencimiento de la retención (horas)"
                  value={form.holdHours}
                  onChange={(value) => setForm({ ...form, holdHours: value })}
                  maxLength={4}
                  hint="Una retención sin confirmar deja de reservar stock pasado este tiempo."
                  disabled={demo || busy}
                />
              </div>
            </AdminPanel>

            <AdminPanel title="Tiempos de preparación" icon="calendar" meta="Se suman al rango del evento">
              <p className="admin-field-hint">
                El equipo queda ocupado antes (preparación + transporte + entrega) y después (devolución + transporte + limpieza)
                del evento. Cada producto puede tener sus propios tiempos en su ficha.
              </p>
              <div className="admin-settings-grid">
                {HOUR_FIELDS.map((field) => (
                  <NumberField
                    key={field.key}
                    label={field.label}
                    value={form[field.key]}
                    onChange={(value) => setForm({ ...form, [field.key]: value })}
                    maxLength={3}
                    hint={field.hint}
                    disabled={demo || busy}
                  />
                ))}
              </div>
            </AdminPanel>

            <div className="admin-settings-actions">
              <AdminButton type="submit" variant="primary" icon="check" busy={busy} disabled={demo || !dirty}>
                Guardar ajustes
              </AdminButton>
            </div>
          </form>
        ) : null}
      </AdminDataState>
      <DeliveryZonesPanel />
    </div>
  );
}
