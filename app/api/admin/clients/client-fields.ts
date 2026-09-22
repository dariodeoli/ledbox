import type { ClientType } from "@prisma/client";
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
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Correo opcional normalizado; `false` cuando el valor no es un correo real. */
function optionalEmail(value: unknown): string | null | undefined | false {
  const email = optionalText(value, FIELD_LIMITS.email);
  if (email === undefined || email === null) return email;
  const normalized = normalizeEmail(email);
  return emailValid(normalized) ? normalized : false;
}

/** Teléfono opcional normalizado (`+<código> <dígitos>`); `false` si es inválido. */
function optionalPhone(value: unknown): string | null | undefined | false {
  const phone = optionalText(value, 30);
  if (phone === undefined || phone === null) return phone;
  return normalizeContactPhone(phone) || false;
}

/** Campos del cliente listos para Prisma (solo los presentes en el cuerpo). */
export function parseClientFields(body: unknown): ClientFieldsResult {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const data: ClientFieldPatch = {};

  if (record.name !== undefined) {
    const name = normalizePersonName(typeof record.name === "string" ? record.name : "");
    if (!personNameValid(name)) return { ok: false, error: FIELD_MESSAGES.name };
    data.name = name;
  }

  if (record.company !== undefined) data.company = optionalText(record.company, FIELD_LIMITS.company) ?? null;
  if (record.ruc !== undefined) data.ruc = optionalText(record.ruc, 30) ?? null;
  if (record.notes !== undefined) data.notes = optionalText(record.notes, FIELD_LIMITS.notes) ?? null;
  if (record.contactRole !== undefined) data.contactRole = optionalText(record.contactRole, FIELD_LIMITS.name) ?? null;

  if (record.type !== undefined) {
    if (record.type !== "FINAL" && record.type !== "RESELLER") return { ok: false, error: "Tipo de cliente inválido." };
    data.type = record.type;
  }

  if (record.contactName !== undefined) {
    const contactName = normalizePersonName(typeof record.contactName === "string" ? record.contactName : "");
    if (contactName && !personNameValid(contactName)) return { ok: false, error: FIELD_MESSAGES.name };
    data.contactName = contactName || null;
  }

  const emails = { email: record.email, contactEmail: record.contactEmail } as const;
  for (const field of ["email", "contactEmail"] as const) {
    const value = emails[field];
    if (value === undefined) continue;
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
