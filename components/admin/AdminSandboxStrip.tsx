"use client";

import React, { useEffect, useState } from "react";
import { formatTime } from "@/lib/admin-format";
import { sandboxDeadline } from "@/lib/demo-deadline";
import { AdminConfirmDialog } from "./AdminUI";

/**
 * Franja de la demo interactiva (docs/DEMO-INTERACTIVA.md §2-3, E3): el visitante trabaja en su propia
 * empresa sandbox, que se borra a 1 h sin uso. Reusa la franja de la vitrina (`.admin-demo-strip`).
 *
 * - «Reiniciar la demo» pide confirmación (`AdminConfirmDialog`), hace `POST /api/demo/session?reset=1` y
 *   vuelve al inicio del panel con la sandbox nueva (los ids de la anterior ya no existen).
 * - Si quedó la cookie `ledbox_demo_aviso` (la demo anterior venció y el servidor creó otra), avisa una
 *   sola vez y la borra.
 * - La hora límite sale de lo que expone la sesión (`demoLastSeenAt`, `demoExpiresAt`); sin datos no se
 *   inventa ninguna.
 */

export const SANDBOX_STRIP_TEXT = "DEMO · Tus cambios se borran si no la usás por 1 hora";
export const SANDBOX_EXPIRED_NOTICE = "Tu demo anterior venció; empezaste una nueva";
export const SANDBOX_NOTICE_COOKIE = "ledbox_demo_aviso";

function readNoticeCookie(): boolean {
  try {
    return document.cookie.split(";").some((part) => part.trim().startsWith(`${SANDBOX_NOTICE_COOKIE}=`));
  } catch {
    return false;
  }
}

function clearNoticeCookie(): void {
  try {
    document.cookie = `${SANDBOX_NOTICE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {
    // Sin cookies el aviso simplemente no se repite.
  }
}

export function AdminSandboxStrip({
  lastSeenAt,
  expiresAt,
  onExit,
  exiting,
}: {
  lastSeenAt?: string | null;
  expiresAt?: string | null;
  onExit: () => void;
  exiting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(false);

  useEffect(() => {
    if (!readNoticeCookie()) return;
    setExpiredNotice(true);
    clearNoticeCookie();
  }, []);

  const deadline = sandboxDeadline({ lastSeenAt, expiresAt });

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/demo/session?reset=1", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          response.status === 429
            ? "Reiniciaste la demo varias veces en poco tiempo. Probá de nuevo en un rato."
            : body?.error || "No pudimos reiniciar la demo. Probá de nuevo.",
        );
        setBusy(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch (failure) {
      console.error("demo: no se pudo reiniciar la sandbox", failure);
      setError("No pudimos reiniciar la demo. Revisá tu conexión y probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-demo-strip" role="status" data-sandbox="true">
        <p
          className="admin-demo-strip-text"
          title="Tenés tu propia demo de EventOS: podés reservar, mover y cargar lo que quieras. No se envía nada de verdad y se borra sola si no la usás por 1 hora."
        >
          <strong>DEMO</strong> · Tus cambios se borran si no la usás por 1 hora
          {deadline ? <span className="admin-demo-strip-deadline"> · Hora límite: {formatTime(deadline)} (hora de Paraguay)</span> : null}
        </p>
        <div className="admin-demo-strip-links">
          <button
            type="button"
            className="admin-demo-strip-link"
            onClick={() => {
              setError("");
              setConfirming(true);
            }}
            disabled={busy || exiting}
            title="Borra lo que hiciste y empieza una demo nueva con los datos de ejemplo"
          >
            Reiniciar la demo
          </button>
          <button
            type="button"
            className="admin-demo-strip-link"
            onClick={onExit}
            disabled={exiting || busy}
            title="Salir de la demo (se borra tu demo) y volver a ledbox.online"
          >
            Salir
          </button>
        </div>
      </div>

      {expiredNotice ? (
        <div className="admin-demo-strip admin-demo-strip--notice" role="status">
          <p className="admin-demo-strip-text">{SANDBOX_EXPIRED_NOTICE}</p>
          <div className="admin-demo-strip-links">
            <button type="button" className="admin-demo-strip-link" onClick={() => setExpiredNotice(false)}>
              Entendido
            </button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <AdminConfirmDialog
          title="Reiniciar la demo"
          icon="refresh"
          message="Se borra todo lo que hiciste en esta demo y empezás de nuevo con los datos de ejemplo. No se puede deshacer."
          confirmLabel="Reiniciar la demo"
          busyLabel="Reiniciando…"
          busy={busy}
          error={error}
          onConfirm={() => void reset()}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
        />
      ) : null}
    </>
  );
}
