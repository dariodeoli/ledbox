/**
 * Mensajes seguros de los errores de autenticación (issue #38).
 *
 * El callback de Google (`app/api/auth/callback/google`) redirige con códigos
 * (`?error=google_state`, `?error=invitation_email_mismatch`, …); nunca con el
 * detalle del proveedor ni con texto libre de la URL. Acá viven las únicas
 * traducciones a texto para las personas, y el módulo de invitaciones las usa
 * también para el `error` que devuelve su API: una sola fuente, sin variantes.
 */

export type AuthErrorCode =
  | "google_state"
  | "google_unconfigured"
  | "google_exchange"
  | "google_identity"
  | "google_not_allowed"
  | "invitation_missing"
  | "invitation_blocked"
  | "invitation_email_mismatch"
  | "invitation_already_member"
  | "invitation_user_inactive"
  | "invitation_name_invalid"
  | "invitation_conflict"
  | "invitation_failed";

const authMessages: Record<AuthErrorCode, string> = {
  google_state: "La sesión de Google venció o se interrumpió. Probá de nuevo.",
  google_unconfigured: "El acceso con Google no está disponible en este momento. Entrá con tu correo y contraseña.",
  google_exchange: "No pudimos validar tu cuenta de Google. Probá de nuevo en unos minutos.",
  google_identity: "No pudimos confirmar tu identidad con Google. Probá de nuevo.",
  google_not_allowed: "Tu cuenta de Google no tiene acceso a este panel. Pedile a un administrador que te invite.",
  invitation_missing: "No encontramos esta invitación. Revisá el link del correo.",
  invitation_blocked: "Esta invitación ya no está disponible. Pedile al equipo que te envíen una nueva.",
  invitation_email_mismatch: "La cuenta de Google no coincide con el correo invitado. Probá con la cuenta correcta.",
  invitation_already_member: "Ya sos miembro de este equipo. Entrá al panel con tu cuenta.",
  invitation_user_inactive: "Tu cuenta está desactivada. Pedile al equipo que la reactive.",
  invitation_name_invalid: "Ingresá un nombre de 2 a 120 caracteres.",
  invitation_conflict: "La invitación cambió mientras la aceptabas. Probá de nuevo.",
  invitation_failed: "No pudimos aceptar la invitación. Probá de nuevo.",
};

const AUTH_FALLBACK = "No pudimos completar el acceso. Probá de nuevo.";

/** Mensaje para un código de error de autenticación; vacío si no hay código. */
export function authErrorMessage(code: string | null | undefined): string {
  if (!code) return "";
  return authMessages[code as AuthErrorCode] ?? AUTH_FALLBACK;
}
