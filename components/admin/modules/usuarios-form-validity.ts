import { emailError, normalizeEmail, normalizePersonName, personNameError } from "../../../lib/field-rules";

/** Same normalized name/email and raw password length accepted by users API. */
export function userFormValidity(form: { name: string; email: string; password?: string }, mode: "create" | "edit") {
  const name = normalizePersonName(form.name);
  const email = normalizeEmail(form.email);
  const error = personNameError(name) ?? emailError(email)
    ?? (mode === "create" && (form.password ?? "").length < 12
      ? "La contraseña inicial debe tener al menos 12 caracteres." : null);
  return { name, email, error };
}

export function invitationFormValidity(email: string) {
  const normalized = normalizeEmail(email);
  return { email: normalized, error: emailError(normalized) };
}
