import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyInfo } from "@/components/catalog-public/CompanyInfo";
import { ProposalActions } from "@/components/catalog-public/ProposalActions";
import { StoreChrome } from "@/components/catalog-public/StoreChrome";
import { QUOTE_ITEM_STATE_LABEL, QUOTE_REQUEST_PUBLIC_COPY, formatDayKey, isQuoteItemState, isQuoteRequestStatus, preorderWhatsappUrl, quoteItemActive } from "@/lib/catalog-public";
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
  const proposed = order.status === "PROPOSED";
  const whatsapp = preorderWhatsappUrl(order.organization.whatsappPhone, `Hola ${order.organization.name}! Consulto por mi pedido del catálogo.`);
  return (
    <StoreChrome theme={order.organization.theme} appearance={order.organization.appearance}>
    <main className="cp-main cp-narrow">
      <header className="cp-header">
        <p className="cp-eyebrow">{order.organization.name}{order.priceList === "WHOLESALE" ? " · Pedido mayorista" : ""}</p>
        <h1 className="cp-h1">Seguimiento de tu pedido</h1>
      </header>
      <section className="cp-card" aria-labelledby="estado">
        <h2 id="estado" className="cp-h2">
          Estado: <span className="cp-badge">{copy.label}</span>
        </h2>
        <p>{copy.detail}</p>
        {order.decline ? (
          <p data-testid="decline-reason">
            <strong>{order.decline.by === "CLIENT" ? "Tu respuesta" : "Motivo de la empresa"}:</strong> {order.decline.reason ?? "Sin motivo informado."}
          </p>
        ) : null}
        {order.proposal?.note && (proposed || order.status === "APPROVED") ? (
          <p data-testid="proposal-note"><strong>Mensaje de {order.organization.name}:</strong> {order.proposal.note}</p>
        ) : null}
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
        <h3 className="cp-h3">{order.proposal ? (proposed ? "Propuesta de la empresa" : "Artículos del pedido") : "Artículos pedidos"}</h3>
        <ul className="cp-list">
          {order.items.map((item, index) => {
            const state = isQuoteItemState(item.state) ? item.state : "KEEP";
            const active = quoteItemActive(state);
            const changed = state !== "KEEP";
            return (
              <li key={`${item.name}-${index}`} className="cp-proposal-line" data-state={state}>
                {active ? (
                  <span>{item.quantity} × {item.name}</span>
                ) : (
                  <s>{item.originalQuantity ?? item.quantity} × {item.originalName ?? item.name}</s>
                )}
                {changed ? (
                  <span className={`cp-tag ${active ? "cp-tag--warn" : "cp-tag--muted"}`}>
                    {QUOTE_ITEM_STATE_LABEL[state]}
                    {state === "CHANGED" && item.originalQuantity ? ` (pediste ${item.originalQuantity})` : ""}
                    {state === "SUBSTITUTED" && item.originalName ? ` (en lugar de ${item.originalName})` : ""}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {proposed ? <ProposalActions token={token} /> : null}
        {whatsapp ? (
          <a className="cp-btn cp-btn--primary" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Escribir por WhatsApp
          </a>
        ) : null}
        {order.priceList === "RETAIL" ? (
          <a className="cp-link" href={`/tienda/${encodeURIComponent(order.organization.slug)}`}>Volver a la tienda</a>
        ) : null}
      </section>
      {order.organization.profile ? (
        <section className="cp-card" aria-label="Datos de la empresa"><CompanyInfo profile={order.organization.profile} headingId="pedido-empresa" /></section>
      ) : null}
    </main>
    </StoreChrome>
  );
}
