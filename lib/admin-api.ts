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

/** 401/403: la sesión o la empresa activa dejaron de valer; se invalida todo. */
function invalidateSession(): void {
  clearAdminApiCache();
  redirectToLogin();
}

export type AdminApiResult<T> = { ok: true; data: T } | { ok: false; error: string; sessionInvalid?: boolean; aborted?: boolean };
export type AdminSendResult<T> = { ok: true; data: T } | { ok: false; error: string };

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal | null;
};

type RequestOutcome = { status: number; payload: Record<string, unknown> };

/** Ejecuta el request con timeout propio; `null` si fue abortado o no hubo conexión. */
async function requestJson(path: string, { method = "GET", body, timeoutMs, signal }: RequestOptions): Promise<RequestOutcome | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  try {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
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
    if (!options.skipSessionRedirect) invalidateSession();
    return { ok: false, error: "La sesión venció. Volvé a iniciar sesión.", sessionInvalid: true };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const message = typeof outcome.payload.error === "string" ? outcome.payload.error : options.fallbackError || "No pudimos cargar los datos.";
    return { ok: false, error: message };
  }
  getCache.set(path, { storedAt: Date.now(), data: outcome.payload });
  return { ok: true, data: outcome.payload as T };
}

/**
 * Mutación del panel: limpia la caché de GET (antes y después) y devuelve el
 * error inline; 401/403 invalidan la sesión.
 */
export async function adminSend<T>(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<AdminSendResult<T>> {
  clearAdminApiCache();
  const outcome = await requestJson(path, { method, body, timeoutMs: SEND_TIMEOUT_MS });
  clearAdminApiCache();
  if (!outcome) return { ok: false, error: "No pudimos conectar con el panel." };
  if (outcome.status === 401 || outcome.status === 403) {
    invalidateSession();
    return { ok: false, error: "La sesión venció. Volvé a iniciar sesión." };
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
