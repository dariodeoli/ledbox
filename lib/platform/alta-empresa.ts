import { emailError, normalizeEmail } from "@/lib/field-rules";

/**
 * Alta de empresa desde /superadmin (docs/SUPERADMIN.md §4b). Parte pura (sin base de datos):
 * la importan el formulario de cliente y las pruebas. La escritura vive en `alta-empresa-server.ts`.
 */

export const ORG_NAME_MAX = 80;
export const ORG_SLUG_MIN = 3;
export const ORG_SLUG_MAX = 40;

/** Slugs que chocan con hosts, rutas o la demo; nunca se asignan a una empresa. */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  "demo", "admin", "app", "api", "superadmin", "www", "clientes", "eventos", "login", "portal",
  "tienda", "catalogo", "firma", "pedido", "ledbox", "owncoding", "health", "static", "public",
]);

/** Slug sugerido desde el nombre: minúsculas, sin tildes, guiones, tope de largo. */
export function suggestOrgSlug(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORG_SLUG_MAX)
    .replace(/-+$/g, "");
}

export function orgSlugError(slug: string): string | null {
  if (slug.length < ORG_SLUG_MIN) return `El identificador debe tener al menos ${ORG_SLUG_MIN} caracteres.`;
  if (slug.length > ORG_SLUG_MAX) return `El identificador no puede pasar de ${ORG_SLUG_MAX} caracteres.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Usá solo minúsculas, números y guiones (sin guiones al inicio, al final ni repetidos).";
  if (RESERVED_ORG_SLUGS.has(slug)) return "Ese identificador está reservado. Elegí otro.";
  return null;
}

export const INVITEE_ROLES = ["OWNER", "ADMIN"] as const;
export type InviteeRole = (typeof INVITEE_ROLES)[number];
export const MAX_INVITEES = 10;

export type AltaInvitee = { email: string; role: InviteeRole };
export type AltaEmpresaInput = { name: string; slug: string; planCode: string; invitees: AltaInvitee[] };
export type AltaEmpresaErrors = {
  name?: string;
  slug?: string;
  planCode?: string;
  /** Error de la lista completa (vacía, demasiados). */
  invitees?: string;
  /** Error por fila (índice de la fila en el formulario). */
  inviteeRows?: Record<number, string>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/**
 * Normaliza lo que llega del formulario (texto crudo, nunca confiable). Los invitados vienen como dos listas
 * paralelas (`inviteeEmail[]` e `inviteeRole[]`, lo que da `FormData.getAll`); un rol que no es OWNER/ADMIN queda
 * vacío y la validación lo rechaza.
 */
export function normalizeAltaInput(raw: Record<string, unknown>): AltaEmpresaInput {
  const emails = list(raw.inviteeEmail);
  const roles = list(raw.inviteeRole);
  const invitees = emails.map((email, index) => {
    const role = text(roles[index]).trim().toUpperCase();
    return { email: normalizeEmail(text(email)), role: (INVITEE_ROLES as readonly string[]).includes(role) ? (role as InviteeRole) : ("" as InviteeRole) };
  });
  return {
    name: text(raw.name).replace(/\s+/g, " ").trim(),
    slug: text(raw.slug).trim().toLowerCase(),
    planCode: text(raw.planCode).trim(),
    invitees,
  };
}

export function validateAltaInput(input: AltaEmpresaInput): AltaEmpresaErrors {
  const errors: AltaEmpresaErrors = {};
  if (input.name.length < 2) errors.name = "Escribí el nombre de la empresa.";
  else if (input.name.length > ORG_NAME_MAX) errors.name = `El nombre no puede pasar de ${ORG_NAME_MAX} caracteres.`;
  const slugProblem = orgSlugError(input.slug);
  if (slugProblem) errors.slug = slugProblem;
  if (!input.planCode) errors.planCode = "Elegí un plan.";
  if (input.invitees.length === 0) errors.invitees = "Invitá al menos a una persona.";
  else if (input.invitees.length > MAX_INVITEES) errors.invitees = `Se pueden invitar hasta ${MAX_INVITEES} personas por alta.`;
  const rows: Record<number, string> = {};
  const seen = new Set<string>();
  input.invitees.forEach((invitee, index) => {
    if (!invitee.email) rows[index] = "Escribí el correo o quitá la fila.";
    else if (emailError(invitee.email)) rows[index] = emailError(invitee.email) as string;
    else if (!(INVITEE_ROLES as readonly string[]).includes(invitee.role)) rows[index] = "Elegí el rol: dueño o administrador.";
    else if (seen.has(invitee.email)) rows[index] = "Ese correo ya está en la lista.";
    seen.add(invitee.email);
  });
  if (Object.keys(rows).length > 0) errors.inviteeRows = rows;
  return errors;
}

/** Estado del formulario «Nueva empresa» (lo devuelve la server action; vive acá para que el cliente no importe el servidor). */
export type AltaFormState = { error: string | null; fieldErrors: AltaEmpresaErrors; values: AltaEmpresaInput };
