"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApiGet, adminSend } from "@/lib/admin-api";
import { formatNumber } from "@/lib/admin-format";
import type { AdminLeadItem, AdminLeadQuote } from "@/lib/admin-types";
import { QUOTE_ITEM_STATE_LABEL, isQuoteItemState, quoteItemActive } from "@/lib/catalog-public";
import { NumberField, SelectField, TextAreaField } from "../AdminFields";
import { AdminButton, AdminDialog, AdminNote } from "../AdminUI";

/**
 * Respuesta de la empresa a un pedido del catálogo:
 *
 * - «Rechazar con motivo»: el motivo es obligatorio porque el cliente lo ve en su seguimiento y por correo.
 * - «Modificar pedido»: cambiar cantidades, quitar una línea, marcar «ya no lo tengo disponible» o
 *   reemplazar por otro producto (candidatos con stock libre en esas fechas, los mismos de la
 *   reserva). Se envía como propuesta y el cliente la aprueba desde su seguimiento. El servidor
 *   verifica el stock real: nada se propone por encima de lo que hay.
 */

type MailResult = { status: "sent" | "failed" | "skipped"; error?: string };

function mailNote(mail: MailResult | undefined): string {
  if (!mail) return "";
  if (mail.status === "sent") return " Le avisamos al cliente por correo.";
  if (mail.status === "skipped") return " No le avisamos por correo (sin correo de contacto o sin proveedor): compartile el link de su pedido.";
  return " No pudimos enviarle el correo: avisale por otro medio.";
}

export function RejectQuoteDialog({ quote, onClose, onDone }: { quote: AdminLeadQuote; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = reason.trim().length >= 3;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const result = await adminSend<{ mail?: MailResult }>(`/api/admin/quote-requests/${encodeURIComponent(quote.id)}/reject`, { reason: reason.trim() }, "POST");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(`Rechazamos el pedido con tu motivo.${mailNote(result.data.mail)}`);
  }

  return (
    <AdminDialog
      title="Rechazar el pedido"
      icon="alert"
      size="sm"
      description="El motivo lo ve el cliente en su seguimiento y por correo."
      error={error}
      dirty={reason.trim().length > 0 && !busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>Cancelar</AdminButton>
          <AdminButton type="button" variant="ghost" className="admin-btn--danger" icon="check" busy={busy} busyLabel="Rechazando…" disabled={!valid} onClick={() => void submit()}>
            Rechazar pedido
          </AdminButton>
        </>
      )}
    >
      <TextAreaField
        label="Motivo del rechazo"
        required
        value={reason}
        onChange={setReason}
        maxLength={500}
        rows={4}
        counter
        placeholder="Ej.: esa fecha ya tenemos todo comprometido; podemos ofrecerte otra semana."
        hint="Escribilo para el cliente: sin datos internos."
      />
    </AdminDialog>
  );
}

type Action = "keep" | "quantity" | "remove" | "unavailable" | "substitute";
type Substitute = { id: string; name: string; sku: string | null; available: number };
type LineDraft = { action: Action; quantity: string; substituteId: string };

const ACTION_OPTIONS: Array<{ value: Action; label: string }> = [
  { value: "keep", label: "Dejar como está" },
  { value: "quantity", label: "Cambiar la cantidad" },
  { value: "substitute", label: "Reemplazar por otro producto" },
  { value: "unavailable", label: "Ya no lo tengo disponible" },
  { value: "remove", label: "Quitar del pedido" },
];

