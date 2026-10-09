import type { ClientType } from "@prisma/client";
import type { AdminClientContact } from "@/lib/admin-types";
import {
  CLIENT_LINK_MESSAGES,
  CLIENT_WEBSITE_MAX_LENGTH,
  instagramValid,
  normalizeContactPhone,
  normalizeInstagram,
  normalizeWebsite,
  websiteValid,
} from "@/lib/admin-format";
import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
  emailValid,
  normalizeEmail,
  normalizePersonName,
  personNameValid,
  rucDocument,
} from "@/lib/field-rules";

/**
 * Campos editables del cliente (issue #36): la fuente única que comparten el
 * alta (`POST /api/admin/clients`) y la edición (`PATCH /api/admin/clients/[id]`).
 *
 * El API revalida siempre: teléfonos y correos se normalizan con las reglas del
 * kit, el sitio web queda con esquema (`https://…`) y el Instagram como usuario
 * sin `@`. `undefined` significa «no tocar el campo»; vacío o `null` lo limpia.
 */

export type ClientFieldPatch = {
  name?: string;
  company?: string | null;
  tradeName?: string | null;
  legalName?: string | null;
  billingEmail?: string | null;
  city?: string | null;
  department?: string | null;
  address?: string | null;
  addressReference?: string | null;
  locationUrl?: string | null;
  contacts?: AdminClientContact[];
  type?: ClientType;
  ruc?: string | null;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  instagram?: string | null;
  whatsapp?: string | null;
  notes?: string | null;
};

export type ClientFieldsResult = { ok: true; data: ClientFieldPatch } | { ok: false; error: string };

/** Texto opcional: `undefined` no toca el campo, vacío o `null` lo limpia. */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** Correo opcional normalizado; `false` cuando el valor no es un correo real. */
function optionalEmail(value: unknown): string | null | undefined | false {
  if (typeof value === "string" && value.trim().length > FIELD_LIMITS.email) return false;
  const email = optionalText(value);
  if (email === undefined || email === null) return email;
  const normalized = normalizeEmail(email);
  return emailValid(normalized) ? normalized : false;
}

/** Teléfono opcional normalizado (`+<código> <dígitos>`); `false` si es inválido. */
function optionalPhone(value: unknown): string | null | undefined | false {
  if (typeof value === "string" && value.trim().length > 30) return false;
  const phone = optionalText(value);
  if (phone === undefined || phone === null) return phone;
  return normalizeContactPhone(phone) || false;
}

