import { waMeLink } from "./whatsapp-link";
import { emailValid, normalizeEmail, normalizePersonName, personNameValid, phoneValid } from "./field-rules";

/**
 * Contacto del visitante que quiere guardar su carrito: nombre y, al menos, WhatsApp o correo. Reglas
 * puras (usan `lib/field-rules.ts`, las mismas del panel): las comparten el formulario de la tienda y el servidor.
 * El contacto NO se usa para buscar carritos ni para decir si un correo «ya existe»: el carrito se recupera
 * solo con el enlace que recibe quien lo creó.
 */
export type VisitorContact = { name: string; phone: string | null; email: string | null };

export function parseVisitorContact(body: unknown): { ok: true; value: VisitorContact } | { ok: false; error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const name = normalizePersonName(typeof record.name === "string" ? record.name : "");
  if (!personNameValid(name)) return { ok: false, error: "Escribí tu nombre (al menos 2 letras)." };
  const rawPhone = typeof record.phone === "string" ? record.phone.trim() : "";
  const rawEmail = typeof record.email === "string" ? normalizeEmail(record.email) : "";
  if (!rawPhone && !rawEmail) return { ok: false, error: "Dejanos tu WhatsApp o tu correo (con uno alcanza)." };
  if (rawPhone && (rawPhone.length > 40 || !phoneValid(rawPhone))) return { ok: false, error: "Ingresá un WhatsApp válido con código de país, por ejemplo +595 981 000 000." };
  if (rawEmail && !emailValid(rawEmail)) return { ok: false, error: "Ingresá un correo válido, por ejemplo nombre@correo.com." };
  return { ok: true, value: { name, phone: rawPhone || null, email: rawEmail || null } };
}

/** Enlaces para que la persona se mande a sí misma su enlace (sin enviar nada desde el servidor). */
export function selfShareLinks(contact: Pick<VisitorContact, "phone" | "email">, url: string, storeName: string): { whatsapp: string | null; mailto: string | null } {
  const text = `Mi carrito en ${storeName}: ${url}`;
  const digits = (contact.phone ?? "").replace(/\D/g, "");
  return {
    whatsapp: digits.length >= 8 ? waMeLink(digits, { text }) : null,
    mailto: contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent(`Mi carrito en ${storeName}`)}&body=${encodeURIComponent(text)}` : null,
  };
}
