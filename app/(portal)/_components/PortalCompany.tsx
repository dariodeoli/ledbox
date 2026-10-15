import type { CSSProperties, ReactNode } from "react";
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

export function PortalCompanyInfo({ company }: { company: PortalCompany | null | undefined }) {
  const profile = company?.profile;
  if (!company || !profile) return null;
  const place = locationLine(profile);
  const hours = hoursSummary(profile.hours);
  const handover = HANDOVER_KINDS.filter((kind) => profile.handover[kind].length > 0);
  const methods = acceptedPaymentMethods(profile);
  const { contact, location } = profile;
  const wa = contact.whatsapp ? whatsappHref(contact.whatsapp, `Hola ${company.name}! Consulto por mi presupuesto.`) : null;
  return (
    <section className="portal-card portal-company" aria-labelledby="portal-company" data-testid="portal-company">
      <div className="portal-card-head">
        <h2 id="portal-company" className="portal-card-title">{company.name}</h2>
        <p className="portal-card-lead">Datos de la empresa</p>
      </div>
      <dl className="portal-facts">
        {place || location.mapsUrl ? (
          <div>
            <dt>Dónde estamos</dt>
            <dd>
              {place}{" "}
              {location.mapsUrl ? <a className="portal-link" href={location.mapsUrl} target="_blank" rel="noopener noreferrer">Cómo llegar</a> : null}
            </dd>
          </div>
        ) : null}
        {contact.phone || contact.phone2 || wa ? (
          <div>
            <dt>Teléfonos</dt>
            <dd>
              {[contact.phone, contact.phone2].filter(Boolean).join(" · ")}
              {wa ? <> {" "}<a className="portal-link" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : null}
            </dd>
          </div>
        ) : null}
        {contact.email || contact.website || contact.instagram ? (
          <div>
            <dt>En línea</dt>
            <dd>
              {contact.email ? <a className="portal-link" href={`mailto:${contact.email}`}>{contact.email}</a> : null}
              {contact.website ? <> {" "}<a className="portal-link" href={contact.website} target="_blank" rel="noopener noreferrer">{contact.website.replace(/^https?:\/\//, "")}</a></> : null}
              {contact.instagram ? <> {" "}<a className="portal-link" href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noopener noreferrer">@{contact.instagram}</a></> : null}
            </dd>
          </div>
        ) : null}
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
    </section>
  );
}
