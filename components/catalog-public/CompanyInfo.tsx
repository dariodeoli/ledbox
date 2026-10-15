import { whatsappHref } from "@/lib/admin-format";
import {
  HANDOVER_KINDS,
  HANDOVER_LABEL,
  acceptedPaymentMethods,
  hoursSummary,
  locationLine,
  rangesLabel,
  type OrgProfile,
} from "@/lib/org-profile";

/**
 * Perfil de la empresa para el público, en tarjetas con icono: ubicación con «Cómo llegar», teléfonos uno por línea con
 * botón para llamar, WhatsApp destacado con el color de marca, correo, web e Instagram, horarios en tabla, entrega/retiro,
 * medios de pago como chips y condiciones en un bloque plegable. Solo dibuja lo que la empresa cargó: nada se inventa.
 * Todo con tokens de la plantilla (`--cp-*`). Componente de servidor.
 */

type IconName = "pin" | "phone" | "clock" | "truck" | "card" | "doc" | "mail" | "chat" | "globe" | "instagram";
const ICONS: Record<IconName, string> = {
  pin: "M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  doc: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  mail: "M3 6h18v12H3zM3 7l9 7 9-7",
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9S14.5 18.4 12 21c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.2 6.8h.01",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="cp-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

function InfoCard({ icon, title, children, wide }: { icon: IconName; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? "cp-icard cp-icard--wide" : "cp-icard"} aria-label={title}>
      <h4 className="cp-icard-title"><span className="cp-icard-ico"><Icon name={icon} /></span>{title}</h4>
      {children}
    </section>
  );
}

export function CompanyInfo({ profile, headingId = "empresa-info", whatsapp: whatsappUrl = null, email = null }: { profile: OrgProfile; headingId?: string; whatsapp?: string | null; email?: string | null }) {
  const place = locationLine(profile);
  const hours = hoursSummary(profile.hours);
  const handover = HANDOVER_KINDS.filter((kind) => profile.handover[kind].length > 0);
  const methods = acceptedPaymentMethods(profile);
  const { contact, location } = profile;
  const wa = whatsappUrl ?? (contact.whatsapp ? whatsappHref(contact.whatsapp, "Hola! Quiero consultar por un alquiler.") : null);
  const phones = [contact.phone, contact.phone2].filter((phone): phone is string => Boolean(phone));
  const mail = email ?? contact.email;
  const online = Boolean(mail || contact.website || contact.instagram);
  return (
    <div className="cp-info" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="cp-h3 cp-h3--plain">Sobre la empresa</h3>
      <div className="cp-icards">
        {wa || phones.length > 0 || online ? (
          <InfoCard icon="chat" title="Escribinos o llamanos">
            {wa ? <a className="cp-btn cp-btn--primary cp-btn--block" href={wa} target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a> : null}
            {phones.length > 0 ? (
              <ul className="cp-plain cp-lines">
                {phones.map((phone) => (
                  <li key={phone}>
                    <span className="cp-line-text cp-nowrap">{phone}</span>
                    <a className="cp-btn cp-btn--small" href={`tel:${phone.replace(/[^+\d]/g, "")}`} aria-label={`Llamar al ${phone}`}>Llamar</a>
                  </li>
                ))}
              </ul>
            ) : null}
            {online ? (
              <ul className="cp-plain cp-lines">
                {mail ? <li><Icon name="mail" /><a className="cp-link cp-wrap" href={`mailto:${mail}`}>{mail}</a></li> : null}
                {contact.website ? <li><Icon name="globe" /><a className="cp-link cp-wrap" href={contact.website} target="_blank" rel="noopener noreferrer">{contact.website.replace(/^https?:\/\//, "")}</a></li> : null}
                {contact.instagram ? <li><Icon name="instagram" /><a className="cp-link cp-wrap" href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noopener noreferrer">@{contact.instagram}</a></li> : null}
              </ul>
            ) : null}
          </InfoCard>
        ) : null}
        {place || location.mapsUrl ? (
          <InfoCard icon="pin" title="Dónde estamos">
            <p className="cp-icard-text">{place ?? "Ubicación en el mapa"}</p>
            {location.mapsUrl ? <a className="cp-btn" href={location.mapsUrl} target="_blank" rel="noopener noreferrer">Cómo llegar</a> : null}
          </InfoCard>
        ) : null}
        {hours.length > 0 ? (
          <InfoCard icon="clock" title="Horario de atención">
            <table className="cp-hours">
              <tbody>
                {hours.map((line) => (
                  <tr key={line.days}><th scope="row">{line.days}</th><td className="cp-nowrap">{line.text}</td></tr>
                ))}
              </tbody>
            </table>
          </InfoCard>
        ) : null}
        {handover.length > 0 ? (
          <InfoCard icon="truck" title="Entrega, retiro y devolución">
            <table className="cp-hours">
              <tbody>
                {handover.map((kind) => (
                  <tr key={kind}><th scope="row">{HANDOVER_LABEL[kind]}</th><td className="cp-nowrap">{rangesLabel(profile.handover[kind])}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="cp-hint">Horarios habituales; se coordinan al confirmar el pedido.</p>
          </InfoCard>
        ) : null}
        {methods.length > 0 ? (
          <InfoCard icon="card" title="Medios de pago">
            <ul className="cp-plain cp-chips">
              {methods.map((method) => <li key={method} className="cp-x-chip">{method}</li>)}
            </ul>
          </InfoCard>
        ) : null}
        {profile.conditions ? (
          <InfoCard icon="doc" title="Condiciones" wide>
            <details className="cp-fold">
              <summary>Ver las condiciones</summary>
              <p className="cp-pre">{profile.conditions}</p>
            </details>
          </InfoCard>
        ) : null}
      </div>
    </div>
  );
}
