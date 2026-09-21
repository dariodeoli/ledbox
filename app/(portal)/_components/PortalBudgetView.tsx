"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  budgetApprovalLabel,
  budgetApprovalMethodLabel,
  budgetApprovalTone,
  budgetStatusLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  statusTone,
} from "@/lib/admin-format";
import type { PortalBudget } from "@/lib/server/budget-portal";

/**
 * Vista pública del presupuesto (issue #12): detalle, totales, condiciones y
 * las dos acciones del cliente —aprobar con nombre + consentimiento, o pedir
 * cambios con un comentario—. Sin login: el código del link es la credencial.
 *
 * La aprobación es única: si ya está aprobado, el bloque de acciones no se
 * dibuja y solo se muestra la evidencia registrada.
 */
export function PortalBudgetView({ budget, token }: { budget: PortalBudget; token: string }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [approveError, setApproveError] = useState("");
  const [approving, setApproving] = useState(false);
  const [justApproved, setJustApproved] = useState<null | { already: boolean }>(null);

  const [revisionName, setRevisionName] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionError, setRevisionError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [justRequested, setJustRequested] = useState<null | { at: string; note: string }>(null);

  const approvedRef = useRef<HTMLElement | null>(null);
  const revisionRef = useRef<HTMLElement | null>(null);

  const approved = Boolean(budget.approval.approvedAt) || Boolean(justApproved);
  const revisionPending = !approved && (Boolean(budget.approval.revisionRequestedAt) || Boolean(justRequested));

  // El foco acompaña el cambio de estado para que un lector de pantalla anuncie
  // el resultado de la acción (el bloque nuevo entra al tabulado).
  useEffect(() => {
    if (justApproved) approvedRef.current?.focus();
  }, [justApproved]);
  useEffect(() => {
    if (justRequested) revisionRef.current?.focus();
  }, [justRequested]);

  const approvedAt = budget.approval.approvedAt ?? (justApproved ? new Date().toISOString() : null);
  const approvedByName = budget.approval.approvedByName ?? (justApproved ? name.trim() : null);
  const approvalMethod = budget.approval.method ?? (justApproved ? "digital" : null);
  const revisionAt = budget.approval.revisionRequestedAt ?? justRequested?.at ?? null;
  const revisionText = justRequested ? justRequested.note : budget.approval.revisionNote;
  const approvalState = approved
    ? approvalMethod === "manual"
      ? "APROBADO_MANUAL"
      : "APROBADO_DIGITAL"
    : revisionPending
      ? "CAMBIOS_SOLICITADOS"
      : "PENDIENTE";

  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 3) {
      setApproveError("Ingresá tu nombre y apellido.");
      return;
    }
    if (!consent) {
      setApproveError("Marcá el consentimiento para registrar la aprobación.");
      return;
    }
    setApproving(true);
    setApproveError("");
    try {
      const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), consent: true, note: approveNote.trim() || undefined }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; alreadyApproved?: boolean } | null;
      if (!response.ok) {
        setApproveError(payload?.error || "No pudimos registrar la aprobación. Probá de nuevo.");
        return;
      }
      setJustApproved({ already: Boolean(payload?.alreadyApproved) });
      router.refresh();
    } catch {
      setApproveError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setApproving(false);
    }
  }

  async function requestRevision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revisionNote.trim()) {
      setRevisionError("Contanos qué cambios necesitás.");
      return;
    }
    setRequesting(true);
    setRevisionError("");
    try {
      const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: revisionName.trim() || undefined, note: revisionNote.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setRevisionError(payload?.error || "No pudimos enviar tu comentario. Probá de nuevo.");
        return;
      }
      setJustRequested({ at: new Date().toISOString(), note: revisionNote.trim() });
      setRevisionNote("");
      router.refresh();
    } catch {
      setRevisionError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <article className="portal-budget">
      <header className="portal-budget-head">
        <p className="portal-kicker">Presupuesto Nº {budget.reference}</p>
        <h1 className="portal-budget-title">{budget.title}</h1>
        <p className="portal-budget-meta">
          {budget.client.company || budget.client.name} · {budget.organization}
        </p>
        <p className="portal-budget-meta">
          Emitido el {formatDateTime(budget.createdAt)} ·{" "}
          {budget.validUntil ? `Válido hasta el ${formatDate(budget.validUntil)}` : "Sin fecha de vencimiento"}
        </p>
        <div className="portal-budget-chips">
          <span className="portal-chip" data-tone={statusTone(budget.status)}>
            {budgetStatusLabel(budget.status)}
          </span>
          <span className="portal-chip" data-tone={budgetApprovalTone(approvalState)}>
            {budgetApprovalLabel(approvalState)}
          </span>
        </div>
      </header>

      {approved ? (
        <section className="portal-banner portal-banner--ok" ref={approvedRef} tabIndex={-1} aria-labelledby="portal-approved">
          <h2 className="portal-banner-title" id="portal-approved">
            {justApproved?.already ? "Este presupuesto ya estaba aprobado" : "Presupuesto aprobado"}
          </h2>
          <p>
            {justApproved?.already
              ? "Registramos tu visita: la aprobación original queda tal cual, sin cambios."
              : "Quedó registrada tu aprobación. El equipo de LedBox te contacta para coordinar el evento."}
          </p>
          <dl className="portal-facts portal-facts--inline">
            <div>
              <dt>Nombre</dt>
              <dd>{approvedByName ?? "—"}</dd>
            </div>
            <div>
              <dt>Fecha y hora</dt>
              <dd>{approvedAt ? formatDateTime(approvedAt) : "—"}</dd>
            </div>
            <div>
              <dt>Vía</dt>
              <dd>{budgetApprovalMethodLabel(approvalMethod)}</dd>
            </div>
          </dl>
          {budget.approval.note ? <p className="portal-banner-note">Comentario: {budget.approval.note}</p> : null}
        </section>
      ) : revisionPending ? (
        <section className="portal-banner portal-banner--warn" ref={revisionRef} tabIndex={-1} aria-labelledby="portal-revision">
          <h2 className="portal-banner-title" id="portal-revision">
            Pediste cambios
          </h2>
          <p>
            Recibimos tu comentario{revisionAt ? ` el ${formatDateTime(revisionAt)}` : ""}. El equipo de LedBox actualiza el
            presupuesto y te avisa; mientras tanto podés aprobarlo con el detalle actual.
          </p>
          {revisionText ? <blockquote className="portal-banner-quote">{revisionText}</blockquote> : null}
        </section>
      ) : null}

      <section className="portal-card" aria-labelledby="portal-items">
        <h2 className="portal-card-title" id="portal-items">
          Detalle
        </h2>
        {budget.items.length === 0 ? (
          <p className="portal-empty">Este presupuesto no tiene ítems cargados.</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th scope="col">Producto / servicio</th>
                  <th scope="col" className="portal-num">
                    Cantidad
                  </th>
                  <th scope="col" className="portal-num">
                    Días
                  </th>
                  <th scope="col" className="portal-num">
                    Precio unitario
                  </th>
                  <th scope="col" className="portal-num">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {budget.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      {item.notes ? <small className="portal-item-note">{item.notes}</small> : null}
                    </td>
                    <td className="portal-num">{formatNumber(item.quantity)}</td>
                    <td className="portal-num">{formatNumber(item.days)}</td>
                    <td className="portal-num">{formatMoney(item.unitPrice)}</td>
                    <td className="portal-num">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="portal-totals">
          <div className="portal-total-row">
            <span>Subtotal</span>
            <span className="portal-num">{formatMoney(budget.subtotal)}</span>
          </div>
          {budget.discount > 0 ? (
            <div className="portal-total-row">
              <span>Descuento</span>
              <span className="portal-num">− {formatMoney(budget.discount)}</span>
            </div>
          ) : null}
          <div className="portal-total-row portal-total-row--strong">
            <span>Total</span>
            <span className="portal-num">{formatMoney(budget.total)}</span>
          </div>
        </div>
      </section>

      <section className="portal-card" aria-labelledby="portal-facts">
        <h2 className="portal-card-title" id="portal-facts">
          Evento y condiciones
        </h2>
        <dl className="portal-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{budget.client.company || budget.client.name}</dd>
          </div>
          <div>
            <dt>Evento</dt>
            <dd>{budget.event?.name || "Sin evento asociado"}</dd>
          </div>
          <div>
            <dt>Lugar</dt>
            <dd>{budget.event?.location || "—"}</dd>
          </div>
          <div>
            <dt>Inicio</dt>
            <dd>{budget.event?.startsAt ? formatDateTime(budget.event.startsAt) : "—"}</dd>
          </div>
          <div>
            <dt>Validez de la oferta</dt>
            <dd>{budget.validUntil ? `Hasta el ${formatDate(budget.validUntil)}` : "Sin fecha de vencimiento"}</dd>
          </div>
          <div>
            <dt>Moneda</dt>
            <dd>Guaraníes (PYG), sin decimales</dd>
          </div>
        </dl>
        {budget.notes ? <p className="portal-note">{budget.notes}</p> : null}
      </section>

      {!approved ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-approve">
          <h2 className="portal-card-title" id="portal-approve">
            Aprobar este presupuesto
          </h2>
          <form className="portal-form" onSubmit={approve}>
            <label className="portal-field" htmlFor="portal-name">
              <span className="portal-field-label">Nombre y apellido</span>
              <input
                id="portal-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                autoComplete="name"
                required
                aria-describedby="portal-consent-hint"
              />
            </label>
            <label className="portal-field" htmlFor="portal-note">
              <span className="portal-field-label">Comentario (opcional)</span>
              <textarea
                id="portal-note"
                name="note"
                value={approveNote}
                onChange={(event) => setApproveNote(event.target.value)}
                maxLength={600}
                rows={3}
                placeholder="Algo que quieras aclarar con la aprobación"
              />
            </label>
            <label className="portal-consent" htmlFor="portal-consent">
              <input
                id="portal-consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                aria-describedby="portal-consent-hint"
                required
              />
              <span id="portal-consent-hint">
                Confirmo que revisé el detalle, los montos y las condiciones, y apruebo este presupuesto en nombre de{" "}
                {budget.client.company || budget.client.name}.
              </span>
            </label>
            {approveError ? (
              <p className="portal-error" role="alert">
                {approveError}
              </p>
            ) : null}
            <button className="portal-btn portal-btn--primary" type="submit" disabled={approving} aria-busy={approving || undefined}>
              {approving ? "Registrando aprobación…" : "Aprobar presupuesto"}
            </button>
          </form>
        </section>
      ) : null}

      {!approved ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-changes">
          <h2 className="portal-card-title" id="portal-changes">
            Pedir cambios
          </h2>
          <p className="portal-card-lead">
            Si necesitás ajustar ítems, fechas o montos, dejá tu comentario y el equipo de LedBox te responde con una
            versión nueva.
          </p>
          <form className="portal-form" onSubmit={requestRevision}>
            <label className="portal-field" htmlFor="portal-revision-name">
              <span className="portal-field-label">Nombre (opcional)</span>
              <input
                id="portal-revision-name"
                name="revision-name"
                value={revisionName}
                onChange={(event) => setRevisionName(event.target.value)}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label className="portal-field" htmlFor="portal-revision-note">
              <span className="portal-field-label">¿Qué cambios necesitás?</span>
              <textarea
                id="portal-revision-note"
                name="revision-note"
                value={revisionNote}
                onChange={(event) => setRevisionNote(event.target.value)}
                maxLength={1000}
                rows={4}
                required
                placeholder="Ej.: sumar un día más de alquiler y cambiar el lugar del evento"
              />
            </label>
            {revisionError ? (
              <p className="portal-error" role="alert">
                {revisionError}
              </p>
            ) : null}
            <button className="portal-btn" type="submit" disabled={requesting} aria-busy={requesting || undefined}>
              {requesting ? "Enviando…" : "Solicitar cambios"}
            </button>
          </form>
        </section>
      ) : null}
    </article>
  );
}
