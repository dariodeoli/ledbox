import { jsonError } from "./http";

export const AUTH_TEMPORARY_FAILURE = "El servidor no pudo completar la operación. Probá de nuevo en unos segundos.";

/** Stable public 503 with diagnostics limited to non-sensitive error metadata. */
export function authUnavailable(operation: "forgot-password" | "reset-password", error: unknown): Response {
  const record = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : null;
  console.error(`[auth/${operation}] temporary failure`, {
    name: typeof record?.name === "string" ? record.name : "Error",
    code: typeof record?.code === "string" ? record.code : undefined,
  });
  return jsonError(AUTH_TEMPORARY_FAILURE, 503);
}

export function isHttpResponse(value: unknown): value is Response {
  return value instanceof Response;
}
