"use client";

import { AdminDisclosure } from "../AdminUI";
import { CityField, Combobox, DateTimeField, EmailField, NumberField, PhoneField, TextField } from "../AdminFields";
import { contactPhoneValid } from "@/lib/admin-format";
import { emailValid, FIELD_MESSAGES } from "@/lib/field-rules";
import { locationLinkValid, type EventQuickValues } from "./OperationQuickRules";
export { EMPTY_EVENT_QUICK, eventQuickError, eventQuickPayload } from "./OperationQuickRules";

/** Un alta de evento para Operación y Presupuestos; los datos operativos son opcionales. */
export function EventQuickFields({ values, onChange, autoFocus, moreOpen = false, locationOptions = [], children }: {
  values: EventQuickValues;
  onChange: (patch: Partial<EventQuickValues>) => void;
  autoFocus?: boolean;
  moreOpen?: boolean;
  locationOptions?: string[];
  children?: React.ReactNode;
}) {
  return <>
    <TextField label="Nombre del evento" required autoFocus={autoFocus} maxLength={200}
      value={values.name} onChange={(name) => onChange({ name })} placeholder="Ej.: Lanzamiento Samsung" />
    {children}
    <DateTimeField label="Inicio" hint="Opcional · fecha y hora del evento" value={values.startsAt} onChange={(startsAt) => onChange({ startsAt })} />
    <AdminDisclosure title="Más datos" hint="recinto, localidad, contactos y fin" defaultOpen={moreOpen}>
      <Combobox label="Lugar / recinto" value={values.location} onChange={(location) => onChange({ location })}
        options={locationOptions.map((location) => ({ value: location, label: location }))}
        onCreate={(location) => onChange({ location })} createLabel={(query) => `Usar lugar «${query}»`}
        placeholder="Buscá un recinto o escribí uno…" hint="Recintos de tus eventos; una ciudad no reemplaza el lugar." />
      <CityField label="Ciudad" value={values.city} onChange={(city) => onChange({ city, department: "" })}
        onSelect={(city, department) => onChange({ city, department })} placeholder="Ej.: Asunción" />
      <TextField label="Departamento" maxLength={120} value={values.department} onChange={(department) => onChange({ department })} hint="Opcional · también podés completarlo a mano." />
      <TextField label="Dirección del evento" maxLength={300} value={values.address} onChange={(address) => onChange({ address })} />
      <TextField label="Referencia de dirección" maxLength={400} value={values.addressReference} onChange={(addressReference) => onChange({ addressReference })} />
      <TextField label="Enlace de ubicación" maxLength={2000} inputMode="url" value={values.locationUrl} onChange={(locationUrl) => onChange({ locationUrl })}
        error={values.locationUrl && !locationLinkValid(values.locationUrl) ? "Usá un enlace http o https sin credenciales." : null} placeholder="https://…" />
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
      <TextField label="Modalidad" maxLength={120} value={values.modality} onChange={(modality) => onChange({ modality })} hint="Opcional · presencial, virtual, híbrida u otra." />
      <NumberField label="Asistentes" value={values.attendees} onChange={(attendees) => onChange({ attendees })} />
      <DateTimeField label="Fin" value={values.endsAt} onChange={(endsAt) => onChange({ endsAt })} />
    </AdminDisclosure>
  </>;
}
