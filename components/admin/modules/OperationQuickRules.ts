import { contactPhoneValid } from "@/lib/admin-format";
import { emailValid, FIELD_MESSAGES } from "@/lib/field-rules";

export function locationLinkValid(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export const EMPTY_EVENT_QUICK = {
  name: "", location: "", city: "", department: "", address: "", addressReference: "", locationUrl: "",
  venueContactName: "", venueContactPhone: "", venueContactEmail: "",
  responsibleName: "", responsiblePhone: "", responsibleEmail: "", modality: "", attendees: "",
  startsAt: "", endsAt: "",
};
export type EventQuickValues = typeof EMPTY_EVENT_QUICK;

export function eventQuickError(values: EventQuickValues): string {
  if (!values.name.trim()) return "Ingresá el nombre del evento.";
  if (values.name.length > 200) return "El nombre del evento admite hasta 200 caracteres.";
  if (values.location.length > 200) return "El lugar admite hasta 200 caracteres.";
  if (values.startsAt && values.endsAt && new Date(values.endsAt) < new Date(values.startsAt)) return "El fin no puede ser anterior al inicio.";
  if ([values.startsAt, values.endsAt].some((value) => value && !Number.isFinite(new Date(value).getTime()))) return "Ingresá una fecha y hora válidas.";
  if ([values.venueContactPhone, values.responsiblePhone].some((phone) => phone && !contactPhoneValid(phone))) return FIELD_MESSAGES.phone;
  if ([values.venueContactEmail, values.responsibleEmail].some((email) => email && !emailValid(email))) return FIELD_MESSAGES.email;
  if (values.locationUrl && !locationLinkValid(values.locationUrl)) return "Usá un enlace de ubicación http o https sin credenciales.";
  if (values.attendees && (!/^\d+$/.test(values.attendees) || Number(values.attendees) > 2147483647)) return "Ingresá una cantidad de asistentes entera válida.";
  return "";
}

export function eventQuickPayload(values: EventQuickValues) {
  const fields = Object.fromEntries(Object.keys(EMPTY_EVENT_QUICK).map((key) => [key, values[key as keyof EventQuickValues].trim() || null])) as Record<keyof EventQuickValues, string | null>;
  return {
    ...fields,
    name: values.name.trim(),
    startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
    endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
    attendees: values.attendees === "" ? null : Number(values.attendees),
  };
}
