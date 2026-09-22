"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminApiResponse } from "./admin-types";

/**
 * Cliente API único del panel: timeout por request, caché corta solo-GET,
 * limpieza en mutaciones y 401/403 que invalidan la sesión (vuelven al login,
 * igual que el shell para la sesión sin empresa activa).
 */

const GET_TTL_MS = 4_000;
const GET_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 20_000;

type CacheEntry = { storedAt: number; data: unknown };
const getCache = new Map<string, CacheEntry>();
let redirectingToLogin = false;

/** Vacía la caché corta de GET (la usan las mutaciones y el cambio de sesión). */
export function clearAdminApiCache(): void {
  getCache.clear();
}

export function redirectToLogin(): void {
  if (typeof window === "undefined" || redirectingToLogin) return;
  redirectingToLogin = true;
  window.location.assign("/login");
}

/**
 * Avisa al shell que el servidor considera la sesión bloqueada (HTTP 423 ya
 * traducido en `lib/server/tenancy.ts`): el shell dibuja la pantalla de PIN
 * (issue #21) sin desloguear a nadie.
 */
function notifyPanelLocked(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("ledbox:admin-locked"));
}

/** 401/403: la sesión o la empresa activa dejaron de valer; se invalida todo. */
function invalidateSession(): void {
  clearAdminApiCache();
  redirectToLogin();
}

export type AdminApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; sessionInvalid?: boolean; aborted?: boolean };
export type AdminSendResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export type AdminSendOptions = {
  /**
   * Idempotencia de la operación (issue #20): `true` genera una clave nueva por
   * intento y la manda en `Idempotency-Key` —el reintento automático de red
   * reutiliza la misma—; un string usa esa clave explícita (reintento manual).
   */
  idempotencyKey?: string | true;
};

/** Clave de idempotencia nueva (UUID del navegador; fallback sin `crypto`). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal | null;
  /** Clave de idempotencia que viaja en el header (nunca en el body). */
  idempotencyKey?: string;
};

type RequestOutcome = { status: number; payload: Record<string, unknown> };

/** Ejecuta el request con timeout propio; `null` si fue abortado o no hubo conexión. */
async function requestJson(path: string, { method = "GET", body, timeoutMs, signal, idempotencyKey }: RequestOptions): Promise<RequestOutcome | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      signal: controller.signal,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, payload };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * GET con caché corta (solo lectura). `fresh` saltea la caché y `signal` permite
 * cancelar (por ejemplo, al cambiar un filtro).
 */
export async function adminApiGet<T = AdminApiResponse>(
  path: string,
  options: { fresh?: boolean; signal?: AbortSignal; fallbackError?: string; skipSessionRedirect?: boolean } = {},
): Promise<AdminApiResult<T>> {
  const cached = getCache.get(path);
  if (!options.fresh && cached && Date.now() - cached.storedAt < GET_TTL_MS) {
    return { ok: true, data: cached.data as T };
  }
  const outcome = await requestJson(path, { timeoutMs: GET_TIMEOUT_MS, signal: options.signal });
  if (!outcome) {
    return { ok: false, error: "No pudimos conectar con el panel.", aborted: Boolean(options.signal?.aborted) };
  }
  if (outcome.status === 401 || outcome.status === 403) {
    // 403 con código (hoy solo `plan_limit`, issue #42): la operación la rechazó
    // una regla de negocio, no la sesión; se muestra inline sin cerrar sesión.
    const code = typeof outcome.payload.code === "string" ? outcome.payload.code : undefined;
    if (code) {
      const message =
        typeof outcome.payload.error === "string" ? outcome.payload.error : options.fallbackError || "No pudimos cargar los datos.";
      return { ok: false, error: message, code };
    }
    if (!options.skipSessionRedirect) invalidateSession();
    return { ok: false, error: "La sesión venció. Volvé a iniciar sesión.", sessionInvalid: true };
  }
  // 423: el panel quedó bloqueado por PIN (issue #21); el shell dibuja la pantalla.
  if (outcome.status === 423) {
    notifyPanelLocked();
    return { ok: false, error: "El panel está bloqueado." };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const message = typeof outcome.payload.error === "string" ? outcome.payload.error : options.fallbackError || "No pudimos cargar los datos.";
    return { ok: false, error: message };
  }
  getCache.set(path, { storedAt: Date.now(), data: outcome.payload });
  return { ok: true, data: outcome.payload as T };
}

