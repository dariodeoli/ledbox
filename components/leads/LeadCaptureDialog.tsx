"use client";
import { Input as SharedInput, Textarea as SharedTextarea, Select as SharedSelect } from "owncoding-ui";

import Link from "next/link";
import { PhonePartsField } from "@/components/fields/PhonePartsField";
import { FormEvent, useEffect, useRef, useState } from "react";
import { EmailField as LibEmailField, RucField as LibRucField, soloDigitos } from "owncoding-ui";
import type { CartItem } from "@/components/cart/CartDrawer";
import { whatsappUrl } from "@/lib/public-config";

/**
 * «Antes de cotizar» (issue #104): el formulario de consulta del sitio con los
 * campos guiados de `owncoding-ui` —RUC con «Extraer» contra el endpoint público
 * `/api/ruc` (la razón social se aplica recién con «Usar estos datos») y correo
 * con sugerencias de dominio— y el teléfono con +595 predeterminado.
 *
 * Ojo con el teléfono: el `PhoneField` de la librería valida solo-móvil para
 * Paraguay y marcaría como inválidos los fijos que LedBox sí acepta
 * (`owncoding-ui#4`, ya documentado en `lib/field-rules.ts`), así que acá se usa
 * el adaptador común `PhonePartsField`, con catálogo y helpers de la librería. Los componentes de la librería se renderizan solo en el navegador: el
 * diálogo nace cerrado (`open=false`), así que el prerender del sitio no los
 * toca (ver la nota del bloqueo en `docs` del issue #101).
 *
 * El popup entra completo en escritorio (1440×900 y 1280×800) sin scroll; en
 * mobile scrollea y el botón queda alcanzable.
 */

type RucDatos = { name: string; fullRuc?: string; simulado?: boolean };

/** Consulta el RUC contra el endpoint público; el error viaja con su mensaje. */
async function consultarRuc(numero: string): Promise<RucDatos> {
  const response = await fetch(`/api/ruc?numero=${encodeURIComponent(numero)}`);
  const data = (await response.json().catch(() => null)) as (RucDatos & { error?: string }) | null;
  if (!response.ok || !data?.name) {
    throw new Error(data?.error || "No pudimos consultar el RUC. Completá los datos a mano.");
  }
  return { name: data.name, fullRuc: data.fullRuc, simulado: data.simulado };
}

export function LeadCaptureDialog({ open, items, onClose }: { open: boolean; items: CartItem[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+595");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [ruc, setRuc] = useState("");
  const [reason, setReason] = useState("Alquiler de equipos");
  const [message, setMessage] = useState("");
  useEffect(() => { if (!open) return; closeRef.current?.focus(); const onKey=(e:KeyboardEvent)=>e.key === "Escape"&&onClose(); document.addEventListener("keydown", onKey); return ()=>document.removeEventListener("keydown", onKey); }, [open,onClose]);
  useEffect(() => { if (open) { setSent(false); setSubmitting(false); setError(""); } }, [open]);
  if (!open) return null;
  const telefono = `${countryCode} ${soloDigitos(phone)}`.trim();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const products = items.map(item => ({ productId: item.product.id, quantity: item.quantity, duration: item.duration }));
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone: telefono, company, ruc, message: [reason, message].filter(Boolean).join(" — "), products, source: "website", honeypot: "" }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "No pudimos registrar tu consulta.");
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No pudimos registrar tu consulta. Probá nuevamente.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setSent(true);
    const text = `Hola LedBox! Soy ${name || ""}${company ? `, de ${company}` : ""}${ruc ? ` (RUC ${ruc})` : ""}. Tel: ${telefono}. Email: ${email}. Motivo: ${reason}.${message ? ` ${message}` : ""}`;
    window.open(whatsappUrl(text), "_blank", "noopener,noreferrer");
  };
  return <div className="lead-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="lead-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-title">
      <button ref={closeRef} className="dialog-close" type="button" aria-label="Cerrar formulario" onClick={onClose}>×</button>
      {!sent ? <><div className="sec-kicker">Antes de cotizar</div><h2 id="lead-title">Contanos de tu evento<span className="led">.</span></h2><p>Con estos datos te respondemos más rápido. Son pocos campos y no te comprometen a contratar.</p>
        <form onSubmit={submit} aria-busy={submitting}><div className="f-row">
          <label className="f-field"><span>Nombre <em aria-hidden="true">*</em></span><SharedInput name="name" type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="f-field lead-phone">
            <span>Teléfono <em aria-hidden="true">*</em></span>
            <PhonePartsField countryCode={countryCode} phone={phone} onCountryCodeChange={setCountryCode} onChange={setPhone} name="phone" required />
          </div>
          <div className="f-field lead-email"><span>Email <em aria-hidden="true">*</em></span><LibEmailField value={email} onChange={setEmail} placeholder="tu@email.com" aria-label="Email" inputMode="email" /></div>
          <label className="f-field"><span>Empresa</span><SharedInput name="company" type="text" autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Eventos del Sur S.A." /></label>
          <div className="f-field lead-ruc">
            <span>RUC</span>
            <LibRucField value={ruc} onChange={setRuc} consultar={consultarRuc} onAplicar={(datos) => setCompany(datos.name)} maxLength={40} ariaLabel="RUC" textoAyuda="Aplicá la razón social con un clic." />
          </div>
        </div>
        <label className="f-field f-full"><span>Motivo</span><SharedSelect name="reason" value={reason} onChange={(event) => setReason(event.target.value)}><option>Alquiler de equipos</option><option>Stand o activación</option><option>Cobertura digital</option><option>Otro</option></SharedSelect></label>
        <label className="f-field f-full"><span>Detalle breve (opcional)</span><SharedTextarea name="message" rows={2} maxLength={500} placeholder="Fecha, ciudad o cantidad de equipos" value={message} onChange={(event) => setMessage(event.target.value)} /></label>
        <input className="honeypot" name="website" tabIndex={-1} autoComplete="off" />{error && <p className="form-error" role="alert">{error}</p>}{/* Aviso de finalidad (issue #92): texto claro antes del botón, sin casilla premarcada ni dark patterns. */}<p className="lead-consent">Usamos tus datos solo para responder esta consulta y preparar el presupuesto; no los compartimos para publicidad. <Link href="/privacidad" target="_blank" rel="noopener">Política de privacidad</Link>.</p><button className="btn-led" type="submit" disabled={submitting}>{submitting ? "Registrando consulta…" : "Continuar por WhatsApp →"}</button></form></> : <><div className="lead-success" aria-live="polite"><span aria-hidden="true">✓</span><h2>Consulta lista<span className="led">.</span></h2><p>Se abrió WhatsApp con tus datos. El equipo de LedBox te responde a la brevedad.</p><button className="btn-line" type="button" onClick={onClose}>Volver al catálogo</button></div></>}
    </section>
  </div>;
}
