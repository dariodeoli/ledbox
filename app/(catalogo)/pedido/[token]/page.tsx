import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QUOTE_REQUEST_PUBLIC_COPY, formatDayKey, isQuoteRequestStatus, preorderWhatsappUrl } from "@/lib/catalog-public";
import { loadPublicOrder } from "@/lib/server/catalog-public";
import { dayKeyOf } from "@/lib/server/notifications";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Seguimiento de tu pedido" },
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });

/**
 * Seguimiento de una preorden (`/pedido/<token>`): solo lectura. Muestra lo que la
 * persona pidió y el estado honesto; nunca ids, notas, costos ni datos del equipo.
 */
export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await loadPublicOrder(token);
  if (!order) notFound();
  const copy = QUOTE_REQUEST_PUBLIC_COPY[isQuoteRequestStatus(order.status) ? order.status : "NEW"];
  const open = order.status === "NEW" || order.status === "REVIEWING";
  const whatsapp = preorderWhatsappUrl(order.organization.whatsappPhone, `Hola ${order.organization.name}! Consulto por mi pedido del catálogo.`);
  return (
    <main className="cp-main cp-narrow">
      <header className="cp-header">
        <p className="cp-eyebrow">{order.organization.name}</p>
        <h1 className="cp-h1">Seguimiento de tu pedido</h1>
      </header>
      <section className="cp-card" aria-labelledby="estado">
        <h2 id="estado" className="cp-h2">
          Estado: <span className="cp-badge">{copy.label}</span>
        </h2>
        <p>{copy.detail}</p>
        {open && order.respondBy ? (
          <p>
            Te respondemos antes del <strong>{dateTime.format(new Date(order.respondBy))}</strong>.
          </p>
        ) : null}
        <dl className="cp-dl">
          {order.startsAt && order.endsAt ? (
            <div>
              <dt>Fechas</dt>
              <dd>
                {formatDayKey(dayKeyOf(new Date(order.startsAt)))} al {formatDayKey(dayKeyOf(new Date(order.endsAt)))}
              </dd>
            </div>
          ) : null}
          {order.location ? (
            <div>
              <dt>Lugar</dt>
              <dd>{order.location}</dd>
            </div>
          ) : null}
          <div>
            <dt>Subtotal estimado</dt>
            <dd>{order.subtotal ? `Gs. ${gs.format(order.subtotal)} (referencia, sujeto a cotización)` : "A cotizar"}</dd>
          </div>
        </dl>
        <h3 className="cp-h3">Artículos pedidos</h3>
        <ul className="cp-list">
          {order.items.map((item) => (
            <li key={`${item.name}-${item.quantity}`}>
              {item.quantity} × {item.name}
            </li>
          ))}
        </ul>
        {whatsapp ? (
          <a className="cp-btn cp-btn--primary" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Escribir por WhatsApp
          </a>
        ) : null}
      </section>
    </main>
  );
}
