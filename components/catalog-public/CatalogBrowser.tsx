"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AVAILABILITY_HINT_LABEL,
  estimatedSubtotal,
  formatDayKey,
  referenceDailyPrice,
  type AvailabilityHint,
} from "@/lib/catalog-public";
import { whatsappHref } from "@/lib/admin-format";

/**
 * Catálogo público de una empresa y armado de la preorden (sin cuenta).
 * La preorden NO es una reserva: la pantalla final lo dice con todas las letras.
 */

export type CatalogItemView = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  imageUrl: string | null;
  price: { listPrice: number; listFromDays: number; listFromPrice: number } | null;
  availability: AvailabilityHint | null;
};

type Props = {
  slug: string;
  organizationName: string;
  whatsappPhone: string | null;
  showPrices: boolean;
  demo: boolean;
  items: CatalogItemView[];
  range: { fromKey: string; toKey: string; days: number } | null;
};

type Done =
  | { kind: "saved"; respondBy: string; trackingPath: string; whatsappUrl: string | null }
  | { kind: "simulated"; message: string };

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;
const respondFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const AVAILABILITY_TONE: Record<AvailabilityHint, string> = { AVAILABLE: "cp-chip--ok", LOW: "cp-chip--warn", CONSULT: "cp-chip--muted" };

function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts;
}

