import {
  catalogCity,
  FIELD_MESSAGES,
  PROFILE_MESSAGES,
  emailValid,
  normalizeEmail,
  normalizeGoogleMapsUrl,
  normalizePhone,
  parseTimeRanges,
  phoneValid,
  type TimeRange,
} from "./field-rules";

/**
 * Perfil público de la empresa (`Organization.profile`): contacto, ubicación con link de
 * Google Maps, horario de atención, horarios por defecto de entrega/retiro/devolución,
 * medios de pago aceptados y condiciones comerciales. Reglas puras (sin base ni red),
 * compartidas por el API del panel, la tienda, el portal, la hoja impresa y los correos.
 *
 * Todo es opcional: lo que la empresa no cargó no se muestra ni se inventa.
 */

export const WEEK_DAYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export const WEEK_DAY_LABEL: Record<WeekDay, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

export type DayHours = { closed: boolean; ranges: TimeRange[] };
export type WeekHours = Record<WeekDay, DayHours>;

export const HANDOVER_KINDS = ["delivery", "pickup", "return"] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];
export const HANDOVER_LABEL: Record<HandoverKind, string> = {
  delivery: "Entrega",
  pickup: "Retiro",
  return: "Devolución",
};

export const PAYMENT_METHOD_KEYS = ["transfer", "deposit", "pos", "cash", "other"] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethodKey, string> = {
  transfer: "Transferencia",
  deposit: "Depósito",
  pos: "POS (tarjeta)",
  cash: "Efectivo",
  other: "Otros",
};

export const CONDITIONS_MAX = 600;

export type OrgProfile = {
  contact: {
    phone: string | null;
    phone2: string | null;
    whatsapp: string | null;
    instagram: string | null;
    email: string | null;
    website: string | null;
  };
  location: { address: string | null; city: string | null; neighborhood: string | null; mapsUrl: string | null };
  hours: WeekHours;
  handover: Record<HandoverKind, TimeRange[]>;
  paymentMethods: Record<PaymentMethodKey, boolean>;
  paymentMethodsOther: string | null;
  conditions: string | null;
};

const emptyDay = (): DayHours => ({ closed: false, ranges: [] });

