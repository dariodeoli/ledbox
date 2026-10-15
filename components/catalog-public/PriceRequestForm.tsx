"use client";

import { PREORDER_COPY } from "@/lib/storefront-ui";
import { useState, type FormEvent } from "react";
import { PRICE_COMMENT_MAX, parsePriceRequest } from "@/lib/price-request";

/**
 * «Pedir un mejor precio» desde el seguimiento del pedido. Comentario obligatorio y monto deseado
 * opcional. Es solo un pedido: la empresa lo acepta, lo contraoferta o lo rechaza, y el precio no
 * cambia hasta que el cliente aprueba la versión final. Single-flight.
 */
export function PriceRequestForm({ token, total }: { token: string; total: number | null }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const body = { comment, desiredAmount: amount.trim() || null };
    const checked = parsePriceRequest(body, { total });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/pedido/${encodeURIComponent(token)}/price-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        window.location.reload();
        return;
      }
      setError(response.status === 429 ? "Hiciste muchos intentos seguidos. Esperá unos minutos y volvé a probar." : payload.error ?? "No pudimos enviar tu solicitud. Probá de nuevo.");
    } catch (failure) {
      console.error("pedido: no se pudo enviar el pedido de precio", failure);
      setError("No pudimos conectar. Revisá tu conexión y probá de nuevo.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" className="cp-btn" onClick={() => setOpen(true)} aria-expanded="false" data-testid="price-request-open">
        Pedir un mejor precio
      </button>
    );
  }
  return (
    <form className="cp-offer" onSubmit={submit} data-testid="price-request-form" aria-label="Pedir un mejor precio">
      <p className="cp-hint">{PREORDER_COPY.notice} {PREORDER_COPY.logistics}</p>
      <label className="cp-field">
        <span>¿Por qué lo pedís?</span>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={PRICE_COMMENT_MAX} rows={3} required placeholder="Ej.: somos clientes frecuentes, es para un evento grande." />
      </label>
      <label className="cp-field">
        <span>Monto que proponés, en Gs. (opcional)</span>
        <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.\s]/g, "").slice(0, 16))} placeholder="Ej.: 1.200.000" />
      </label>
      <p className="cp-hint">Es solo un pedido: la empresa te responde con su propuesta y el precio no cambia hasta que apruebes la versión final.</p>
      {error ? <p className="cp-error" role="alert">{error}</p> : null}
      <div className="cp-row">
        <button type="submit" className="cp-btn cp-btn--primary" disabled={busy}>{busy ? "Enviando…" : "Enviar solicitud de precio"}</button>
        <button type="button" className="cp-btn" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