function Placeholder() {
  return (
    <svg className="cp-ph" viewBox="0 0 64 48" role="img" aria-label="Sin foto" focusable="false">
      <rect x="6" y="6" width="52" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M24 42h16M32 36v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CatalogBrowser({ slug, organizationName, whatsappPhone, showPrices, demo, items, range }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(range?.fromKey ?? "");
  const [to, setTo] = useState(range?.toKey ?? "");
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const today = useMemo(todayKey, []);

  const visible = useMemo(() => {
    const needle = norm(query.trim());
    return needle ? items.filter((item) => norm(`${item.name} ${item.sku ?? ""} ${item.category}`).includes(needle)) : items;
  }, [items, query]);
  const groups = useMemo(() => {
    const map = new Map<string, CatalogItemView[]>();
    for (const item of visible) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [visible]);

  const days = range?.days ?? 1;
  const chosen = items.filter((item) => (selection[item.id] ?? 0) > 0);
  const lines = chosen.map((item) => ({
    name: item.name,
    quantity: selection[item.id],
    unitPrice: item.price ? referenceDailyPrice(item.price, days) || null : null,
  }));
  const subtotal = showPrices && range ? estimatedSubtotal(lines, days) : null;
  const count = chosen.reduce((sum, item) => sum + (selection[item.id] ?? 0), 0);

  function applyDates(event: FormEvent) {
    event.preventDefault();
    if (!from || !to) return;
    router.replace(`${pathname}?desde=${encodeURIComponent(from)}&hasta=${encodeURIComponent(to)}`, { scroll: false });
  }
  function setQuantity(id: string, next: number) {
    setSelection((current) => {
      const copy = { ...current };
      if (next <= 0) delete copy[id];
      else copy[id] = Math.min(99, next);
      return copy;
    });
  }

  const contact = whatsappHref(whatsappPhone, `Hola ${organizationName}! Quiero consultar por el catálogo de alquiler.`);

  return (
    <main className="cp-main">
      <header className="cp-header">
        <p className="cp-eyebrow">Catálogo de alquiler</p>
        <h1 className="cp-h1">{organizationName}</h1>
        <p className="cp-lead">Elegí los equipos y las fechas. Te respondemos con una cotización: el pedido no es una reserva hasta que la confirmemos.</p>
        {demo ? <p className="cp-note" role="note">Esto es una demo con datos de ejemplo: los pedidos no se guardan.</p> : null}
        {contact ? (
          <a className="cp-link" href={contact} target="_blank" rel="noopener noreferrer">
            Consultar por WhatsApp
          </a>
        ) : null}
      </header>

      <section className="cp-card" aria-labelledby="fechas">
        <h2 id="fechas" className="cp-h2">1. Fechas del alquiler</h2>
        <form className="cp-row" onSubmit={applyDates}>
          <label className="cp-field">
            <span>Desde</span>
            <input type="date" value={from} min={today} onChange={(event) => { setFrom(event.target.value); if (to && event.target.value > to) setTo(event.target.value); }} required />
          </label>
          <label className="cp-field">
            <span>Hasta</span>
            <input type="date" value={to} min={from || today} onChange={(event) => setTo(event.target.value)} required />
          </label>
          <button className="cp-btn" type="submit">Ver disponibilidad</button>
        </form>
        <p className="cp-hint">
          {range
            ? `Período: ${formatDayKey(range.fromKey)} al ${formatDayKey(range.toKey)} (${range.days} ${range.days === 1 ? "día" : "días"}). La disponibilidad es indicativa: la confirmamos al cotizar.`
            : "Elegí las fechas para ver la disponibilidad indicativa de cada equipo."}
        </p>
      </section>

      <section aria-labelledby="equipos">
        <div className="cp-row cp-row--between">
          <h2 id="equipos" className="cp-h2">2. Equipos</h2>
          <label className="cp-field cp-field--search">
            <span className="cp-sr">Buscar equipos</span>
            <input type="search" placeholder="Buscar por nombre, SKU o categoría" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        {items.length === 0 ? <p className="cp-empty">Todavía no hay equipos publicados en este catálogo.</p> : null}
        {items.length > 0 && visible.length === 0 ? <p className="cp-empty">No encontramos equipos con «{query}».</p> : null}
        {groups.map(([category, rows]) => (
          <section key={category} className="cp-group" aria-label={category}>
            <h3 className="cp-h3">{category}</h3>
            <ul className="cp-grid">
              {rows.map((item) => {
                const unit = item.price && range ? referenceDailyPrice(item.price, days) : item.price ? referenceDailyPrice(item.price, 1) : 0;
                const quantity = selection[item.id] ?? 0;
                return (
                  <li key={item.id} className="cp-item">
                    <div className="cp-photo">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt={item.name} loading="lazy" />
                      ) : (
                        <Placeholder />
                      )}
                    </div>
                    <div className="cp-item-body">
                      <h4 className="cp-item-name">{item.name}</h4>
                      {item.sku ? <p className="cp-sku">SKU {item.sku}</p> : null}
                      <p className="cp-price">
                        {showPrices && unit > 0 ? (<><strong>{money(unit)}</strong> <span>por día</span></>) : "Consultar"}
                      </p>
                      {item.availability ? (
                        <p><span className={`cp-chip ${AVAILABILITY_TONE[item.availability]}`}>{AVAILABILITY_HINT_LABEL[item.availability]}</span></p>
                      ) : null}
                      {quantity > 0 ? (
                        <div className="cp-qty" role="group" aria-label={`Cantidad de ${item.name}`}>
                          <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity(item.id, quantity - 1)} aria-label={`Quitar una unidad de ${item.name}`}>−</button>
                          <output aria-live="polite">{quantity}</output>
                          <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity(item.id, quantity + 1)} aria-label={`Agregar una unidad de ${item.name}`}>+</button>
                        </div>
                      ) : (
                        <button type="button" className="cp-btn" onClick={() => setQuantity(item.id, 1)} aria-label={`Agregar ${item.name} al pedido`}>Agregar al pedido</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>

      {count > 0 ? (
        <aside className="cp-bar" aria-label="Tu pedido">
          <p>
            <strong>{count} {count === 1 ? "equipo" : "equipos"}</strong>
            {showPrices ? <span> · {subtotal !== null ? `Subtotal estimado ${money(subtotal)}` : range ? "Subtotal a cotizar" : "Elegí fechas para estimar"}</span> : null}
          </p>
          <button type="button" className="cp-btn cp-btn--primary" onClick={() => { setDone(null); setOpen(true); }}>
            Pedir cotización
          </button>
        </aside>
      ) : null}

      {open ? (
        <PreorderDialog
          slug={slug}
          organizationName={organizationName}
          range={range}
          lines={chosen.map((item) => ({ id: item.id, name: item.name, quantity: selection[item.id] }))}
          subtotal={subtotal}
          showPrices={showPrices}
          done={done}
          onDone={setDone}
          onClose={() => setOpen(false)}
          onFinish={() => { setSelection({}); setOpen(false); setDone(null); }}
        />
      ) : null}
    </main>
  );
}

function PreorderDialog(props: {
  slug: string;
  organizationName: string;
  range: Props["range"];
  lines: Array<{ id: string; name: string; quantity: number }>;
  subtotal: number | null;
  showPrices: boolean;
  done: Done | null;
  onDone: (done: Done) => void;
  onClose: () => void;
  onFinish: () => void;
}) {
  const { slug, range, lines, subtotal, showPrices, done } = props;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    first.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
      if (event.key === "Tab" && dialog.current) {
        const nodes = [...dialog.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([tabindex='-1']),textarea,select")];
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === firstNode) { event.preventDefault(); lastNode.focus(); }
        else if (!event.shiftKey && document.activeElement === lastNode) { event.preventDefault(); firstNode.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!range) { setError("Elegí las fechas del alquiler antes de enviar el pedido."); return; }
    setError("");
    const payload = {
      name, phone, email, location, notes,
      from: range.fromKey, to: range.toKey,
      items: lines.map((line) => ({ inventoryId: line.id, quantity: line.quantity })),
      website: trap,
    };
    const serialized = JSON.stringify(payload);
    // La misma clave solo se reutiliza para reenviar EXACTAMENTE el mismo pedido.
    if (!attempt.current || attempt.current.payload !== serialized) attempt.current = { key: crypto.randomUUID(), payload: serialized };
    setBusy(true);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(slug)}/preorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key },
        body: serialized,
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 429) { setError("Hiciste muchos intentos seguidos. Esperá unos minutos y volvé a probar."); return; }
      if (!response.ok) { setError(typeof data.error === "string" && data.error !== "Invalid request." ? data.error : "Revisá tus datos: algún campo no es válido."); return; }
      if (data.simulated === true) { props.onDone({ kind: "simulated", message: String(data.message ?? "Esto es una demo: no se guardó nada.") }); return; }
      const preorder = data.preorder as { respondBy: string; trackingPath: string; whatsappUrl: string | null };
      props.onDone({ kind: "saved", respondBy: preorder.respondBy, trackingPath: preorder.trackingPath, whatsappUrl: preorder.whatsappUrl });
    } catch {
      setError("No pudimos enviar el pedido. Revisá tu conexión y reintentá: no se duplica.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className="cp-dialog" role="dialog" aria-modal="true" aria-labelledby="pedido-titulo" ref={dialog}>
        {done ? (
          <div className="cp-done" data-testid="preorder-done">
            {done.kind === "saved" ? (
              <>
                <h2 id="pedido-titulo" className="cp-h2">Recibimos tu pedido</h2>
                <p>
                  Recibimos tu pedido. <strong>Todavía NO es una reserva confirmada</strong>: te respondemos antes de{" "}
                  <strong>{respondFormat.format(new Date(done.respondBy))}</strong>.
                </p>
                <p className="cp-hint">Podés seguirlo en cualquier momento con este link (guardalo):</p>
                <p><a className="cp-link" href={done.trackingPath}>{done.trackingPath}</a></p>
                {done.whatsappUrl ? (
                  <a className="cp-btn cp-btn--primary" href={done.whatsappUrl} target="_blank" rel="noopener noreferrer">
                    Enviar el resumen por WhatsApp
                  </a>
                ) : null}
              </>
            ) : (
              <>
                <h2 id="pedido-titulo" className="cp-h2">Demo: no se guardó nada</h2>
                <p>{done.message}</p>
              </>
            )}
            <button type="button" className="cp-btn" onClick={props.onFinish}>Cerrar</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate={false}>
            <h2 id="pedido-titulo" className="cp-h2">Tu pedido a {props.organizationName}</h2>
            {!range ? <p className="cp-error" role="alert">Elegí las fechas del alquiler antes de enviar el pedido.</p> : (
              <p className="cp-hint">Del {formatDayKey(range.fromKey)} al {formatDayKey(range.toKey)} ({range.days} {range.days === 1 ? "día" : "días"})</p>
            )}
            <ul className="cp-list">
              {lines.map((line) => (<li key={line.id}>{line.quantity} × {line.name}</li>))}
            </ul>
            {showPrices ? <p><strong>{subtotal !== null ? `Subtotal estimado: ${money(subtotal)}` : "Subtotal: a cotizar"}</strong> <span className="cp-hint">(referencia, no incluye traslado ni instalación)</span></p> : null}
            <label className="cp-field"><span>Nombre y apellido</span><input ref={first} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>
            <label className="cp-field"><span>WhatsApp</span><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required minLength={6} maxLength={40} autoComplete="tel" placeholder="+595 981 000 000" /></label>
            <label className="cp-field"><span>Correo</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} autoComplete="email" /></label>
            <label className="cp-field"><span>Lugar del evento</span><input value={location} onChange={(e) => setLocation(e.target.value)} required minLength={2} maxLength={240} autoComplete="street-address" /></label>
            <label className="cp-field"><span>Comentarios (opcional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} /></label>
            <input className="cp-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
            <p className="cp-hint">Al enviar aceptás que usemos estos datos solo para responder tu pedido. No es una reserva: te confirmamos disponibilidad y precio.</p>
            {error ? <p className="cp-error" role="alert">{error}</p> : null}
            <div className="cp-row">
              <button type="submit" className="cp-btn cp-btn--primary" disabled={busy || !range}>{busy ? "Enviando…" : "Enviar pedido"}</button>
              <button type="button" className="cp-btn" onClick={props.onClose}>Seguir eligiendo</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
