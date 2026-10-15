import type { CSSProperties, ReactNode } from "react";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { whatsappHref } from "@/lib/admin-format";
import {
  HANDOVER_KINDS,
  HANDOVER_LABEL,
  acceptedPaymentMethods,
  hoursSummary,
  locationLine,
  rangesLabel,
} from "@/lib/org-profile";
import { portalBrandVars, type PortalCompany } from "@/lib/portal-company";

/**
 * Marca y perfil de la empresa en el portal del cliente. `PortalBrandScope` viste el portal con el
 * color de marca de la empresa (en el tono que corresponde al tema claro u oscuro) y su tipografía;
 * `PortalCompanyInfo` muestra contacto, ubicación con «Cómo llegar», horarios, medios de pago y
 * condiciones. Solo lo que la empresa cargó. Componentes de servidor, sin estado.
 */
export function PortalBrandScope({ company, children }: { company: PortalCompany | null | undefined; children: ReactNode }) {
  const vars = portalBrandVars(company ?? null);
  return (
    <div className="portal-brandscope" style={vars as CSSProperties} data-branded={company?.brand ? "true" : undefined}>
      {company?.fontHref ? <link rel="stylesheet" href={company.fontHref} /> : null}
      {children}
    </div>
  );
}

/** Cómo llegar: el link de Maps de la empresa o, si no hay, una búsqueda de Google Maps con su dirección. */
export function companyMapsHref(mapsUrl: string | null | undefined, place: string | null | undefined): string | null {
  if (mapsUrl && /^https?:\/\//i.test(mapsUrl)) return mapsUrl;
  const query = (place ?? "").trim();
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

/** `+595 981 123456` -> `+595981123456` para `tel:`. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function PortalCompanyInfo({ company, reference }: { company: PortalCompany | null | undefined; reference?: string }) {
  const profile = company?.profile;
  if (!company || !profile) return null;
  const place = locationLine(profile);
  const hours = hoursSummary(profile.hours);
  const handover = HANDOVER_KINDS.filter((kind) => profile.handover[kind].length > 0);
  const methods = acceptedPaymentMethods(profile);
  const { contact, location } = profile;
  const waMessage = reference ? `Hola ${company.name}! Te escribo por el presupuesto Nº ${reference}.` : `Hola ${company.name}! Consulto por mi presupuesto.`;
  const wa = contact.whatsapp ? whatsappHref(contact.whatsapp, waMessage) : null;
  const maps = companyMapsHref(location.mapsUrl, place);
  const phones = [contact.phone, contact.phone2].filter((phone): phone is string => Boolean(phone));
  const hasContact = Boolean(wa || maps || phones.length > 0 || contact.email || contact.instagram || contact.website);
  const hasFacts = hours.length > 0 || handover.length > 0 || methods.length > 0 || Boolean(profile.conditions);
  return (
    <section className="portal-card portal-company" aria-labelledby="portal-company" data-testid="portal-company">
      <div className="portal-card-head">
        <h2 id="portal-company" className="portal-card-title">{company.name}</h2>
        <p className="portal-card-lead">{hasContact ? "Escribinos o visitanos: te atendemos con gusto." : "Datos de la empresa"}</p>
      </div>
      {wa || maps ? (
        <div className="portal-contact-actions portal-print-hide">
          {wa ? (
            <a className="portal-btn portal-btn--primary" href={wa} target="_blank" rel="noopener noreferrer">
              <AdminIcon name="whatsapp" size={17} />
              Escribir por WhatsApp
            </a>
          ) : null}
          {maps ? (
            <a className="portal-btn" href={maps} target="_blank" rel="noopener noreferrer">
              <AdminIcon name="map-pin" size={17} />
              Cómo llegar
            </a>
          ) : null}
        </div>
      ) : null}
      {hasContact || place ? (
        <ul className="portal-contact-list">
          {place ? (
            <li>
              <AdminIcon name="map-pin" size={17} />
              <span>{place}</span>
            </li>
          ) : null}
          {phones.map((phone) => (
            <li key={phone}>
              <AdminIcon name="phone" size={17} />
              <a className="portal-link" href={telHref(phone)}>{phone}</a>
            </li>
          ))}
          {contact.email ? (
            <li>
              <AdminIcon name="mail" size={17} />
              <a className="portal-link" href={`mailto:${contact.email}`}>{contact.email}</a>
            </li>
          ) : null}
          {contact.instagram ? (
            <li>
              <AdminIcon name="instagram" size={17} />
              <a className="portal-link" href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noopener noreferrer">@{contact.instagram}</a>
            </li>
          ) : null}
          {contact.website ? (
            <li>
              <AdminIcon name="globe" size={17} />
              <a className="portal-link" href={contact.website} target="_blank" rel="noopener noreferrer">{contact.website.replace(/^https?:\/\//, "")}</a>
            </li>
          ) : null}
        </ul>
      ) : null}
      {hasFacts ? (
      <dl className="portal-facts">
        {hours.length > 0 ? (
          <div>
            <dt>Horario de atención</dt>
            <dd>{hours.map((line) => `${line.days}: ${line.text}`).join(" · ")}</dd>
          </div>
        ) : null}
        {handover.length > 0 ? (
          <div>
            <dt>Entrega, retiro y devolución</dt>
            <dd>{handover.map((kind) => `${HANDOVER_LABEL[kind]}: ${rangesLabel(profile.handover[kind])}`).join(" · ")}</dd>
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
            <dd style={{ whiteSpace: "pre-line" }}>{profile.conditions}</dd>
          </div>
        ) : null}
      </dl>
      ) : null}
    </section>
  );
}
