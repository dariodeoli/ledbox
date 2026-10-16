"use client";

import { useRef, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { canWriteOperations } from "@/lib/admin-policy";
import { useAdminSession } from "../AdminShell";
import { VENUE_FIELDS, eventVenueSnapshot, venueDefaultsEqual, venueKey, type SavedEventVenue } from "@/lib/event-venues";
import { AdminButton, AdminConfirmDialog, AdminDialogSection, AdminDisclosure, AdminNote } from "../AdminUI";
import { CityField, Combobox, DateTimeField, EmailField, NumberField, PhoneField, TextField } from "../AdminFields";
import { contactPhoneValid } from "@/lib/admin-format";
import { emailValid, FIELD_MESSAGES } from "@/lib/field-rules";
import { locationLinkValid, type EventQuickValues } from "./OperationQuickRules";
export { EMPTY_EVENT_QUICK, eventQuickError, eventQuickPayload } from "./OperationQuickRules";

/** Un alta de evento para Operación y Presupuestos; los datos operativos son opcionales. */
export function EventQuickFields({ values, onChange, autoFocus, moreOpen = false, locationOptions = [], layout = "quick", children }: {
  values: EventQuickValues;
  onChange: (patch: Partial<EventQuickValues>) => void;
  autoFocus?: boolean;
  moreOpen?: boolean;
  locationOptions?: string[];
  /** `sections`: el diálogo de Eventos (Evento, Lugar y «Más opciones»); `quick`: el alta de Presupuestos. */
  layout?: "quick" | "sections";
  children?: React.ReactNode;
}) {
  const { role } = useAdminSession();
  const [venueBusy, setVenueBusy] = useState(false);
  const venueInFlight = useRef(false);
  const [venueError, setVenueError] = useState("");
  const [venueNotice, setVenueNotice] = useState("");
  const [confirmVenue, setConfirmVenue] = useState(false);
  const [venueNeedsReselect, setVenueNeedsReselect] = useState(false);
  const venueResource = useAdminResource<SavedEventVenue[]>("/api/admin/venues", (payload) => payload.venues ?? []);
  const remembered = venueResource.data ?? [];
  const venueNames = [...new Set([...remembered.flatMap((row) => row.location ? [row.location] : []), ...locationOptions])];
  const savedVenue = remembered.find(row => venueKey(row.location ?? "") === venueKey(values.location));
  const chooseVenue = (location: string) => {
    const saved = remembered.find((row) => venueKey(row.location ?? "") === venueKey(location));
    setVenueError(""); setVenueNotice(""); setVenueNeedsReselect(false);
    onChange(saved ? Object.fromEntries(VENUE_FIELDS.map((key) => [key, saved[key] ?? ""])) : { location });
  };
  async function saveVenueDefaults() {
    if (venueInFlight.current) return;
    venueInFlight.current = true; setVenueBusy(true); setVenueError(""); setVenueNotice("");
    try {
      const result = await adminSend<{ venue: SavedEventVenue }>("/api/admin/venues", {
        ...eventVenueSnapshot(values), ...(savedVenue ? { id: savedVenue.id, expectedRevision: savedVenue.revision } : {}),
      });
      if (!result.ok) {
        setVenueError(result.error);
        if (result.code === "venue_revision_conflict" || result.code === "venue_duplicate") {
          setVenueNeedsReselect(true); setConfirmVenue(false); venueResource.reload();
        }
        return;
      }
      setConfirmVenue(false);
      setVenueNotice("Recinto guardado en la libreta. Estos son sus datos predeterminados; los eventos ya guardados no cambian.");
      venueResource.reload();
    } finally { venueInFlight.current = false; setVenueBusy(false); }
  }
  const venueActions = <>
    {savedVenue?.needsReview ? <AdminNote tone="warn">La libreta recuperó una ficha anterior para conservar su contacto. Revisá los datos antes de usarlos o actualizarlos.</AdminNote> : null}
    {venueResource.error ? <AdminNote tone="error">{venueResource.error} <AdminButton type="button" onClick={venueResource.reload}>Volver a cargar libreta</AdminButton></AdminNote> : null}
    {venueError && !confirmVenue ? <AdminNote tone="error">{venueError}</AdminNote> : null}
    {venueNotice ? <AdminNote tone="ok">{venueNotice}</AdminNote> : null}
    {canWriteOperations(role) ? <AdminButton type="button" icon="check" busy={venueBusy} disabled={venueResource.loading || Boolean(venueResource.error) || Boolean(venueNeedsReselect && savedVenue) || !values.location.trim() || Boolean(savedVenue && !savedVenue.needsReview && venueDefaultsEqual(savedVenue, values))}
      onClick={() => savedVenue ? setConfirmVenue(true) : void saveVenueDefaults()}>{savedVenue ? "Actualizar datos predeterminados del recinto" : "Guardar recinto en la libreta"}</AdminButton> : null}
    {confirmVenue ? <AdminConfirmDialog title="Actualizar recinto guardado" message="Los datos de lugar y contacto de este formulario serán los predeterminados al elegir el recinto. Los eventos ya guardados conservan su información. Guardar sólo el evento no modifica la libreta."
      confirmLabel="Actualizar datos predeterminados" busy={venueBusy} error={venueError} onConfirm={() => void saveVenueDefaults()} onClose={() => setConfirmVenue(false)} /> : null}
  </>;
  const name = <TextField label="Nombre del evento" required autoFocus={autoFocus} maxLength={200}
      value={values.name} onChange={(name) => onChange({ name })} placeholder="Ej.: Lanzamiento Samsung" />;
  const starts = <DateTimeField label="Inicio" shortcuts hint="Opcional · fecha y hora del evento" value={values.startsAt} onChange={(startsAt) => onChange({ startsAt })} />;
  const ends = <DateTimeField label="Fin" shortcuts value={values.endsAt} onChange={(endsAt) => onChange({ endsAt })} />;
  const venue = <Combobox label="Lugar / recinto" value={values.location} allowCustomValue onChange={(location) => {
          // El texto nuevo se guarda de inmediato; seleccionar una sugerencia aplica su ficha.
          onChange({ location }); setVenueError(""); setVenueNotice("");
        }}
        options={venueNames.map((location) => ({ value: location, label: location }))}
        onSelectOption={chooseVenue}
        onCreate={(location) => onChange({ location })} createLabel={(query) => `Usar lugar «${query}»`}
        placeholder="Buscá un recinto o escribí uno…" hint="Elegir uno guardado copia sus datos al evento. Escribir un lugar o guardar el evento no cambia la libreta." />;
  const place = <>
      <CityField catalogOnly label="Ciudad" value={values.city} onChange={(city) => onChange({ city, department: "" })}
        onSelect={(city, department) => onChange({ city, department })} placeholder="Ej.: Asunción" />
      <TextField label="Departamento" maxLength={120} value={values.department} onChange={(department) => onChange({ department })} hint="Opcional · también podés completarlo a mano." />
      <TextField label="Dirección del evento" maxLength={300} value={values.address} onChange={(address) => onChange({ address })} />
      <TextField label="Referencia de dirección" maxLength={400} value={values.addressReference} onChange={(addressReference) => onChange({ addressReference })} />
      <TextField label="Enlace de ubicación" maxLength={2000} inputMode="url" value={values.locationUrl} onChange={(locationUrl) => onChange({ locationUrl })}
        error={values.locationUrl && !locationLinkValid(values.locationUrl) ? "Usá un enlace http o https sin credenciales." : null} placeholder="https://…" />
    </>;
  const contacts = <>
      <TextField label="Contacto del lugar" maxLength={120} value={values.venueContactName} onChange={(venueContactName) => onChange({ venueContactName })} />
      <PhoneField label="Teléfono del lugar" value={values.venueContactPhone} onChange={(venueContactPhone) => onChange({ venueContactPhone })}
        error={values.venueContactPhone && !contactPhoneValid(values.venueContactPhone) ? FIELD_MESSAGES.phone : null} />
      <EmailField label="Correo del lugar" value={values.venueContactEmail} onChange={(venueContactEmail) => onChange({ venueContactEmail })}
        error={values.venueContactEmail && !emailValid(values.venueContactEmail) ? FIELD_MESSAGES.email : null} />
      <TextField label="Responsable del evento" maxLength={120} value={values.responsibleName} onChange={(responsibleName) => onChange({ responsibleName })} />
      <PhoneField label="Teléfono del responsable" value={values.responsiblePhone} onChange={(responsiblePhone) => onChange({ responsiblePhone })}
        error={values.responsiblePhone && !contactPhoneValid(values.responsiblePhone) ? FIELD_MESSAGES.phone : null} />
      <EmailField label="Correo del responsable" value={values.responsibleEmail} onChange={(responsibleEmail) => onChange({ responsibleEmail })}
        error={values.responsibleEmail && !emailValid(values.responsibleEmail) ? FIELD_MESSAGES.email : null} />
    </>;
  const modality = <TextField label="Modalidad" maxLength={120} value={values.modality} onChange={(modality) => onChange({ modality })} hint="Opcional · presencial, virtual, híbrida u otra." />;
  const attendees = <NumberField label="Asistentes" value={values.attendees} onChange={(attendees) => onChange({ attendees })} />;

  if (layout === "sections") {
    return <>
      <AdminDialogSection title="Evento">
        {name}
        {children}
        {starts}
        {ends}
      </AdminDialogSection>
      <AdminDialogSection title="Lugar">
        {venue}
        {place}
        {venueActions}
      </AdminDialogSection>
      <AdminDialogSection title="Más opciones" collapsible defaultOpen={moreOpen} hint="contactos, modalidad y asistentes">
        {contacts}
        {modality}
        {attendees}
      </AdminDialogSection>
    </>;
  }

  return <>
    {name}
    {children}
    {starts}
    <AdminDisclosure title="Más datos" hint="recinto, localidad, contactos y fin" defaultOpen={moreOpen}>
      {venue}
      {place}
      {contacts}
      {venueActions}
      {modality}
      {attendees}
      {ends}
    </AdminDisclosure>
  </>;
}
