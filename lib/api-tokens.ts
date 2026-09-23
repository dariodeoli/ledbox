import { createHash, randomBytes } from "node:crypto";

/**
 * API keys de servicio (issue #69) — parte pura.
 *
 * El token plano tiene la forma `lbx_<secreto base64url de 32 bytes>` y se
 * muestra **una sola vez** al crearlo. En la base solo vive su hash SHA-256
 * (suficiente para un secreto de 256 bits: no hay diccionario que atacar) y un
 * prefijo para poder listarlo sin exponerlo.
 */

export const API_TOKEN_PREFIX = "lbx_";

/** Largo del prefijo visible: `lbx_` + 8 caracteres. */
export const API_TOKEN_DISPLAY_LENGTH = 12;

/** Token nuevo, criptográficamente aleatorio. */
export function apiTokenValue(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex del token (lo único que se persiste). */
export function apiTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Prefijo visible del token (`lbx_XXXXXXXX`). */
export function apiTokenPrefix(token: string): string {
  return token.slice(0, API_TOKEN_DISPLAY_LENGTH);
}

/**
 * Valor del header `Authorization: Bearer <token>`. Devuelve `null` si no hay
 * header, no es Bearer o el valor está vacío (así la cookie sigue siendo el
 * camino normal del panel).
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  const raw = (header ?? "").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(raw);
  return match ? match[1] : null;
}
