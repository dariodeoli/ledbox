"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatGs, type BillingUnit, type Product } from "@/lib/catalog";
import { whatsappUrl } from "@/lib/public-config";

type CartItem = { product: Product; quantity: number; duration: number };

export function CartDrawer({ items, onChange, onQuote }: { items: CartItem[]; onChange: (items: CartItem[]) => void; onQuote: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const grouped = useMemo(() => items.reduce<Record<string, number>>((acc, item) => { const key = item.product.unit; acc[key] = (acc[key] || 0) + item.product.price * item.quantity * (item.product.unit === "event" ? 1 : item.duration); return acc; }, {}), [items]);
  const total = Object.values(grouped).reduce((sum, value) => sum + value, 0);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const update = (id: string, patch: Partial<CartItem>) => onChange(items.map(item => item.product.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => onChange(items.filter(item => item.product.id !== id));
  const quoteText = items.length ? `Hola LedBox! Quiero cotizar este pedido:\n${items.map(item => `- ${item.quantity} × ${item.product.name}${item.product.unit === "event" ? "" : ` · ${item.duration} ${item.duration === 1 ? "día" : "días"}`} (${item.product.unitLabel})`).join("\n")}\n\nReferencia: ${formatGs(total)}\n\nPrecios de lista sujetos a confirmación según duración, cantidad, combinación, instalación y necesidades del evento.` : "Hola LedBox! Quiero consultar disponibilidad para mi evento.";
  const quoteUrl = whatsappUrl(quoteText);

  return <>
    <button ref={triggerRef} className={`cart-trigger${count ? " has-items" : ""}`} type="button" aria-expanded={open} aria-controls="cart-panel" onClick={() => setOpen(true)}>
      Pedido <span aria-live="polite">{count}</span>
    </button>
    <div className={`cart-backdrop${open ? " open" : ""}`} aria-hidden="true" onClick={() => setOpen(false)} />
    <aside id="cart-panel" className={`cart-panel${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="cart-title" aria-hidden={!open} inert={!open}>
      <div className="cart-head"><strong id="cart-title">Tu pedido</strong><button ref={closeRef} className="cart-close" type="button" aria-label="Cerrar pedido" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>×</button></div>
      <p className="cart-helper">Ajustá cantidades y días. Después enviamos la consulta por WhatsApp.</p>
      <div className="cart-items">
        {!items.length && <p className="f-note">Agregá productos para preparar tu cotización.</p>}
        {items.map(item => <div className="cart-item" key={item.product.id}>
          <div><strong>{item.product.name}</strong><small>{formatGs(item.product.price)} · {item.product.unitLabel}</small>
            <div className="cart-controls"><label>Cantidad <input type="number" min="1" max="99" value={item.quantity} onChange={e => update(item.product.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></label>
              {item.product.unit !== "event" && <label>Días <input type="number" min="1" max="90" value={item.duration} onChange={e => update(item.product.id, { duration: Math.max(1, Number(e.target.value) || 1) })} /></label>}
            </div>
          </div><button className="cart-remove" type="button" aria-label={`Quitar ${item.product.name}`} onClick={() => remove(item.product.id)}>×</button>
        </div>)}
      </div>
      {items.length > 0 && <>
        <div className="cart-breakdown">{Object.entries(grouped).map(([unit, value]) => <div key={unit}><span>{unitLabel(unit as BillingUnit)}</span><strong>{formatGs(value)}</strong></div>)}</div>
        <div className="cart-total"><span>Referencia</span><span>{formatGs(total)}</span></div>
        <p className="cart-disclaimer">Precio de lista referencial. Puede variar por días, cantidad, equipos iguales o distintos, combo, traslado e instalación.</p>
        <a className="cart-quote" href={quoteUrl} target="_blank" rel="noopener noreferrer" onClick={onQuote}>Cotizar por WhatsApp <span aria-hidden="true">→</span></a>
      </>}
    </aside>
  </>;
}
function unitLabel(unit: BillingUnit) { return unit === "sqm-day" ? "m² / día" : unit === "day" ? "Por día" : "Por evento"; }
export type { CartItem };