/** Campos del cliente listos para Prisma (solo los presentes en el cuerpo). */
export function parseClientFields(body: unknown): ClientFieldsResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Datos del cliente inválidos." };
  const record = body as Record<string, unknown>;
  const data: ClientFieldPatch = {};

  // Validar antes de normalizar: un tipo erróneo nunca expresa borrar/ignorar.
  // Los límites se rechazan, no se recortan (incluidos los campos históricos).
  const textLimits = {
    name: 200, company: FIELD_LIMITS.company, ruc: 30, notes: FIELD_LIMITS.notes,
    contactName: FIELD_LIMITS.name, contactRole: FIELD_LIMITS.name,
    email: FIELD_LIMITS.email, contactEmail: FIELD_LIMITS.email, billingEmail: FIELD_LIMITS.email,
    phone: 30, contactPhone: 30, whatsapp: 30,
    website: CLIENT_WEBSITE_MAX_LENGTH, instagram: 200,
  } as const;
  for (const field of Object.keys(textLimits) as Array<keyof typeof textLimits>) {
    const value = record[field];
    if (value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > textLimits[field])) {
      return { ok: false, error: `El campo ${field} debe ser texto de hasta ${textLimits[field]} caracteres.` };
    }
  }

  // Nuevos campos no se truncan ni convierten desde la identidad histórica.
  const texts = { tradeName: 200, legalName: 300, city: 120, department: 120, address: 300, addressReference: 400 } as const;
  for (const field of Object.keys(texts) as Array<keyof typeof texts>) {
    const value = record[field];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || value.trim().length > texts[field])) {
      return { ok: false, error: `El campo ${field} debe ser texto de hasta ${texts[field]} caracteres.` };
    }
    data[field] = typeof value === "string" ? (field === "tradeName" ? value.trim().replace(/\s+/g, " ") : value.trim()) || null : null;
  }
  if (record.locationUrl !== undefined) {
    const value = record.locationUrl;
    if (value !== null && typeof value !== "string") return { ok: false, error: "Enlace de ubicación inválido." };
    const url = normalizeWebsite(typeof value === "string" ? value : "");
    if (url && (!websiteValid(url) || url.length > 2000 || new URL(url).username || new URL(url).password)) {
      return { ok: false, error: "Ingresá un enlace de ubicación HTTP o HTTPS válido, sin credenciales." };
    }
    data.locationUrl = url || null;
  }
  if (record.contacts !== undefined) {
    if (!Array.isArray(record.contacts) || record.contacts.length > 20) return { ok: false, error: "Ingresá hasta 20 contactos por función." };
    const contacts: AdminClientContact[] = [];
    for (const item of record.contacts) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Contacto inválido." };
      const contact = item as Record<string, unknown>;
      if (typeof contact.name !== "string" || contact.name.trim().length > 120) return { ok: false, error: FIELD_MESSAGES.name };
      const name = normalizePersonName(typeof contact.name === "string" ? contact.name : "");
      if (!personNameValid(name)) return { ok: false, error: FIELD_MESSAGES.name };
      if (contact.role != null && (typeof contact.role !== "string" || contact.role.trim().length > 120)) return { ok: false, error: "Función del contacto inválida." };
      if (contact.phone != null && typeof contact.phone !== "string") return { ok: false, error: FIELD_MESSAGES.phone };
      if (contact.email != null && typeof contact.email !== "string") return { ok: false, error: FIELD_MESSAGES.email };
      const phone = optionalPhone(contact.phone) ?? null;
      const email = optionalEmail(contact.email) ?? null;
      if (phone === false) return { ok: false, error: FIELD_MESSAGES.phone };
      if (email === false) return { ok: false, error: FIELD_MESSAGES.email };
      contacts.push({ name, role: optionalText(contact.role) ?? null, phone, email });
    }
    data.contacts = contacts;
  }

  if (record.name !== undefined) {
    const name = typeof record.name === "string" ? record.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 200) return { ok: false, error: "Ingresá el nombre comercial del cliente (hasta 200 caracteres)." };
    data.name = name;
  }

  if (record.company !== undefined) data.company = optionalText(record.company) ?? null;
  // RUC: si el texto trae el patrón paraguayo se guarda limpio (`80012345-6`);
  // si no, se conserva tal cual (C.I. u otro documento). Soft: no rechaza.
  if (record.ruc !== undefined) data.ruc = rucDocument(record.ruc);
  if (record.notes !== undefined) data.notes = optionalText(record.notes) ?? null;
  if (record.contactRole !== undefined) data.contactRole = optionalText(record.contactRole) ?? null;

  if (record.type !== undefined) {
    if (record.type !== "FINAL" && record.type !== "RESELLER") return { ok: false, error: "Tipo de cliente inválido." };
    data.type = record.type;
  }

  if (record.contactName !== undefined) {
    const contactName = normalizePersonName(typeof record.contactName === "string" ? record.contactName : "");
    if (contactName && !personNameValid(contactName)) return { ok: false, error: FIELD_MESSAGES.name };
    data.contactName = contactName || null;
  }

  const emails = { email: record.email, contactEmail: record.contactEmail, billingEmail: record.billingEmail } as const;
  for (const field of ["email", "contactEmail", "billingEmail"] as const) {
    const value = emails[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") return { ok: false, error: FIELD_MESSAGES.email };
    const email = optionalEmail(value);
    if (email === false) return { ok: false, error: FIELD_MESSAGES.email };
    if (email !== undefined) data[field] = email;
  }

  const phoneValues = { phone: record.phone, contactPhone: record.contactPhone, whatsapp: record.whatsapp } as const;
  for (const field of ["phone", "contactPhone", "whatsapp"] as const) {
    const value = phoneValues[field];
    if (value === undefined) continue;
    const phone = optionalPhone(value);
    if (phone === false) return { ok: false, error: FIELD_MESSAGES.phone };
    if (phone !== undefined) data[field] = phone;
  }

  if (record.website !== undefined) {
    const website = normalizeWebsite(typeof record.website === "string" ? record.website : "");
    if (website && (!websiteValid(website) || website.length > CLIENT_WEBSITE_MAX_LENGTH)) {
      return { ok: false, error: CLIENT_LINK_MESSAGES.website };
    }
    data.website = website || null;
  }

  if (record.instagram !== undefined) {
    const instagram = normalizeInstagram(typeof record.instagram === "string" ? record.instagram : "");
    if (instagram && !instagramValid(instagram)) return { ok: false, error: CLIENT_LINK_MESSAGES.instagram };
    data.instagram = instagram || null;
  }

  return { ok: true, data };
}
