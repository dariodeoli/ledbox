"use client";

import { useState } from "react";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { formatDateTime } from "@/lib/admin-format";
import { privacyPolicyUrl, publicConfig, whatsappUrl } from "@/lib/public-config";
import type { PortalSignatureRequest } from "@/lib/server/signature/portal";
import { PortalCardTitle } from "./PortalCardTitle";
import { SignatureCanvas } from "./SignatureCanvas";
import { SignatureDocumentSheet } from "./SignatureDocumentSheet";

/**
 * Vista interactiva del portal de firma (issue #79).
 *
 * El cliente la lee de arriba abajo: encabezado con el estado, la acción
 * contextual (revisar, firmar, descargar), el documento completo, el bloque de
 * firma (consentimiento → verificación → firma dibujada o tipográfica → vista
 * previa → confirmar), la cronología de auditoría, las evidencias y la ayuda.
 * El estado terminal —firmado, vencido, rechazado o cancelado— apaga el bloque
 * de firma y muestra la descarga.
 *
 * Todo lo que cambia el estado sale del API: la vista se re-renderiza con la
 * respuesta real, nunca con un estado optimista.
 */

type ActionError = { error?: string; signature?: PortalSignatureRequest; demoOtp?: string } | null;

const EVIDENCE_STATUS: Record<string, string> = {
  PENDING: "Pendiente",
  OPTIONAL: "Opcional",
  COMPLETED: "Completa",
  FAILED: "Falló",
};

