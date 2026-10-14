"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { shouldSendMetrics } from "@/lib/analytics/should-send";

/**
 * Métricas propias de tráfico (docs/SUPERADMIN.md «Tráfico»). Sin librerías, sin cookies:
 * el id de navegación vive en sessionStorage. Al cargar manda la vista; al ocultarse la
 * pestaña manda la duración visible y el scroll máximo con `sendBeacon`. No manda nada con
 * «No rastrear» activo ni fuera de producción (salvo `NEXT_PUBLIC_WEB_METRICS_DEBUG=1`).
 * Solo importa utilidades sin base de datos.
 */

const ENDPOINT = "/api/metrics/view";
const SESSION_KEY = "lbx_sid";
const MAX_DURATION_SEC = 1800;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readSession(): { id: string; entry: boolean } {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return { id: existing, entry: false };
    const id = randomId();
    window.sessionStorage.setItem(SESSION_KEY, id);
    return { id, entry: true };
  } catch {
    return { id: randomId(), entry: false };
  }
}

function send(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => undefined);
  } catch {
    /* las métricas nunca rompen la página */
  }
}

function scrollPercent(): number {
  const doc = document.documentElement;
  const total = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
  if (total <= 0) return 0;
  const seen = (window.scrollY || doc.scrollTop || 0) + window.innerHeight;
  return Math.max(0, Math.min(100, Math.round((seen / total) * 100)));
}

export function PageBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const allowed = shouldSendMetrics({
      doNotTrack: navigator.doNotTrack,
      nodeEnv: process.env.NODE_ENV,
      debugFlag: process.env.NEXT_PUBLIC_WEB_METRICS_DEBUG,
    });
    if (!allowed || !pathname || pathname.startsWith("/api")) return;

    const session = readSession();
    const viewId = randomId();
    const base = {
      viewId,
      sessionId: session.id,
      host: window.location.hostname,
      path: window.location.pathname,
      referrer: document.referrer || null,
      isEntry: session.entry,
    };
    let visibleMs = 0;
    let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    let maxScroll = scrollPercent();

    const onScroll = () => {
      maxScroll = Math.max(maxScroll, scrollPercent());
    };
    const flush = () => {
      if (visibleSince) {
        visibleMs += Date.now() - visibleSince;
        visibleSince = 0;
      }
      maxScroll = Math.max(maxScroll, scrollPercent());
      send({ ...base, durationSec: Math.min(MAX_DURATION_SEC, Math.round(visibleMs / 1000)), scrollPct: maxScroll });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else if (!visibleSince) visibleSince = Date.now();
    };

    send(base);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(); // navegación interna: cierra la vista anterior
    };
  }, [pathname]);

  return null;
}
