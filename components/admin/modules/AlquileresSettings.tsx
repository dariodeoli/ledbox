"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { publicConfig } from "@/lib/public-config";
import type { AdminRentalSettings as RentalSettingsView } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { NumberField, PhoneField, SwitchField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Alquileres (fase 2b): seña, vigencia de la retención, tiempos de preparación,
 * catálogo público y WhatsApp de la empresa. Los tiempos se cargan en horas y se
 * guardan en minutos; solo se envía lo que la persona cambió, así un valor en
 * minutos no enteros no se pisa. OWNER/ADMIN: el API revalida el rol.
 */

type Form = {
  depositPercent: string;
  holdHours: string;
  prepHours: string;
  transportHours: string;
  deliveryHours: string;
  returnHours: string;
  cleaningHours: string;
  publicCatalogEnabled: boolean;
  publicShowPrices: boolean;
  whatsappPhone: string;
};

const hours = (minutes: number) => String(Math.ceil(minutes / 60));

function toForm(settings: RentalSettingsView): Form {
  return {
    depositPercent: settings.depositPercent === null ? "" : String(settings.depositPercent),
    holdHours: hours(settings.holdTtlMinutes),
    prepHours: hours(settings.prepBufferMin),
    transportHours: hours(settings.transportBufferMin),
    deliveryHours: hours(settings.deliveryBufferMin),
    returnHours: hours(settings.returnBufferMin),
    cleaningHours: hours(settings.cleaningBufferMin),
    publicCatalogEnabled: settings.publicCatalogEnabled,
    publicShowPrices: settings.publicShowPrices,
    whatsappPhone: settings.whatsappPhone ?? "",
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
  const { demo, organization } = useAdminSession();
  const catalogUrl = organization?.slug ? `${publicConfig.siteUrl}/catalogo/${organization.slug}` : null;
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
    if (form.holdHours !== initial.holdHours) body.holdTtlMinutes = Number(form.holdHours) * 60;
    for (const field of HOUR_FIELDS) {
      if (form[field.key] !== initial[field.key]) body[field.api] = Number(form[field.key] || "0") * 60;
    }
    if (form.publicCatalogEnabled !== initial.publicCatalogEnabled) body.publicCatalogEnabled = form.publicCatalogEnabled;
    if (form.publicShowPrices !== initial.publicShowPrices) body.publicShowPrices = form.publicShowPrices;
    if (form.whatsappPhone !== initial.whatsappPhone) body.whatsappPhone = form.whatsappPhone || null;
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

            <AdminPanel title="Catálogo público" icon="globe">
              {catalogUrl ? (
                <p className="admin-field-hint" data-testid="catalog-link">
                  {initial?.publicCatalogEnabled ? (
                    <>
                      Link público de tu catálogo:{" "}
                      <a href={catalogUrl} target="_blank" rel="noopener noreferrer">
                        {catalogUrl}
                      </a>
                    </>
                  ) : (
                    <>
                      Tu catálogo está apagado: el link <strong>{catalogUrl}</strong> responde «no encontrado» hasta que lo enciendas y guardes.
                    </>
                  )}
                </p>
              ) : null}
              <div className="admin-settings-grid">
                <SwitchField
                  label="Catálogo público encendido"
                  checked={form.publicCatalogEnabled}
                  onChange={(checked) => setForm({ ...form, publicCatalogEnabled: checked })}
                  hint="Muestra en la web los productos marcados como visibles."
                  disabled={demo || busy}
                />
                <SwitchField
                  label="Mostrar precios"
                  checked={form.publicShowPrices}
                  onChange={(checked) => setForm({ ...form, publicShowPrices: checked })}
                  hint="Apagado, el catálogo pide cotización en vez de mostrar precios."
                  disabled={demo || busy}
                />
                <PhoneField
                  label="WhatsApp de la empresa"
                  value={form.whatsappPhone}
                  onChange={(value) => setForm({ ...form, whatsappPhone: value })}
                  hint="Número al que llegan las consultas del catálogo."
                  disabled={demo || busy}
                />
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
    </div>
  );
}
