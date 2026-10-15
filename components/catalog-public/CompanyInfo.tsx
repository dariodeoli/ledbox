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
 * Perfil de la empresa para el público: contacto, ubicación con «Cómo llegar», horario de
 * atención, horarios de entrega/retiro/devolución, medios de pago aceptados y condiciones.
 * Solo dibuja lo que la empresa cargó: nada se inventa. Componente de servidor.
 */
export function CompanyInfo({ profile, headingId = "empresa-info" }: { profile: OrgProfile; headingId?: string }) {
  const place = locationLine(profile);
  const hours = hoursSummary(profile.hours);
  const handover = HANDOVER_KINDS.filter((kind) => profile.handover[kind].length > 0);
  const methods = acceptedPaymentMethods(profile);
  const { contact, location } = profile;
  const wa = contact.whatsapp ? whatsappHref(contact.whatsapp, "Hola! Quiero consultar por un alquiler.") : null;
  return (
    <div className="cp-info" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="cp-h3 cp-h3--plain">Sobre la empresa</h3>
      <dl className="cp-dl cp-info-grid">
        {place || location.mapsUrl ? (
          <div>
            <dt>Dónde estamos</dt>
            <dd>
              {place ?? "Ubicación en el mapa"}
              {location.mapsUrl ? (
                <>
                  {" "}
                  <a className="cp-btn cp-btn--small" href={location.mapsUrl} target="_blank" rel="noopener noreferrer">Cómo llegar</a>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        {contact.phone || contact.phone2 || wa ? (
          <div>
            <dt>Teléfonos</dt>
            <dd>
              {[contact.phone, contact.phone2].filter(Boolean).map((phone) => (
                <span key={phone} className="cp-nowrap"><a className="cp-link" href={`tel:${phone!.replace(/[^+\d]/g, "")}`}>{phone}</a>{" "}</span>
              ))}
              {wa ? <a className="cp-link" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp {contact.whatsapp}</a> : null}
            </dd>
          </div>
        ) : null}
        {contact.email || contact.website || contact.instagram ? (
          <div>
            <dt>En línea</dt>
            <dd>
              {contact.email ? <><a className="cp-link" href={`mailto:${contact.email}`}>{contact.email}</a>{" "}</> : null}
              {contact.website ? <><a className="cp-link" href={contact.website} target="_blank" rel="noopener noreferrer">{contact.website.replace(/^https?:\/\//, "")}</a>{" "}</> : null}
              {contact.instagram ? <a className="cp-link" href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noopener noreferrer">@{contact.instagram}</a> : null}
            </dd>
          </div>
        ) : null}
        {hours.length > 0 ? (
          <div>
            <dt>Horario de atención</dt>
            <dd>
              <ul className="cp-plain">
                {hours.map((line) => (
                  <li key={line.days}><span>{line.days}:</span> <span className="cp-nowrap">{line.text}</span></li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {handover.length > 0 ? (
          <div>
            <dt>Entrega, retiro y devolución</dt>
            <dd>
              <ul className="cp-plain">
                {handover.map((kind) => (
                  <li key={kind}><span>{HANDOVER_LABEL[kind]}:</span> <span className="cp-nowrap">{rangesLabel(profile.handover[kind])}</span></li>
                ))}
              </ul>
              <span className="cp-hint">Horarios habituales; se coordinan al confirmar el pedido.</span>
            </dd>
          </div>
        ) : null}
        {methods.length > 0 ? (
          <div>
            <dt>Medios de pago</dt>
            <dd>{methods.join(" · ")}</dd>
          </div>
        ) : null}
        {profile.conditions ? (
          <div>
            <dt>Condiciones</dt>
            <dd className="cp-pre">{profile.conditions}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
