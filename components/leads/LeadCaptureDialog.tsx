"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { CartItem } from "@/components/cart/CartDrawer";
import { whatsappUrl } from "@/lib/public-config";

export function LeadCaptureDialog({ open, items, onClose }: { open: boolean; items: CartItem[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!open) return; closeRef.current?.focus(); const onKey=(e:KeyboardEvent)=>e.key === "Escape"&&onClose(); document.addEventListener("keydown", onKey); return ()=>document.removeEventListener("keydown", onKey); }, [open,onClose]);
  useEffect(() => { if (open) { setSent(false); setSubmitting(false); setError(""); } }, [open]);
  if (!open) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lead = Object.fromEntries(form.entries());
    const products = items.map(item => ({ productId: item.product.id, quantity: item.quantity, duration: item.duration }));
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, message: [lead.reason, lead.message].filter(Boolean).join(" — "), products, source: "website", honeypot: "" }) });
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
    const text = `Hola LedBox! Soy ${lead.name || ""}${lead.company ? `, de ${lead.company}` : ""}. Tel: ${lead.phone || ""}. Email: ${lead.email || ""}. Motivo: ${lead.reason || "Consulta"}.${lead.message ? ` ${lead.message}` : ""}`;
    window.open(whatsappUrl(text), "_blank", "noopener,noreferrer");
  };
  return <div className="lead-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="lead-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-title">
      <button ref={closeRef} className="dialog-close" type="button" aria-label="Cerrar formulario" onClick={onClose}>×</button>
      {!sent ? <><div className="sec-kicker">Antes de cotizar</div><h2 id="lead-title">Contanos de tu evento<span className="led">.</span></h2><p>Con estos datos te respondemos más rápido. Son pocos campos y no te comprometen a contratar.</p>
        <form onSubmit={submit} aria-busy={submitting}><div className="f-row"><Field label="Nombre" name="name" required autoComplete="name"/><Field label="Teléfono" name="phone" type="tel" required autoComplete="tel"/><Field label="Email" name="email" type="email" required autoComplete="email"/><Field label="Empresa / RUC" name="company" autoComplete="organization"/></div><label className="f-field f-full"> <span>Motivo</span><select name="reason" defaultValue="Alquiler de equipos"><option>Alquiler de equipos</option><option>Stand o activación</option><option>Cobertura digital</option><option>Otro</option></select></label><label className="f-field f-full"><span>Detalle breve (opcional)</span><textarea name="message" rows={3} maxLength={500} placeholder="Fecha, ciudad o cantidad de equipos" /></label><input className="honeypot" name="website" tabIndex={-1} autoComplete="off" />{error && <p className="form-error" role="alert">{error}</p>}<button className="btn-led" type="submit" disabled={submitting}>{submitting ? "Registrando consulta…" : "Continuar por WhatsApp →"}</button></form></> : <><div className="lead-success" aria-live="polite"><span aria-hidden="true">✓</span><h2>Consulta lista<span className="led">.</span></h2><p>Se abrió WhatsApp con tus datos. El equipo de LedBox te responde a la brevedad.</p><button className="btn-line" type="button" onClick={onClose}>Volver al catálogo</button></div></>}
    </section>
  </div>;
}
function Field({ label, name, type="text", required=false, autoComplete }: {label:string;name:string;type?:string;required?:boolean;autoComplete?:string}) { return <label className="f-field"><span>{label}{required && <em aria-hidden="true"> *</em>}</span><input name={name} type={type} required={required} autoComplete={autoComplete} /></label>; }
