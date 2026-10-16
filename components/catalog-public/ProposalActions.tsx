"use client";

import { useState } from "react";
import { Textarea as SharedTextarea } from "owncoding-ui";

/**
 * Aprobar o rechazar la propuesta de la empresa desde el seguimiento del pedido. Single-flight:
 * se deshabilita mientras responde. Aprobar no reserva nada: la empresa lo confirma después.
 */
export function ProposalActions({ token }: { token: string }) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);

  async function send(action: "approve" | "decline") {
    if (busy) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch(`/api/pedido/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: action === "decline" ? note : undefined }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        window.location.reload();
        return;
      }
      setError(payload.error ?? "No pudimos registrar tu respuesta. Probá de nuevo.");
    } catch {
      setError("No pudimos conectar. Revisá tu conexión y probá de nuevo.");
    }
    setBusy(null);
  }

  return (
    <div className="cp-proposal-actions" data-testid="proposal-actions">
      <div className="cp-row">
        <button type="button" className="cp-btn cp-btn--primary" disabled={busy !== null} onClick={() => void send("approve")}>
          {busy === "approve" ? "Enviando…" : "Aprobar la propuesta"}
        </button>
        <button type="button" className="cp-btn" disabled={busy !== null} onClick={() => setDeclining((value) => !value)} aria-expanded={declining}>
          No me sirve
        </button>
      </div>
      {declining ? (
        <div className="cp-field">
          <label htmlFor="proposal-note">Contanos por qué (opcional)</label>
          <SharedTextarea id="proposal-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} />
          <button type="button" className="cp-btn" disabled={busy !== null} onClick={() => void send("decline")}>
            {busy === "decline" ? "Enviando…" : "Rechazar la propuesta"}
          </button>
        </div>
      ) : null}
      {error ? <p className="cp-error" role="alert">{error}</p> : null}
      <p className="cp-hint">Aprobar no reserva todavía: la empresa confirma la reserva y te arma el presupuesto.</p>
    </div>
  );
}