export function ModifyQuoteDialog({ quote, onClose, onDone }: { quote: AdminLeadQuote; onClose: () => void; onDone: (message: string) => void }) {
  const lines = useMemo(() => quote.items.filter((item) => quoteItemActive(item.state)), [quote.items]);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(lines.map((item) => [item.id, { action: "keep" as Action, quantity: String(item.quantity), substituteId: "" }])),
  );
  const [substitutes, setSubstitutes] = useState<Record<string, Substitute[] | "loading" | "error">>({});
  const [note, setNote] = useState(quote.proposalNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const changed = lines.some((item) => {
    const draft = drafts[item.id];
    return draft && (draft.action !== "keep" && !(draft.action === "quantity" && Number(draft.quantity) === item.quantity));
  });
  const remaining = lines.filter((item) => {
    const draft = drafts[item.id];
    return !draft || (draft.action !== "remove" && draft.action !== "unavailable");
  }).length;

  function patch(id: string, next: Partial<LineDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...next } }));
  }

  // Los reemplazos se piden recién cuando se elige esa acción (consulta el motor de disponibilidad).
  const needing = lines.filter((item) => drafts[item.id]?.action === "substitute" && substitutes[item.id] === undefined).map((item) => item.id);
  useEffect(() => {
    for (const id of needing) {
      setSubstitutes((current) => ({ ...current, [id]: "loading" }));
      void adminApiGet<{ substitutes?: Array<{ id: string; name: string; sku: string | null; available: number }> }>(
        `/api/admin/quote-requests/${encodeURIComponent(quote.id)}/substitutes?itemId=${encodeURIComponent(id)}`,
        { fresh: true },
      ).then((result) => {
        setSubstitutes((current) => ({ ...current, [id]: result.ok ? (result.data.substitutes ?? []) : "error" }));
      });
    }
    // `needing` cambia solo cuando se elige un reemplazo nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needing.join("|"), quote.id]);

  const quantityProblem = lines.some((item) => {
    const draft = drafts[item.id];
    if (!draft || (draft.action !== "quantity" && draft.action !== "substitute")) return false;
    const quantity = Number(draft.quantity);
    return !Number.isInteger(quantity) || quantity < 1 || quantity > 99;
  });
  const substituteMissing = lines.some((item) => drafts[item.id]?.action === "substitute" && !drafts[item.id]?.substituteId);
  const valid = changed && remaining > 0 && !quantityProblem && !substituteMissing;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const body = {
      note: note.trim() || undefined,
      lines: lines.map((item) => {
        const draft = drafts[item.id];
        if (draft.action === "quantity") return { itemId: item.id, action: "quantity", quantity: Number(draft.quantity) };
        if (draft.action === "substitute") return { itemId: item.id, action: "substitute", quantity: Number(draft.quantity), substituteInventoryId: draft.substituteId };
        return { itemId: item.id, action: draft.action };
      }),
    };
    const result = await adminSend<{ mail?: MailResult; changes?: string[] }>(`/api/admin/quote-requests/${encodeURIComponent(quote.id)}/modify`, body, "POST");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(`Enviamos la propuesta al cliente (${result.data.changes?.length ?? 0} cambios). Queda en «Propuesta enviada» hasta que la apruebe.${mailNote(result.data.mail)}`);
  }

  return (
    <AdminDialog
      title="Modificar el pedido"
      icon="edit"
      size="lg"
      description="Ajustalo a lo que tenés disponible. El cliente lo ve en su seguimiento y lo aprueba antes de que lo aceptes."
      error={error}
      dirty={changed && !busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>Cancelar</AdminButton>
          <AdminButton type="button" variant="primary" icon="mail" busy={busy} busyLabel="Enviando…" disabled={!valid} onClick={() => void submit()}>
            Enviar propuesta al cliente
          </AdminButton>
        </>
      )}
    >
      <div className="admin-quote-modify" data-testid="quote-modify">
        {remaining === 0 ? <AdminNote tone="warn">Si no te queda ninguna línea, rechazá el pedido con un motivo.</AdminNote> : null}
        {lines.map((item) => (
          <ModifyLine
            key={item.id}
            item={item}
            draft={drafts[item.id]}
            substitutes={substitutes[item.id]}
            onChange={(next) => patch(item.id, next)}
          />
        ))}
        {quote.items.some((item) => !quoteItemActive(item.state)) ? (
          <p className="admin-muted">
            Ya quitadas: {quote.items.filter((item) => !quoteItemActive(item.state)).map((item) => `${item.originalName ?? item.productName} (${isQuoteItemState(item.state) ? QUOTE_ITEM_STATE_LABEL[item.state].toLowerCase() : "quitado"})`).join(" · ")}.
          </p>
        ) : null}
        <TextAreaField label="Mensaje para el cliente" optional value={note} onChange={setNote} maxLength={500} rows={3} counter hint="Se muestra arriba de la propuesta, en su seguimiento y en el correo." />
      </div>
    </AdminDialog>
  );
}

function ModifyLine({
  item,
  draft,
  substitutes,
  onChange,
}: {
  item: AdminLeadItem;
  draft: LineDraft;
  substitutes: Substitute[] | "loading" | "error" | undefined;
  onChange: (next: Partial<LineDraft>) => void;
}) {
  const options = Array.isArray(substitutes) ? substitutes : [];
  return (
    <div className="admin-quote-modify-line">
      <p className="admin-quote-modify-name">
        <strong>{item.originalName ?? item.productName}</strong>
        <span className="admin-cell-sub"> · pidió {formatNumber(item.originalQuantity ?? item.quantity)}{item.originalQuantity && item.originalQuantity !== item.quantity ? `, ahora ${formatNumber(item.quantity)} (${item.productName})` : ""}</span>
      </p>
      <div className="admin-settings-grid">
        <SelectField label="Qué hacer" value={draft.action} onChange={(value) => onChange({ action: value as Action })} options={ACTION_OPTIONS} />
        {draft.action === "quantity" || draft.action === "substitute" ? (
          <NumberField label="Cantidad" value={draft.quantity} onChange={(value) => onChange({ quantity: value.replace(/\D/g, "").slice(0, 2) })} maxLength={2} />
        ) : null}
        {draft.action === "substitute" ? (
          substitutes === "loading" || substitutes === undefined ? (
            <p className="admin-muted" role="status">Buscando reemplazos con stock…</p>
          ) : substitutes === "error" ? (
            <AdminNote tone="error">No pudimos buscar reemplazos. Cerrá y probá de nuevo.</AdminNote>
          ) : options.length === 0 ? (
            <AdminNote tone="warn">No hay productos de la misma categoría con stock libre en esas fechas. Marcalo como «ya no lo tengo» o quitalo.</AdminNote>
          ) : (
            <SelectField
              label="Reemplazar por"
              required
              value={draft.substituteId}
              onChange={(value) => onChange({ substituteId: value })}
              options={[{ value: "", label: "Elegí un producto…" }, ...options.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.sku ? ` (${entry.sku})` : ""} · ${entry.available} libres` }))]}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
