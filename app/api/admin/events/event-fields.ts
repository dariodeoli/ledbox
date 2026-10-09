import type { EventStatus } from "@prisma/client";
import { normalizeContactPhone, normalizeWebsite, websiteValid } from "@/lib/admin-format";
import { emailValid, normalizeEmail } from "@/lib/field-rules";

export type EventFieldPatch = {
  name?: string;
  location?: string | null;
  city?: string | null;
  department?: string | null;
  address?: string | null;
  addressReference?: string | null;
  locationUrl?: string | null;
  venueContactName?: string | null;
  venueContactPhone?: string | null;
  venueContactEmail?: string | null;
  responsibleName?: string | null;
  responsiblePhone?: string | null;
  responsibleEmail?: string | null;
  modality?: string | null;
  attendees?: number | null;
  notes?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  setupAt?: Date | null;
  strikeAt?: Date | null;
  status?: EventStatus;
};

/** Alta y edición parcial: ausente conserva, null/vacío limpia opcionales. */
export function parseEventFields(body: unknown): { ok: true; data: EventFieldPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Datos del evento inválidos." };
  const record = body as Record<string, unknown>;
  const data: EventFieldPatch = {};
  if (record.name !== undefined) {
    if (typeof record.name !== "string" || !record.name.trim() || record.name.trim().length > 200) return { ok: false, error: "Ingresá el nombre del evento (hasta 200 caracteres)." };
    data.name = record.name.trim().replace(/\s+/g, " ");
  }
  const texts = { location: 200, city: 120, department: 120, address: 300, addressReference: 400, venueContactName: 120, responsibleName: 120, modality: 120, notes: 2000 } as const;
  for (const field of Object.keys(texts) as Array<keyof typeof texts>) {
    const value = record[field];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || value.trim().length > texts[field])) return { ok: false, error: `El campo ${field} debe ser texto de hasta ${texts[field]} caracteres.` };
    data[field] = typeof value === "string" ? value.trim() || null : null;
  }
  for (const field of ["venueContactEmail", "responsibleEmail"] as const) {
    const value = record[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") return { ok: false, error: "Correo inválido." };
    const email = normalizeEmail(typeof value === "string" ? value : "");
    if (email && (email.length > 254 || !emailValid(email))) return { ok: false, error: "Correo inválido." };
    data[field] = email || null;
  }
  for (const field of ["venueContactPhone", "responsiblePhone"] as const) {
    const value = record[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") return { ok: false, error: "Teléfono inválido." };
    const phone = typeof value === "string" && value.trim() ? normalizeContactPhone(value) : null;
    if (typeof value === "string" && value.trim() && !phone) return { ok: false, error: "Teléfono inválido." };
    data[field] = phone || null;
  }
  if (record.locationUrl !== undefined) {
    const value = record.locationUrl;
    if (value !== null && typeof value !== "string") return { ok: false, error: "Enlace de ubicación inválido." };
    const url = normalizeWebsite(typeof value === "string" ? value : "");
    if (url && (!websiteValid(url) || url.length > 2000 || new URL(url).username || new URL(url).password)) return { ok: false, error: "Enlace de ubicación HTTP o HTTPS inválido." };
    data.locationUrl = url || null;
  }
  if (record.attendees !== undefined) {
    const value = record.attendees;
    if (value !== null && (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0 || value > 2147483647)) return { ok: false, error: "La cantidad de asistentes debe ser un entero no negativo." };
    data.attendees = value as number | null;
  }
  for (const field of ["startsAt", "endsAt", "setupAt", "strikeAt"] as const) {
    const value = record[field];
    if (value === undefined) continue;
    if (value === null || value === "") { data[field] = null; continue; }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return { ok: false, error: "Fecha y hora inválidas." };
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || (value[16] === ":" && Number(value.slice(17, 19)) > 59)) return { ok: false, error: "Fecha y hora inválidas." };
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return { ok: false, error: "Fecha y hora inválidas." };
    data[field] = date;
  }
  if (record.status !== undefined) {
    if (typeof record.status !== "string" || !["DRAFT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(record.status.toUpperCase())) return { ok: false, error: "Estado del evento inválido." };
    data.status = record.status.toUpperCase() as EventStatus;
  }
  return { ok: true, data };
}

/** Se valida contra el estado combinado, también cuando PATCH cambia una sola fecha. */
export function eventDateViolation(data: Pick<EventFieldPatch, "startsAt" | "endsAt" | "setupAt" | "strikeAt">): string | null {
  if (data.startsAt && data.endsAt && data.endsAt < data.startsAt) return "El fin del evento no puede ser anterior al inicio.";
  if (data.setupAt && data.startsAt && data.setupAt > data.startsAt) return "El montaje no puede ser posterior al inicio.";
  if (data.strikeAt && data.endsAt && data.strikeAt < data.endsAt) return "El desmontaje no puede ser anterior al fin.";
  return null;
}
