"use client";

import { useState, type FormEvent } from "react";
import { ACCESS_REQUEST_KIND_LABEL, ACCESS_REQUEST_KINDS, type AccessRequestKind } from "@/lib/catalog-access-mode";

/**
 * Puerta de una tienda «Con solicitud» o «Privada». En «Con solicitud» la persona deja nombre,
 * empresa, teléfono, correo y tipo; la empresa lo aprueba desde el panel y le llega su link por
 * correo. La respuesta es siempre el mismo acuse (no revela si el correo ya existía). En
 * «Privada» solo se explica que hace falta el link de la empresa.
 */
export function AccessGate({
  mode,
  organizationName,
  endpoint,
  whatsappUrl,
  demo,
}: {
  mode: "REQUEST" | "PRIVATE";
  organizationName: string;
  endpoint: string;
  whatsappUrl: string | null;
  demo: boolean;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<AccessRequestKind>("RETAIL");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, company, phone, email, kind, website: trap }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string; fields?: Record<string, string[]> };
      if (response.status === 202) setDone(payload.message ?? "Recibimos tu solicitud.");
      else if (response.status === 429) setError("Hiciste muchos intentos seguidos. Probá de nuevo en unos minutos.");
      else if (payload.fields) setError("Revisá tus datos: nombre, teléfono con código de país y un correo válido.");
      else setError(payload.error ?? "No pudimos enviar tu solicitud. Probá de nuevo.");
    } catch {
      setError("No pudimos conectar. Revisá tu conexión y probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "PRIVATE") {
    return (
      <section className="cp-card cp-gate" aria-labelledby="acceso-titulo" data-testid="access-gate">
        <h2 id="acceso-titulo" className="cp-h2">Catálogo privado</h2>
        <p>El catálogo de {organizationName} es privado: se entra con el link personal que te da la empresa. Si todavía no lo tenés, pedíselo.</p>
        {whatsappUrl ? <a className="cp-btn cp-btn--primary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Pedir mi link por WhatsApp</a> : null}
      </section>
    );
  }

  return (
    <section className="cp-card cp-gate" aria-labelledby="acceso-titulo" data-testid="access-gate">
      <h2 id="acceso-titulo" className="cp-h2">Pedí acceso al catálogo</h2>
      {done ? (
        <div role="status" data-testid="access-done">
          <p><strong>{done}</strong></p>
          <p className="cp-hint">Podés cerrar esta página: te avisamos por correo.</p>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate={false}>
          <p className="cp-hint">Dejanos tus datos. {organizationName} revisa tu pedido de acceso y, si lo aprueba, te manda tu link por correo.</p>
          {demo ? <p className="cp-note" role="note">Esto es una demo: la solicitud no se guarda.</p> : null}
          <label className="cp-field"><span>Nombre y apellido</span>
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>
          <label className="cp-field"><span>Empresa (opcional)</span>
            <input name="company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} autoComplete="organization" /></label>
          <label className="cp-field"><span>Teléfono (con código de país)</span>
            <input name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" autoComplete="tel" placeholder="+595 981 000 000" maxLength={40} /></label>
          <label className="cp-field"><span>Correo</span>
            <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" inputMode="email" /></label>
          <fieldset className="cp-field cp-kind">
            <legend>Soy</legend>
            <div className="cp-cats" role="group" aria-label="Tipo de cliente">
              {ACCESS_REQUEST_KINDS.map((value) => (
                <button key={value} type="button" className="cp-cat" aria-pressed={kind === value} onClick={() => setKind(value)}>
                  {ACCESS_REQUEST_KIND_LABEL[value]}
                </button>
              ))}
            </div>
          </fieldset>
          <input type="text" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="cp-trap" />
          {error ? <p className="cp-error" role="alert">{error}</p> : null}
          <button className="cp-btn cp-btn--primary" type="submit" disabled={busy}>{busy ? "Enviando…" : "Pedir acceso"}</button>
        </form>
      )}
    </section>
  );
}
