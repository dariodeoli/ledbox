"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { DayField, NumberField, SelectField } from "@/components/admin/AdminFields";
import { MAX_RENTAL_DAYS, dayLabel, rangeFromEvent, todayKeyPY } from "@/lib/storefront-ui";

/**
 * Selector de evento: «Fecha del evento», «Días de alquiler» e «Invitados» (opcional, solo de referencia: NO filtra),
 * con «Ver disponibilidad». Aparece en el héroe, arriba del catálogo, en la ficha y dentro del pedido. Las fechas viven
 * en la dirección (`?desde=&hasta=`, así el servidor calcula la disponibilidad) y se recuerdan en la sesión del
 * navegador para aplicarlas en toda la tienda. Con `onApply` (el pedido) se aplican sin navegar.
 */

type Range = { fromKey: string; toKey: string; days: number };
const SESSION_KEY = (slug: string) => `ledbox-store-dates:${slug.trim().toLowerCase()}`;

function readSession(slug: string): { from: string; days: number; guests: string } | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY(slug));
    const value = raw ? (JSON.parse(raw) as { from?: unknown; days?: unknown; guests?: unknown }) : null;
    if (!value || typeof value.from !== "string" || typeof value.days !== "number") return null;
    return { from: value.from, days: value.days, guests: typeof value.guests === "string" ? value.guests : "" };
  } catch {
    return null;
  }
}

export function EventPicker({ slug, range, variant = "hero", restore = false, onApply, title, emptyNote }: {
  slug: string;
  range: Range | null;
  variant?: "hero" | "bar" | "panel" | "drawer";
  /** Si la dirección no trae fechas, aplica las de la sesión del navegador (si no pasaron). */
  restore?: boolean;
  onApply?: (range: Range) => void;
  title?: string;
  /** Texto cuando todavía no hay fechas. */
  emptyNote?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const today = todayKeyPY();
  const [from, setFrom] = useState(range?.fromKey ?? "");
  const [days, setDays] = useState(String(range?.days ?? 1));
  const [guests, setGuests] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (range) { setFrom(range.fromKey); setDays(String(Math.min(range.days, MAX_RENTAL_DAYS))); }
  }, [range?.fromKey, range?.toKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const saved = readSession(slug);
    if (saved) setGuests(saved.guests);
    if (!restore || range || !saved || saved.from < today) return;
    const next = rangeFromEvent(saved.from, saved.days);
    if (next) apply(next.fromKey, saved.days, saved.guests);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(fromKey: string, dayCount: number, guestText: string) {
    const next = rangeFromEvent(fromKey, dayCount);
    if (!next) { setMessage("Elegí la fecha del evento y cuántos días lo necesitás."); return; }
    try { window.sessionStorage.setItem(SESSION_KEY(slug), JSON.stringify({ from: fromKey, days: dayCount, guests: guestText })); } catch { /* sin almacenamiento */ }
    setMessage("");
    const full = { fromKey: next.fromKey, toKey: next.toKey, days: dayCount };
    if (onApply) { onApply(full); return; }
    const params = new URLSearchParams(window.location.search);
    params.set("desde", next.fromKey);
    params.set("hasta", next.toKey);
    const hash = variant === "panel" ? window.location.hash : "#catalogo";
    router.replace(`${pathname}?${params.toString()}${hash}`, { scroll: false });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply(from, Number(days), guests);
  }

  const current = range ? `Del ${dayLabel(range.fromKey)} al ${dayLabel(range.toKey)} · ${range.days} ${range.days === 1 ? "día" : "días"}. La disponibilidad es indicativa: la confirmamos al cotizar.` : "";
  // Dentro del pedido (que ya es un formulario) no se anida otro: es un grupo con su botón.
  const embedded = variant === "drawer";
  const Root = embedded ? "div" : "form";
  return (
    <Root className="cp-event cp-fields" data-variant={variant} {...(embedded ? { role: "group" } : { onSubmit: submit })} aria-label={title ?? "Fecha del evento"} data-testid="event-picker">
      <div className="cp-event-fields">
        <div className="cp-event-date"><AdminIcon name="calendar" size={18} /><DayField label="Fecha del evento" value={from} min={today} size="full" required onChange={(value) => { setFrom(value); setMessage(""); }} /></div>
        <SelectField label="Días de alquiler" value={days} size="full" onChange={setDays} options={Array.from({ length: MAX_RENTAL_DAYS }, (_, index) => ({ value: String(index + 1), label: `${index + 1} ${index === 0 ? "día" : "días"}` }))} />
        <NumberField label="Invitados (opcional)" value={guests} size="full" maxLength={5} placeholder="Ej.: 80" onChange={(value) => setGuests(value.replace(/\D/g, ""))} />
        {variant !== "drawer" && variant !== "panel" ? <button className="cp-btn cp-btn--primary cp-event-go" type="submit">Ver disponibilidad</button> : null}
      </div>
      {variant === "drawer" || variant === "panel" ? <button className="cp-btn cp-btn--block" type={embedded ? "button" : "submit"} onClick={embedded ? () => apply(from, Number(days), guests) : undefined}>Aplicar fechas</button> : null}
      <p className="cp-event-note" role={message ? "alert" : undefined}>
        {message || current || (emptyNote ?? "Elegí la fecha para ver la disponibilidad indicativa de cada producto.")} Los invitados son solo de referencia.
      </p>
    </Root>
  );
}