/**
 * Mutaciones idénticas en vuelo (mismo método, ruta y cuerpo) comparten la misma
 * promesa: un doble clic real no dispara dos requests ni dos operaciones. El
 * registro se limpia apenas la promesa se asienta.
 */
const inFlightMutations = new Map<string, Promise<AdminSendResult<unknown>>>();

/**
 * Mutación del panel: limpia la caché de GET (antes y después) y devuelve el
 * error inline; 401/403 invalidan la sesión. `DELETE` va sin cuerpo (es el
 * borrado explícito del avatar; el resto de las bajas del panel siguen en POST).
 *
 * Con `idempotencyKey` manda la clave en `Idempotency-Key` y, si el request se
 * queda sin respuesta (timeout o red), reintenta **una vez con la misma clave**:
 * si el panel ya la había registrado, el reintento devuelve la misma respuesta y
 * no duplica nada (issue #20).
 */
export async function adminSend<T>(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
  options: AdminSendOptions = {},
): Promise<AdminSendResult<T>> {
  const idempotencyKey = options.idempotencyKey === true ? newIdempotencyKey() : options.idempotencyKey;
  const dedupeKey = `${method} ${path} ${JSON.stringify(body ?? null)}`;
  const inFlight = inFlightMutations.get(dedupeKey);
  if (inFlight) return inFlight as Promise<AdminSendResult<T>>;

  const promise = sendMutation<T>(path, body, method, idempotencyKey);
  inFlightMutations.set(dedupeKey, promise as Promise<AdminSendResult<unknown>>);
  const release = () => {
    if (inFlightMutations.get(dedupeKey) === promise) inFlightMutations.delete(dedupeKey);
  };
  void promise.then(release, release);
  return promise;
}

async function sendMutation<T>(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE",
  idempotencyKey?: string,
): Promise<AdminSendResult<T>> {
  clearAdminApiCache();
  let outcome = await requestJson(path, { method, body, timeoutMs: SEND_TIMEOUT_MS, idempotencyKey });
  if (!outcome && idempotencyKey) {
    // La respuesta se perdió: el reintento reutiliza la clave (misma operación).
    outcome = await requestJson(path, { method, body, timeoutMs: SEND_TIMEOUT_MS, idempotencyKey });
  }
  clearAdminApiCache();
  if (!outcome) return { ok: false, error: "No pudimos conectar con el panel." };
  if (outcome.status === 401 || outcome.status === 403) {
    // Misma regla que en los GET: un 403 con código es una regla de negocio
    // (límite del plan, issue #42), no una sesión vencida.
    const code = typeof outcome.payload.code === "string" ? outcome.payload.code : undefined;
    if (code) {
      const message =
        typeof outcome.payload.error === "string" ? outcome.payload.error : "No pudimos guardar los cambios.";
      return { ok: false, error: message, code };
    }
    invalidateSession();
    return { ok: false, error: "La sesión venció. Volvé a iniciar sesión." };
  }
  // 423: el panel quedó bloqueado por PIN (issue #21); el shell dibuja la pantalla.
  if (outcome.status === 423) {
    notifyPanelLocked();
    return { ok: false, error: "El panel está bloqueado." };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const message = typeof outcome.payload.error === "string" ? outcome.payload.error : "No pudimos guardar los cambios.";
    return { ok: false, error: message };
  }
  return { ok: true, data: outcome.payload as T };
}

/** Bloque de datos del panel: carga, error, reintento y `reload` que saltea la caché. */
export function useAdminResource<T>(path: string, pick: (payload: AdminApiResponse) => T) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pickRef = useRef(pick);

  useEffect(() => {
    pickRef.current = pick;
  });

  const load = useCallback(
    async (options?: { fresh?: boolean }) => {
      setLoading(true);
      setError("");
      const result = await adminApiGet<AdminApiResponse>(path, { fresh: options?.fresh ?? false });
      if (!result.ok) {
        if (!result.sessionInvalid) setError(result.error);
        setLoading(false);
        return;
      }
      setData(pickRef.current(result.data));
      setLoading(false);
    },
    [path],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load({ fresh: true });
  }, [load]);

  return { data, loading, error, reload };
}
