"use client";

import { useEffect, useMemo, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { PROFILE_MESSAGES, normalizeGoogleMapsUrl, parseTimeRanges, type TimeRange } from "@/lib/field-rules";
import {
  CONDITIONS_MAX,
  HANDOVER_KINDS,
  HANDOVER_LABEL,
  PAYMENT_METHOD_KEYS,
  PAYMENT_METHOD_LABEL,
  WEEK_DAYS,
  WEEK_DAY_LABEL,
  emptyProfile,
  normalizeInstagram,
  normalizeWebsite,
  parseOrgProfileUpdate,
  type DayHours,
  type HandoverKind,
  type OrgProfile,
  type WeekDay,
} from "@/lib/org-profile";
import { useAdminSession } from "../AdminShell";
import { CityField, EmailField, PhoneField, SwitchField, TextAreaField, TextField, TimeField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Perfil de la empresa (Ajustes → Empresa): contacto, ubicación con link de Google Maps,
 * horario de atención por día (varias franjas o cerrado), horarios por defecto de entrega,
 * retiro y devolución, medios de pago aceptados y condiciones comerciales. Se guarda todo junto
 * (`PATCH /api/admin/organization/profile`, que revalida con las mismas reglas) y se muestra en
 * la tienda, el portal, el presupuesto impreso y los correos. Lo que se deja vacío no se muestra.
 */

type RangeDraft = { from: string; to: string };
type DayDraft = { closed: boolean; ranges: RangeDraft[] };

function toDraft(day: DayHours): DayDraft {
  return { closed: day.closed, ranges: day.ranges.map((range) => ({ ...range })) };
}

/** Error de las franjas de un día para mostrar al lado; `null` si están bien. */
function rangesError(ranges: RangeDraft[]): string | null {
  const parsed = parseTimeRanges(ranges.filter((range) => range.from || range.to));
  return parsed.ok ? null : parsed.error;
}

function RangesEditor({
  label,
  ranges,
  onChange,
  disabled,
  error,
}: {
  label: string;
  ranges: RangeDraft[];
  onChange: (next: RangeDraft[]) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <div className="admin-ranges" role="group" aria-label={label}>
      {ranges.map((range, index) => (
        <div className="admin-ranges-row" key={index}>
          <TimeField
            ariaLabel={`${label}: desde (franja ${index + 1})`}
            value={range.from}
            onChange={(value) => onChange(ranges.map((entry, at) => (at === index ? { ...entry, from: value } : entry)))}
            disabled={disabled}
          />
          <span aria-hidden="true">a</span>
          <TimeField
            ariaLabel={`${label}: hasta (franja ${index + 1})`}
            value={range.to}
            onChange={(value) => onChange(ranges.map((entry, at) => (at === index ? { ...entry, to: value } : entry)))}
            disabled={disabled}
          />
          <AdminButton type="button" icon="trash" disabled={disabled} aria-label={`Quitar la franja ${index + 1} de ${label}`} title="Quitar franja" onClick={() => onChange(ranges.filter((_, at) => at !== index))} />
        </div>
      ))}
      {ranges.length < 4 ? (
        <AdminButton type="button" icon="plus" disabled={disabled} onClick={() => onChange([...ranges, { from: "08:00", to: "12:00" }])}>
          Agregar franja
        </AdminButton>
      ) : null}
      {error ? <span className="admin-field-error" role="alert">{error}</span> : null}
    </div>
  );
}

export function EmpresaPerfil() {
  const { demo } = useAdminSession();
  const resource = useAdminResource("/api/admin/organization/profile", (payload) => (payload as { profile?: OrgProfile }).profile ?? null);
  const [profile, setProfile] = useState<OrgProfile>(emptyProfile());
  const [hours, setHours] = useState<Record<WeekDay, DayDraft>>(() => Object.fromEntries(WEEK_DAYS.map((day) => [day, { closed: false, ranges: [] }])) as unknown as Record<WeekDay, DayDraft>);
  const [handover, setHandover] = useState<Record<HandoverKind, RangeDraft[]>>({ delivery: [], pickup: [], return: [] });
  const [loaded, setLoaded] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readOnly = demo;

  useEffect(() => {
    if (!resource.data) return;
    const next = resource.data;
    setProfile(next);
    const draftHours = Object.fromEntries(WEEK_DAYS.map((day) => [day, toDraft(next.hours[day])])) as Record<WeekDay, DayDraft>;
    const draftHandover = Object.fromEntries(HANDOVER_KINDS.map((kind) => [kind, next.handover[kind].map((range) => ({ ...range }))])) as Record<HandoverKind, RangeDraft[]>;
    setHours(draftHours);
    setHandover(draftHandover);
    setLoaded(JSON.stringify({ next, draftHours, draftHandover }));
  }, [resource.data]);

  const payload = useMemo(
    () => ({
      ...profile,
      hours: Object.fromEntries(WEEK_DAYS.map((day) => [day, { closed: hours[day].closed, ranges: hours[day].closed ? [] : hours[day].ranges.filter((range) => range.from || range.to) }])),
      handover: Object.fromEntries(HANDOVER_KINDS.map((kind) => [kind, handover[kind].filter((range) => range.from || range.to)])),
    }),
    [profile, hours, handover],
  );
  const dirty = Boolean(loaded) && JSON.stringify({ next: profile, draftHours: hours, draftHandover: handover }) !== loaded;
  const mapsError = profile.location.mapsUrl?.trim() && !normalizeGoogleMapsUrl(profile.location.mapsUrl) ? PROFILE_MESSAGES.mapsUrl : null;
  const instagramError = profile.contact.instagram && !normalizeInstagram(profile.contact.instagram) ? "Escribí el usuario (@empresa) o el link de tu perfil." : null;
  const websiteError = profile.contact.website && !normalizeWebsite(profile.contact.website) ? "Escribí una dirección válida, por ejemplo https://miempresa.com.py." : null;
  const dayErrors = Object.fromEntries(WEEK_DAYS.map((day) => [day, hours[day].closed ? null : rangesError(hours[day].ranges)])) as Record<WeekDay, string | null>;
  const handoverErrors = Object.fromEntries(HANDOVER_KINDS.map((kind) => [kind, rangesError(handover[kind])])) as Record<HandoverKind, string | null>;
  const localProblem = Boolean(mapsError || instagramError || websiteError || WEEK_DAYS.some((day) => dayErrors[day]) || HANDOVER_KINDS.some((kind) => handoverErrors[kind]));

  function patchContact(key: keyof OrgProfile["contact"], value: string) {
    setProfile((current) => ({ ...current, contact: { ...current.contact, [key]: value || null } }));
    setNotice("");
  }
  function patchLocation(key: keyof OrgProfile["location"], value: string) {
    setProfile((current) => ({ ...current, location: { ...current.location, [key]: value || null } }));
    setNotice("");
  }

  async function save() {
    // La misma validación del servidor, para no mandar lo que se sabe inválido.
    const check = parseOrgProfileUpdate(payload, resource.data?.location.city);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const result = await adminSend<{ profile: OrgProfile; unchanged?: boolean }>("/api/admin/organization/profile", { profile: payload }, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Guardamos el perfil de la empresa: ya se ve en la tienda, el portal, el presupuesto impreso y los correos.");
    resource.reload();
  }

  return (
    <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={4}>
      <form
        className="admin-settings admin-settings-sections"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        data-testid="empresa-perfil"
      >
        {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
        {error ? <AdminNote tone="error">{error}</AdminNote> : null}

        <AdminPanel title="Contacto" icon="user" meta="Se muestra a tus clientes; lo vacío no se muestra">
          <div className="admin-settings-grid">
            <PhoneField label="Teléfono principal" value={profile.contact.phone ?? ""} onChange={(value) => patchContact("phone", value)} disabled={readOnly} />
            <PhoneField label="Teléfono secundario" value={profile.contact.phone2 ?? ""} onChange={(value) => patchContact("phone2", value)} disabled={readOnly} />
            <PhoneField label="WhatsApp" value={profile.contact.whatsapp ?? ""} onChange={(value) => patchContact("whatsapp", value)} disabled={readOnly} hint="Abre el chat desde la tienda y el portal." />
            <EmailField label="Correo" value={profile.contact.email ?? ""} onChange={(value) => patchContact("email", value)} disabled={readOnly} />
            <TextField label="Instagram" value={profile.contact.instagram ?? ""} onChange={(value) => patchContact("instagram", value)} placeholder="@miempresa" maxLength={100} error={instagramError} disabled={readOnly} autoCapitalize="none" />
            <TextField label="Web" value={profile.contact.website ?? ""} onChange={(value) => patchContact("website", value)} placeholder="https://miempresa.com.py" maxLength={200} error={websiteError} disabled={readOnly} autoCapitalize="none" inputMode="url" />
          </div>
        </AdminPanel>

        <AdminPanel title="Ubicación" icon="building" meta="El botón «Cómo llegar» abre tu link de Maps">
          <div className="admin-settings-grid">
            <TextField label="Dirección" value={profile.location.address ?? ""} onChange={(value) => patchLocation("address", value)} maxLength={200} disabled={readOnly} wide />
            <CityField label="Ciudad" value={profile.location.city ?? ""} onChange={(value) => patchLocation("city", value)} onSelect={(city) => patchLocation("city", city)} disabled={readOnly} />
            <TextField label="Barrio" value={profile.location.neighborhood ?? ""} onChange={(value) => patchLocation("neighborhood", value)} maxLength={80} disabled={readOnly} />
            <TextField
              label="Link de Google Maps"
              value={profile.location.mapsUrl ?? ""}
              onChange={(value) => patchLocation("mapsUrl", value)}
              maxLength={500}
              placeholder="https://maps.app.goo.gl/…"
              error={mapsError}
              hint="Desde Google Maps: Compartir → Copiar enlace. Acepta google.com/maps y maps.app.goo.gl."
              disabled={readOnly}
              autoCapitalize="none"
              inputMode="url"
              wide
            />
          </div>
        </AdminPanel>

        <AdminPanel title="Horario de atención" icon="clock" meta="Por día; con varias franjas o cerrado">
          <div className="admin-hours admin-hours--week" data-testid="horario-atencion">
            {WEEK_DAYS.map((day) => (
              <div className="admin-hours-day" key={day}>
                <div className="admin-hours-head">
                  <strong>{WEEK_DAY_LABEL[day]}</strong>
                  <SwitchField
                    ariaLabel={`${WEEK_DAY_LABEL[day]}: cerrado`}
                    checked={hours[day].closed}
                    onChange={(checked) => setHours((current) => ({ ...current, [day]: { ...current[day], closed: checked } }))}
                    stateLabels={{ checked: "Cerrado", unchecked: "Abierto" }}
                    disabled={readOnly}
                  />
                </div>
                {hours[day].closed ? null : (
                  <RangesEditor
                    label={WEEK_DAY_LABEL[day]}
                    ranges={hours[day].ranges}
                    onChange={(ranges) => setHours((current) => ({ ...current, [day]: { ...current[day], ranges } }))}
                    disabled={readOnly}
                    error={dayErrors[day]}
                  />
                )}
              </div>
            ))}
            <AdminButton
              type="button"
              icon="copy"
              disabled={readOnly}
              onClick={() =>
                setHours((current) => ({
                  ...current,
                  ...Object.fromEntries((["mar", "mie", "jue", "vie"] as const).map((day) => [day, { closed: current.lun.closed, ranges: current.lun.ranges.map((range) => ({ ...range })) }])),
                }))
              }
            >
              Copiar el lunes a martes–viernes
            </AdminButton>
          </div>
        </AdminPanel>

        <AdminPanel title="Entrega, retiro y devolución" icon="calendar" meta="Franjas por defecto; se coordinan al confirmar">
          <div className="admin-hours admin-hours--handover">
            {HANDOVER_KINDS.map((kind) => (
              <div className="admin-hours-day" key={kind}>
                <div className="admin-hours-head"><strong>{HANDOVER_LABEL[kind]}</strong></div>
                <RangesEditor label={HANDOVER_LABEL[kind]} ranges={handover[kind]} onChange={(ranges) => setHandover((current) => ({ ...current, [kind]: ranges }))} disabled={readOnly} error={handoverErrors[kind]} />
              </div>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel title="Medios de pago aceptados" icon="wallet" meta="Cada uno, sí o no. Los datos de la cuenta están en Presupuestos → Datos de pago">
          <div className="admin-settings-grid">
            {PAYMENT_METHOD_KEYS.map((key) => (
              <SwitchField
                key={key}
                label={PAYMENT_METHOD_LABEL[key]}
                checked={profile.paymentMethods[key]}
                onChange={(checked) => setProfile((current) => ({ ...current, paymentMethods: { ...current.paymentMethods, [key]: checked } }))}
                disabled={readOnly}
              />
            ))}
            {profile.paymentMethods.other ? (
              <TextField label="¿Cuáles otros?" value={profile.paymentMethodsOther ?? ""} onChange={(value) => setProfile((current) => ({ ...current, paymentMethodsOther: value || null }))} maxLength={80} placeholder="Ej.: cheque, billetera" disabled={readOnly} />
            ) : null}
          </div>
        </AdminPanel>

        <AdminPanel title="Condiciones comerciales" icon="receipt" meta="Texto corto: seña, saldo antes de la entrega, roturas">
          <TextAreaField
            label="Condiciones"
            value={profile.conditions ?? ""}
            onChange={(value) => setProfile((current) => ({ ...current, conditions: value || null }))}
            maxLength={CONDITIONS_MAX}
            rows={5}
            counter
            placeholder="Ej.: Seña del 50 % para reservar. El saldo se abona antes de la entrega. Las roturas o faltantes se cobran a valor de reposición."
            disabled={readOnly}
          />
        </AdminPanel>

        <div className="admin-settings-actions">
          <AdminButton type="submit" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={readOnly || !dirty || localProblem}>
            Guardar perfil
          </AdminButton>
        </div>
      </form>
    </AdminDataState>
  );
}
