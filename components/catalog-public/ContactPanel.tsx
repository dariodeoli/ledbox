"use client";

import { useRef, useState, type FormEvent } from "react";
import { EmailField, PhoneField, TextField } from "@/components/admin/AdminFields";
import { parseVisitorContact } from "@/lib/store-contact";
import { XIcon } from "./StoreIcons";
import { useModalBehavior } from "./ThemePortal";

/**
 * Panel lateral al agregar el primer producto: pide nombre y WhatsApp o correo (con uno alcanza) para guardar el carrito en
 * el servidor y retomarlo desde otro dispositivo con un enlace. También se puede «seguir sin datos» (carrito solo en este
 * navegador). El servidor valida, limita intentos y no revela si un contacto ya existe. El enlace se muestra una vez y la
 * persona se lo manda a sí misma (WhatsApp o correo desde su propio dispositivo): la tienda no envía nada por su cuenta.
 */
export function ContactPanel({ slug, storeName, getCart, onClose, onSaved }: { slug: string; storeName: string; getCart: () => { items: Array<{ id: string; quantity: number }>; from: string | null; to: string | null; zone: string }; onClose: () => void; onSaved: (token: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; share: { whatsapp: string | null; mailto: string | null } } | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const focusScope = useRef<Element | null>(null);
  useModalBehavior(panel, onClose, { fallbackFocus: () => {
    // Saving replaces the cart drawer, so its opener may have unmounted.
    // Resolve a current, visible trigger within this store (also safe in previews).
    const candidates = [...focusScope.current?.querySelectorAll<HTMLElement>("[data-store-cart-trigger]") ?? []]
      .filter((node) => node.getClientRects().length > 0 && !node.matches(":disabled") && !node.closest('[hidden],[inert],[aria-hidden="true"]'));
    return candidates.find((node) => {
      const box = node.getBoundingClientRect();
      const viewport = node.ownerDocument.defaultView;
      return box.bottom > 0 && box.right > 0 && box.top < (viewport?.innerHeight ?? 0) && box.left < (viewport?.innerWidth ?? 0);
    }) ?? candidates[0] ?? null;
  } });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = parseVisitorContact({ name, phone, email });
    if (!checked.ok) { setError(checked.error); return; }
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(slug)}/cart/visitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, ...getCart(), website: trap }),
      });
      const data = (await response.json().catch(() => ({}))) as { token?: string; url?: string; share?: { whatsapp: string | null; mailto: string | null }; error?: string; simulated?: boolean; message?: string };
      if (response.status === 429) { setError("Hiciste muchos intentos seguidos. Esperá unos minutos o seguí sin datos."); return; }
      if (data.simulated) { setError(data.message ?? "Esto es una demo: no se guardó tu carrito."); return; }
      if (!response.ok || !data.token || !data.url) { setError(data.error ?? "No pudimos guardar tu carrito. Probá de nuevo o seguí sin datos."); return; }
      onSaved(data.token);
      setResult({ url: data.url, share: data.share ?? { whatsapp: null, mailto: null } });
    } catch (failure) {
      console.error("tienda: no se pudo crear el carrito guardado", failure);
      setError("No pudimos conectar. Revisá tu conexión o seguí sin datos.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
    } catch {
      setError("No pudimos copiar: seleccioná el enlace y copialo a mano.");
    }
  }

  return (
    <div className="cp-overlay cp-overlay--contact" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-drawer cp-drawer--narrow cp-contact" role="dialog" aria-modal="true" aria-labelledby="contacto-carrito" ref={(node) => { panel.current = node; if (node) focusScope.current = node.closest(".cp-theme"); }} tabIndex={-1} data-testid="save-cart-dialog">
        {result ? (
          <>
            <header className="cp-drawer-head">
              <h2 id="contacto-carrito" className="cp-drawer-title">Guardamos tu carrito</h2>
              <button type="button" className="cp-btn cp-btn--icon" onClick={onClose} aria-label="Cerrar"><XIcon name="close" size={20} /></button>
            </header>
            <div className="cp-drawer-body cp-done" data-testid="visitor-cart-done">
              <p>Con este enlace lo retomás desde cualquier dispositivo durante 30 días. Guardalo: no lo volvemos a mostrar.</p>
              <p><a className="cp-link cp-wrap" href={result.url}>{result.url}</a></p>
              <div className="cp-row">
                <button type="button" className="cp-btn" onClick={() => void copy()}>{copied ? "Enlace copiado" : "Copiar enlace"}</button>
                {result.share.whatsapp ? <a className="cp-btn" href={result.share.whatsapp} target="_blank" rel="noopener noreferrer">Enviármelo por WhatsApp</a> : null}
                {result.share.mailto ? <a className="cp-btn" href={result.share.mailto}>Enviármelo por correo</a> : null}
              </div>
              <p className="cp-legal">Estos botones abren tu propia app de mensajes: nosotros no enviamos nada por vos.</p>
              {error ? <p className="cp-error" role="alert">{error}</p> : null}
            </div>
            <footer className="cp-drawer-foot">
              <button type="button" className="cp-btn cp-btn--primary cp-btn--block" onClick={onClose}>Seguir eligiendo</button>
            </footer>
          </>
        ) : (
          <form onSubmit={submit} className="cp-drawer-form">
            <header className="cp-drawer-head">
              <h2 id="contacto-carrito" className="cp-drawer-title">¿Guardamos tu carrito?</h2>
              <button type="button" className="cp-btn cp-btn--icon" onClick={onClose} aria-label="Cerrar sin guardar"><XIcon name="close" size={20} /></button>
            </header>
            <div className="cp-drawer-body">
              <p className="cp-drawer-lead">Guardalo con tu nombre y WhatsApp o correo para retomarlo desde otro dispositivo. Sin crear una cuenta.</p>
              <div className="cp-fields cp-form-stack">
                <TextField label="Nombre y apellido" required size="full" value={name} onChange={setName} minLength={2} maxLength={120} autoComplete="name" autoFocus />
                <PhoneField label="WhatsApp" size="full" value={phone} onChange={setPhone} />
                <EmailField label="Correo" size="full" value={email} onChange={setEmail} hint="Con el WhatsApp o el correo alcanza." />
              </div>
              <input className="cp-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
              {error ? <p className="cp-error" role="alert">{error}</p> : null}
            </div>
            <footer className="cp-drawer-foot">
              <p className="cp-legal">Usamos tus datos solo para guardar tu carrito. Para enviar el pedido igual te los pedimos.</p>
              <div className="cp-stack-actions">
                <button type="submit" className="cp-btn cp-btn--primary" disabled={busy}>{busy ? "Guardando…" : "Guardar mi carrito"}</button>
                <button type="button" className="cp-btn cp-btn--ghost" onClick={onClose}>Seguir sin datos</button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
