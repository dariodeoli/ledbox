"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminApiResponse } from "@/lib/admin-types";

/** Acceso al API del panel: sesión vencida vuelve al login y los errores se muestran inline. */

let redirectingToLogin = false;

export function redirectToLogin(): void {
  if (typeof window === "undefined" || redirectingToLogin) return;
  redirectingToLogin = true;
  window.location.assign("/login");
}

export function useAdminResource<T>(path: string, pick: (payload: AdminApiResponse) => T) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pickRef = useRef(pick);

  useEffect(() => {
    pickRef.current = pick;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as AdminApiResponse;
      if (!response.ok) {
        setError(payload.error || "No pudimos cargar los datos.");
        return;
      }
      setData(pickRef.current(payload));
    } catch {
      setError("No pudimos conectar con el panel.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export type AdminSendResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function adminSend<T>(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<AdminSendResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      redirectToLogin();
      return { ok: false, error: "La sesión venció. Volvé a iniciar sesión." };
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return { ok: false, error: payload.error || "No pudimos guardar los cambios." };
    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, error: "No pudimos conectar con el panel." };
  }
}