export function SignaturePortalView({ request }: { request: PortalSignatureRequest }) {
  const [current, setCurrent] = useState(request);
  const [consent, setConsent] = useState(false);
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [otp, setOtp] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpNotice, setOtpNotice] = useState("");
  /** Solo en la demo: el código que el servidor devuelve en vez de enviarlo por correo. */
  const [demoOtp, setDemoOtp] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState("");

  const signed = current.status === "SIGNED" || current.status === "VALIDATED";
  const canSign = current.canSign;
  const blocked = !signed && !canSign;
  const otpGate = current.otpRequired && !current.otpVerified;
  const basePath = `/api/portal/firma/${encodeURIComponent(current.code)}`;

  async function post(path: string, body: unknown): Promise<ActionError> {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await response.json().catch(() => null)) as ActionError;
    } catch {
      return { error: "No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo." };
    }
  }

  function applyView(data: ActionError): PortalSignatureRequest | null {
    if (!data?.signature) return null;
    setCurrent(data.signature);
    return data.signature;
  }

  async function submitSignature(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!consent) {
      setError("Marcá el consentimiento para firmar electrónicamente.");
      return;
    }
    const signature = current.method === "TYPED" ? { name: typedName } : { dataUrl: drawnDataUrl };
    if (current.method === "TYPED" && typedName.trim().length < 2) {
      setError("Escribí tu nombre completo para firmar.");
      return;
    }
    if (current.method === "DRAWN" && !drawnDataUrl) {
      setError("Dibujá tu firma dentro del recuadro antes de continuar.");
      return;
    }
    setBusy(true);
    setError("");
    const data = await post(`${basePath}/sign`, { consent: true, signature });
    setBusy(false);
    const view = applyView(data);
    if (!view) {
      setError(data?.error ?? "No pudimos registrar la firma. Probá de nuevo.");
      return;
    }
    setConsent(false);
    setDrawnDataUrl(null);
    setTypedName("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function sendOtp() {
    setOtpBusy(true);
    setOtpNotice("");
    setError("");
    const data = await post(`${basePath}/otp`, { action: "send" });
    setOtpBusy(false);
    if (!applyView(data)) {
      setError(data?.error ?? "No pudimos enviar el código.");
      return;
    }
    if (typeof data?.demoOtp === "string") {
      // Demo: no se envió ningún correo; el código se muestra acá.
      setDemoOtp(data.demoOtp);
      setOtpNotice("Demo: no se envió ningún correo. Usá el código que ves acá.");
      return;
    }
    setDemoOtp("");
    setOtpNotice(`Te enviamos un código a ${current.recipient.email ?? "tu correo"}.`);
  }

  async function verifyOtp() {
    setOtpBusy(true);
    setOtpNotice("");
    setError("");
    const data = await post(`${basePath}/otp`, { action: "verify", otp });
    setOtpBusy(false);
    if (!applyView(data)) {
      setError(data?.error ?? "El código no es correcto.");
      return;
    }
    setOtpNotice("Código verificado: ya podés firmar.");
  }

  async function submitReject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRejectBusy(true);
    setRejectError("");
    const data = await post(`${basePath}/reject`, { reason });
    setRejectBusy(false);
    if (!applyView(data)) {
      setRejectError(data?.error ?? "No pudimos registrar el rechazo.");
      return;
    }
    setRejectOpen(false);
    setReason("");
  }

  return (
    <div className="portal-budget portal-signature">
      <header className="portal-card portal-signature-head">
        <div className="portal-budget-head-top">
          <div className="portal-budget-head-title">
            <p className="portal-kicker">Solicitud de firma</p>
            <h1 className="portal-budget-title">{current.title}</h1>
            <p className="portal-budget-meta">
              {current.organizationName} · para {current.recipient.name}
            </p>
          </div>
          <span className="portal-chip" data-tone={current.statusTone}>
            {current.statusLabel}
          </span>
        </div>
        <div className="portal-signature-chips">
          <span className="portal-chip" data-tone="accent">
            <AdminIcon name="lock" size={12} /> Conexión segura
          </span>
          <span className="portal-chip">{current.methodLabel}</span>
          {current.otpRequired ? (
            <span className="portal-chip" data-tone={current.otpVerified ? "ok" : "warn"}>
              {current.otpVerified ? "Código verificado" : "Pide código por correo"}
            </span>
          ) : null}
        </div>
        <dl className="portal-facts portal-facts--head">
          <div>
            <dt>Código de la solicitud</dt>
            <dd className="portal-signature-code">{current.code}</dd>
          </div>
          <div>
            <dt>Creada</dt>
            <dd>{formatDateTime(current.createdAt)}</dd>
          </div>
          <div>
            <dt>Vence</dt>
            <dd>{formatDateTime(current.expiresAt)}</dd>
          </div>
          <div>
            <dt>Método</dt>
            <dd>{current.methodLabel}</dd>
          </div>
        </dl>
      </header>

      {signed ? (
        <section className="portal-banner portal-banner--ok" aria-labelledby="firma-estado">
          <h2 className="portal-banner-title" id="firma-estado">
            <AdminIcon name="check" size={16} />
            <span>Documento firmado correctamente</span>
          </h2>
          <p className="portal-banner-note">
            {current.signedAt ? `${formatDateTime(current.signedAt)} · ` : ""}
            {current.signatureIdentifier ? (
              <>
                Identificador <strong className="portal-signature-code">{current.signatureIdentifier}</strong> ·{" "}
              </>
            ) : null}
            Estado: {current.statusLabel}
          </p>
          <div className="portal-banner-actions">
            <a className="portal-btn portal-btn--primary" href={current.urls.document} target="_blank" rel="noreferrer">
              Descargar documento firmado
            </a>
            <a className="portal-btn" href={current.urls.audit} target="_blank" rel="noreferrer">
              Descargar auditoría
            </a>
            <a className="portal-btn portal-btn--ghost" href={current.urls.portal}>
              Volver al portal
            </a>
          </div>
        </section>
      ) : canSign ? (
        <section className="portal-banner portal-banner--warn" aria-labelledby="firma-estado">
          <h2 className="portal-banner-title" id="firma-estado">
            <AdminIcon name="pen" size={16} />
            <span>Tu firma es necesaria para continuar</span>
          </h2>
          <p className="portal-banner-note">
            Revisá el documento completo y firmalo electrónicamente desde este dispositivo. El enlace vence el{" "}
            {formatDateTime(current.expiresAt)}.
          </p>
          <div className="portal-banner-actions">
            <a className="portal-btn" href="#documento">
              Revisar documento
            </a>
            <a className="portal-btn portal-btn--primary" href="#firma">
              Firmar documento
            </a>
          </div>
        </section>
      ) : (
        <section className="portal-banner portal-banner--danger" aria-labelledby="firma-estado">
          <h2 className="portal-banner-title" id="firma-estado">
            <AdminIcon name="alert" size={16} />
            <span>{current.statusLabel}</span>
          </h2>
          <p className="portal-banner-note">{current.blockedReason}</p>
          {current.rejectionReason ? <p className="portal-banner-quote">Motivo: {current.rejectionReason}</p> : null}
          {current.cancelReason ? <p className="portal-banner-quote">Motivo: {current.cancelReason}</p> : null}
          <div className="portal-banner-actions">
            <a className="portal-btn" href={current.urls.audit} target="_blank" rel="noreferrer">
              Descargar auditoría
            </a>
            <a className="portal-btn portal-btn--ghost" href={current.urls.portal}>
              Volver al portal
            </a>
          </div>
        </section>
      )}

      <div className="portal-budget-grid">
        <div className="portal-budget-main">
          <section className="portal-card" id="documento">
            <PortalCardTitle icon="budgets">Documento</PortalCardTitle>
            {current.document.kind === "attachment" && current.urls.attachment ? (
              <>
                <iframe
                  className="portal-signature-pdf"
                  src={current.urls.attachment}
                  title={`Documento ${current.document.name}`}
                />
                <div className="portal-form-actions">
                  <a className="portal-btn" href={current.urls.attachment} target="_blank" rel="noreferrer">
                    Abrir en una pestaña
                  </a>
                </div>
              </>
            ) : current.budget ? (
              <SignatureDocumentSheet document={current.budget} />
            ) : (
              <p className="portal-empty">El documento todavía no está disponible.</p>
            )}
          </section>

          {canSign ? (
            <section className="portal-card portal-card--action" id="firma">
              <PortalCardTitle icon="pen">Firmar documento</PortalCardTitle>
              <p className="portal-card-lead">
                {current.methodLabel}. Tu firma queda registrada con fecha, hora y sello de tiempo en la auditoría de la
                solicitud.
              </p>

              <form className="portal-form" onSubmit={(event) => void submitSignature(event)}>
                <label className="portal-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    aria-describedby="firma-consent-purpose"
                  />
                  <span>Confirmo que revisé el documento y deseo firmarlo electrónicamente.</span>
                </label>
                {/* Finalidad en texto claro + política (issue #93): la firma y su
                    evidencia ya quedan auditadas; acá solo se informa. */}
                <p className="portal-consent-purpose" id="firma-consent-purpose">
                  Finalidad: registrar tu firma electrónica y la evidencia de la auditoría (fecha y hora, sello de tiempo y
                  dispositivo). Consultá la{" "}
                  <a href={privacyPolicyUrl()} target="_blank" rel="noreferrer">
                    política de privacidad
                  </a>
                  .
                </p>
                <details className="portal-signature-terms">
                  <summary>Qué queda registrado al firmar</summary>
                  <ul className="portal-help-list">
                    <li>Tu firma y el método elegido, con fecha y hora del servidor (sello de tiempo).</li>
                    <li>La huella del documento antes y después de firmar, y el identificador de la firma.</li>
                    <li>La dirección IP y el dispositivo, protegidos con hash (nunca en claro).</li>
                    <li>El enlace es personal y vence: no lo compartas con nadie.</li>
                  </ul>
                </details>

                {otpGate ? (
                  <div className="portal-signature-otp">
                    <label className="portal-field">
                      <span className="portal-field-label">Código de verificación</span>
                      <input
                        value={otp}
                        onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        maxLength={6}
                        aria-label="Código de verificación enviado por correo"
                      />
                      <span className="portal-help">
                        {current.otpSentAt
                          ? `Te enviamos un código a ${current.recipient.email ?? "tu correo"}. Revisá la bandeja y el spam.`
                          : `Te enviamos un código de 6 dígitos a ${current.recipient.email ?? "tu correo"}.`}
                      </span>
                    </label>
                    <div className="portal-form-actions">
                      <button type="button" className="portal-btn" onClick={() => void sendOtp()} disabled={otpBusy}>
                        {current.otpSentAt ? "Reenviar código" : "Enviar código"}
                      </button>
                      <button
                        type="button"
                        className="portal-btn portal-btn--primary"
                        onClick={() => void verifyOtp()}
                        disabled={otpBusy || otp.length !== 6}
                      >
                        Verificar código
                      </button>
                    </div>
                    {demoOtp ? (
                      <div className="portal-demo-otp" role="status">
                        <span>Demo: el código no se envía por correo. Tu código es</span>
                        <span className="portal-demo-otp-code" aria-label={`Código de la demo: ${demoOtp.split("").join(" ")}`}>{demoOtp}</span>
                        <button type="button" className="portal-btn" onClick={() => setOtp(demoOtp)} disabled={otpBusy || otp === demoOtp}>
                          Usar este código
                        </button>
                      </div>
                    ) : null}
                    {otpNotice ? (
                      <p className="portal-ok" role="status">
                        {otpNotice}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {current.method === "DRAWN" ? (
                  <>
                    <p className="portal-field-label">Firma dibujada</p>
                    <SignatureCanvas onChange={setDrawnDataUrl} disabled={busy || otpGate} />
                    <p className="portal-help">En el celular podés firmar con el dedo; en la computadora, con el mouse.</p>
                  </>
                ) : (
                  <label className="portal-field">
                    <span className="portal-field-label">Firma tipográfica</span>
                    <input
                      value={typedName}
                      onChange={(event) => setTypedName(event.target.value)}
                      placeholder="Escribí tu nombre y apellido"
                      maxLength={120}
                      aria-label="Nombre para la firma tipográfica"
                    />
                    <span className="portal-help">El nombre escrito queda como tu firma en el documento.</span>
                  </label>
                )}

                {(current.method === "DRAWN" && drawnDataUrl) || (current.method === "TYPED" && typedName.trim().length >= 2) ? (
                  <div className="portal-signature-preview" aria-label="Vista previa de la firma">
                    <span className="portal-field-label">Vista previa</span>
                    {current.method === "DRAWN" && drawnDataUrl ? (
                      <img src={drawnDataUrl} alt="Vista previa de tu firma dibujada" />
                    ) : (
                      <span className="portal-signature-typed">{typedName.trim()}</span>
                    )}
                  </div>
                ) : null}

                {error ? (
                  <p className="portal-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="portal-form-actions">
                  <button type="submit" className="portal-btn portal-btn--primary portal-btn--block" disabled={busy || otpGate}>
                    {busy ? <span className="portal-spinner" aria-hidden="true" /> : <AdminIcon name="pen" size={14} />}
                    {busy ? "Firmando…" : "Firmar documento"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </div>

        <aside className="portal-budget-aside">
          <section className="portal-card">
            <PortalCardTitle icon="info">Resumen</PortalCardTitle>
            <dl className="portal-facts portal-facts--aside">
              <div>
                <dt>Emisor</dt>
                <dd>
                  {current.senderName} · {current.organizationName}
                </dd>
              </div>
              <div>
                <dt>Destinatario</dt>
                <dd>{current.recipient.name}</dd>
              </div>
              {current.recipient.email ? (
                <div>
                  <dt>Correo</dt>
                  <dd>{current.recipient.email}</dd>
                </div>
              ) : null}
              {current.recipient.phone ? (
                <div>
                  <dt>Teléfono</dt>
                  <dd>{current.recipient.phone}</dd>
                </div>
              ) : null}
              <div>
                <dt>Documento</dt>
                <dd>{current.document.name}</dd>
              </div>
              {current.viewedAt ? (
                <div>
                  <dt>Primera lectura</dt>
                  <dd>{formatDateTime(current.viewedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="portal-card">
            <PortalCardTitle icon="clock">Historial del proceso</PortalCardTitle>
            {current.timeline.length === 0 ? (
              <p className="portal-empty">Todavía no hay movimientos.</p>
            ) : (
              <ol className="portal-timeline">
                {current.timeline.map((entry) => (
                  <li className="portal-timeline-step" key={entry.id} data-tone={entry.tone}>
                    <span className="portal-timeline-when">{formatDateTime(entry.at)}</span>
                    <span className="portal-timeline-body">
                      <strong>
                        {entry.label}
                        {entry.actor ? <span className="portal-timeline-actor"> · {entry.actor}</span> : null}
                      </strong>
                      {entry.detail ? <small>{entry.detail}</small> : null}
                      <small className="portal-timeline-kind" title={entry.hash}>
                        hash {entry.hash.slice(0, 12)}…
                      </small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="portal-card">
            <PortalCardTitle icon="audit">Evidencias de firma</PortalCardTitle>
            <ul className="portal-signature-evidence">
              {current.evidence.map((item) => (
                <li key={item.type}>
                  <span>{item.label}</span>
                  <span className="portal-chip" data-tone={item.status === "COMPLETED" ? "ok" : item.status === "FAILED" ? "danger" : "neutral"}>
                    {EVIDENCE_STATUS[item.status] ?? item.status}
                  </span>
                </li>
              ))}
            </ul>
            <div className="portal-form-actions">
              <a className="portal-btn portal-btn--ghost" href={current.urls.audit} target="_blank" rel="noreferrer">
                Ver la auditoría completa
              </a>
            </div>
          </section>

          <section className="portal-card">
            <PortalCardTitle icon="info">¿Necesitás ayuda?</PortalCardTitle>
            <p className="portal-card-lead">
              Si algo no cierra, escribinos antes de firmar. También podés pedir cambios y el equipo te envía una versión
              nueva.
            </p>
            <div className="portal-form-actions">
              <a
                className="portal-btn"
                href={whatsappUrl(`Hola, necesito ayuda con la solicitud de firma ${current.code} («${current.title}»).`)}
                target="_blank"
                rel="noreferrer"
              >
                Necesito ayuda
              </a>
              {canSign ? (
                <button type="button" className="portal-btn portal-btn--ghost" onClick={() => setRejectOpen((value) => !value)}>
                  {rejectOpen ? "Cerrar" : "Solicitar cambios"}
                </button>
              ) : null}
            </div>
            {rejectOpen ? (
              <form className="portal-form" onSubmit={(event) => void submitReject(event)}>
                <label className="portal-field">
                  <span className="portal-field-label">¿Qué no podés firmar y por qué?</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    maxLength={600}
                    placeholder="Ej.: necesito cambiar la fecha de entrega antes de firmar."
                    aria-label="Motivo del rechazo"
                  />
                </label>
                {rejectError ? (
                  <p className="portal-error" role="alert">
                    {rejectError}
                  </p>
                ) : null}
                <div className="portal-form-actions">
                  <button type="submit" className="portal-btn" disabled={rejectBusy || reason.trim().length < 10}>
                    {rejectBusy ? <span className="portal-spinner" aria-hidden="true" /> : null}
                    Enviar rechazo
                  </button>
                </div>
                <p className="portal-help">
                  El equipo de {current.organizationName} recibe tu motivo y puede emitir una solicitud nueva.
                </p>
              </form>
            ) : null}
          </section>
        </aside>
      </div>

      {canSign ? (
        <div className="portal-mobile-sticky portal-print-hide">
          <div className="portal-mobile-sticky-total">
            <span>Acción pendiente</span>
            <strong>{current.statusLabel}</strong>
          </div>
          <a className="portal-btn portal-btn--primary portal-mobile-sticky-action" href="#firma">
            Firmar documento
          </a>
        </div>
      ) : signed ? (
        <div className="portal-mobile-sticky portal-print-hide">
          <div className="portal-mobile-sticky-total">
            <span>Documento firmado</span>
            <strong>{current.signatureIdentifier ?? current.statusLabel}</strong>
          </div>
          <a className="portal-btn portal-btn--primary portal-mobile-sticky-action" href={current.urls.document} target="_blank" rel="noreferrer">
            Descargar
          </a>
        </div>
      ) : null}

      <p className="portal-help portal-signature-footer">
        Firma electrónica de {current.organizationName} con tecnología de {publicConfig.siteUrl.replace(/^https?:\/\//, "")}. La
        validez legal del documento depende del acuerdo entre las partes.
      </p>
    </div>
  );
}