export function emptyProfile(): OrgProfile {
  return {
    contact: { phone: null, phone2: null, whatsapp: null, instagram: null, email: null, website: null },
    location: { address: null, city: null, neighborhood: null, mapsUrl: null },
    hours: Object.fromEntries(WEEK_DAYS.map((day) => [day, emptyDay()])) as WeekHours,
    handover: { delivery: [], pickup: [], return: [] },
    paymentMethods: { transfer: false, deposit: false, pos: false, cash: false, other: false },
    paymentMethodsOther: null,
    conditions: null,
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function text(value: unknown, label: string, max: number): Result<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${label} tiene que ser texto.` };
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > max) return { ok: false, error: `${label} no puede superar los ${max} caracteres.` };
  return { ok: true, value: trimmed || null };
}

function phone(value: unknown, label: string): Result<string | null> {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return { ok: true, value: null };
  if (typeof value !== "string" || !phoneValid(value)) return { ok: false, error: `${label}: ${FIELD_MESSAGES.phone}` };
  return { ok: true, value: normalizePhone(value) };
}

/** `@usuario` o link de instagram.com → `usuario`; solo letras, números, punto y guion bajo (hasta 30). */
export function normalizeInstagram(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let handle = value.trim();
  const link = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i.exec(handle);
  if (link) handle = link[1];
  handle = handle.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

/** Sitio web: solo http(s) sin usuario/clave. Sin esquema se asume https. */
export function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 200 || /\s/.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Valida y normaliza el perfil que manda el panel. Los campos ausentes quedan vacíos (el
 * panel siempre manda el perfil completo). Devuelve el primer error, en castellano.
 */
export function parseOrgProfile(body: unknown): Result<OrgProfile> {
  const input = record(body);
  const profile = emptyProfile();

  const contact = record(input.contact);
  for (const [key, label] of [["phone", "El teléfono principal"], ["phone2", "El teléfono secundario"], ["whatsapp", "El WhatsApp"]] as const) {
    const result = phone(contact[key], label);
    if (!result.ok) return result;
    profile.contact[key] = result.value;
  }
  const instagramRaw = contact.instagram;
  if (typeof instagramRaw === "string" && instagramRaw.trim()) {
    const handle = normalizeInstagram(instagramRaw);
    if (!handle) return { ok: false, error: "El Instagram tiene que ser un usuario (@empresa) o el link de tu perfil." };
    profile.contact.instagram = handle;
  }
  const emailRaw = contact.email;
  if (typeof emailRaw === "string" && emailRaw.trim()) {
    if (!emailValid(emailRaw)) return { ok: false, error: FIELD_MESSAGES.email };
    profile.contact.email = normalizeEmail(emailRaw);
  }
  const websiteRaw = contact.website;
  if (typeof websiteRaw === "string" && websiteRaw.trim()) {
    const site = normalizeWebsite(websiteRaw);
    if (!site) return { ok: false, error: "La web tiene que ser una dirección válida, por ejemplo https://miempresa.com.py." };
    profile.contact.website = site;
  }

  const location = record(input.location);
  for (const [key, label, max] of [["address", "La dirección", 200], ["city", "La ciudad", 80], ["neighborhood", "El barrio", 80]] as const) {
    const result = text(location[key], label, max);
    if (!result.ok) return result;
    profile.location[key] = result.value;
  }
  const mapsRaw = location.mapsUrl;
  if (typeof mapsRaw === "string" && mapsRaw.trim()) {
    const maps = normalizeGoogleMapsUrl(mapsRaw);
    if (!maps) return { ok: false, error: PROFILE_MESSAGES.mapsUrl };
    profile.location.mapsUrl = maps;
  } else if (mapsRaw !== undefined && mapsRaw !== null && typeof mapsRaw !== "string") {
    return { ok: false, error: PROFILE_MESSAGES.mapsUrl };
  }

  const hours = record(input.hours);
  for (const day of WEEK_DAYS) {
    const entry = record(hours[day]);
    const closed = entry.closed === true;
    const ranges = parseTimeRanges(closed ? [] : entry.ranges);
    if (!ranges.ok) return { ok: false, error: `${WEEK_DAY_LABEL[day]}: ${ranges.error}` };
    profile.hours[day] = { closed, ranges: ranges.ranges };
  }

  const handover = record(input.handover);
  for (const kind of HANDOVER_KINDS) {
    const ranges = parseTimeRanges(handover[kind]);
    if (!ranges.ok) return { ok: false, error: `${HANDOVER_LABEL[kind]}: ${ranges.error}` };
    profile.handover[kind] = ranges.ranges;
  }

  const methods = record(input.paymentMethods);
  for (const key of PAYMENT_METHOD_KEYS) {
    if (methods[key] !== undefined && typeof methods[key] !== "boolean") return { ok: false, error: `${PAYMENT_METHOD_LABEL[key]}: elegí sí o no.` };
    profile.paymentMethods[key] = methods[key] === true;
  }
  const other = text(input.paymentMethodsOther, "El detalle de «Otros» medios de pago", 80);
  if (!other.ok) return other;
  profile.paymentMethodsOther = profile.paymentMethods.other ? other.value : null;

  if (input.conditions !== undefined && input.conditions !== null && typeof input.conditions !== "string") {
    return { ok: false, error: "Las condiciones comerciales tienen que ser texto." };
  }
  const conditions = typeof input.conditions === "string" ? input.conditions.trim() : "";
  if (conditions.length > CONDITIONS_MAX) return { ok: false, error: `Las condiciones comerciales no pueden superar los ${CONDITIONS_MAX} caracteres.` };
  profile.conditions = conditions || null;
  return { ok: true, value: profile };
}

/** Escritura del panel: sólo una ciudad nueva debe pertenecer al catálogo; leer historia sigue tolerante. */
export function parseOrgProfileUpdate(body: unknown, existingCity?: string | null): Result<OrgProfile> {
  const parsed = parseOrgProfile(body);
  if (!parsed.ok) return parsed;
  const city = parsed.value.location.city;
  if (city && city !== existingCity) {
    const selected = catalogCity(city);
    if (!selected) return { ok: false, error: "Elegí una ciudad de la lista." };
    parsed.value.location.city = selected.ciudad;
  }
  return parsed;
}

/** Lee lo guardado (JSON de la base) tolerando filas viejas o rotas: nunca lanza. */
export function readOrgProfile(stored: unknown): OrgProfile {
  const parsed = parseOrgProfile(stored);
  return parsed.ok ? parsed.value : emptyProfile();
}

/** ¿La empresa cargó algo del perfil? Sin nada, ninguna superficie dibuja el bloque. */
export function profileHasData(profile: OrgProfile): boolean {
  return (
    Object.values(profile.contact).some(Boolean) ||
    Object.values(profile.location).some(Boolean) ||
    WEEK_DAYS.some((day) => profile.hours[day].closed || profile.hours[day].ranges.length > 0) ||
    HANDOVER_KINDS.some((kind) => profile.handover[kind].length > 0) ||
    PAYMENT_METHOD_KEYS.some((key) => profile.paymentMethods[key]) ||
    Boolean(profile.conditions)
  );
}

export const rangesLabel = (ranges: readonly TimeRange[]): string => ranges.map((range) => `${range.from} a ${range.to}`).join(" · ");

/** Horario agrupado por días contiguos iguales: «Lunes a viernes · 08:00 a 12:00 · 14:00 a 18:00». */
export function hoursSummary(hours: WeekHours): Array<{ days: string; text: string }> {
  const lines: Array<{ days: string; text: string }> = [];
  let index = 0;
  const describe = (day: WeekDay) => (hours[day].closed ? "Cerrado" : hours[day].ranges.length ? rangesLabel(hours[day].ranges) : null);
  while (index < WEEK_DAYS.length) {
    const current = describe(WEEK_DAYS[index]);
    if (current === null) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < WEEK_DAYS.length && describe(WEEK_DAYS[end + 1]) === current) end += 1;
    const first = WEEK_DAY_LABEL[WEEK_DAYS[index]];
    const last = WEEK_DAY_LABEL[WEEK_DAYS[end]];
    lines.push({ days: end === index ? first : end === index + 1 ? `${first} y ${last.toLowerCase()}` : `${first} a ${last.toLowerCase()}`, text: current });
    index = end + 1;
  }
  return lines;
}

export const acceptedPaymentMethods = (profile: OrgProfile): string[] =>
  PAYMENT_METHOD_KEYS.filter((key) => profile.paymentMethods[key]).map((key) =>
    key === "other" && profile.paymentMethodsOther ? profile.paymentMethodsOther : PAYMENT_METHOD_LABEL[key],
  );

/** Línea de ubicación legible: «Av. España 1234, Villa Morra, Asunción». */
export const locationLine = (profile: OrgProfile): string | null =>
  [profile.location.address, profile.location.neighborhood, profile.location.city].filter(Boolean).join(", ") || null;

/** Subconjunto del perfil que viaja a las superficies del cliente (sin nada interno). */
export type PublicProfile = OrgProfile;

/** Tipo de cuenta y moneda de los datos de pago (`Organization.paymentDetails`). */
export const ACCOUNT_TYPE_LABEL: Record<string, string> = { CORRIENTE: "Cuenta corriente", AHORRO: "Caja de ahorro" };
export const ACCOUNT_CURRENCY_LABEL: Record<string, string> = { PYG: "Guaraníes (PYG)", USD: "Dólares (USD)", BRL: "Reales (BRL)", EUR: "Euros (EUR)" };
export const accountTypeLabel = (value: string | null | undefined): string | null => (value ? ACCOUNT_TYPE_LABEL[value] ?? null : null);
export const accountCurrencyLabel = (value: string | null | undefined): string | null => (value ? ACCOUNT_CURRENCY_LABEL[value] ?? null : null);
