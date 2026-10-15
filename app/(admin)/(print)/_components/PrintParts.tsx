import {
  HANDOVER_KINDS,
  HANDOVER_LABEL,
  acceptedPaymentMethods,
  hoursSummary,
  locationLine,
  profileHasData,
  rangesLabel,
  type OrgProfile,
} from "@/lib/org-profile";
import { publicConfig } from "@/lib/public-config";

/**
 * Partes compartidas de los documentos imprimibles: encabezado con la marca del
 * panel y datos de la empresa, campos etiquetados y pie. Solo presentación: los
 * datos llegan resueltos desde cada página (server-side, filtrados por empresa).
 *
 * Issue #22: si la empresa subió su logo, el encabezado usa la variante **clara**
 * (el papel es fondo blanco) servida con sesión; sin logo queda el monograma LB.
 */

export function PrintHeader({
  title,
  reference,
  organization,
  companyName,
  companyLegal,
  issuedAt,
  meta,
  logo,
}: {
  title: string;
  reference: string | null;
  organization: string;
  /**
   * Nombre fantasía del emisor (issue #116): va grande como nombre principal de
   * la hoja. Sin él se muestra el nombre de la organización como siempre.
   */
  companyName?: string | null;
  /** Línea legal debajo del nombre (razón social y RUC); opcional. */
  companyLegal?: string | null;
  issuedAt: string;
  meta?: string | null;
  /** Logo de la empresa (issue #22): en papel siempre la variante clara; `null` deja el monograma `LB`. */
  logo?: string | null;
}) {
  const name = companyName?.trim() || organization;
  const legal = companyLegal?.trim() || null;
  return (
    <header className="lbprint-head">
      <div className="lbprint-brand">
        {logo ? (
          <img className="lbprint-logo" src={logo} alt="" aria-hidden="true" />
        ) : (
          <span className="lbprint-mark" aria-hidden="true">
            LB
          </span>
        )}
        <span className="lbprint-brand-text">
          <span className="lbprint-wordmark">
            LEDBOX<span>.</span>
          </span>
          <span className={companyName?.trim() ? "lbprint-company-name" : "lbprint-company"}>{name}</span>
          {legal ? <span className="lbprint-company-legal">{legal}</span> : null}
        </span>
      </div>
      <div className="lbprint-head-doc">
        <h1 className="lbprint-doc-title">{title}</h1>
        {reference ? <p className="lbprint-doc-reference">{reference}</p> : null}
        <p className="lbprint-doc-meta">
          Emitido el {issuedAt}
          {meta ? ` · ${meta}` : ""}
        </p>
      </div>
    </header>
  );
}

export function PrintField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <p className={wide ? "lbprint-field lbprint-field--wide" : "lbprint-field"}>
      <span className="lbprint-label">{label}</span>
      <span className="lbprint-value">{value}</span>
    </p>
  );
}

export function PrintSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="lbprint-section">
      <header className="lbprint-section-head">
        <h2 className="lbprint-section-title">{title}</h2>
        {action ? <span className="lbprint-section-action">{action}</span> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Datos de la empresa en la hoja impresa: contacto, ubicación (con el link de Maps escrito, que
 * en papel no se toca pero se puede escanear o teclear), horario, entrega/retiro/devolución,
 * medios de pago aceptados y condiciones comerciales. Solo lo que la empresa cargó.
 */
export function PrintCompanyInfo({ profile }: { profile: OrgProfile }) {
  if (!profileHasData(profile)) return null;
  const { contact, location } = profile;
  const place = locationLine(profile);
  const hours = hoursSummary(profile.hours);
  const methods = acceptedPaymentMethods(profile);
  const handover = HANDOVER_KINDS.filter((kind) => profile.handover[kind].length > 0);
  const phones = [contact.phone, contact.phone2, contact.whatsapp ? `${contact.whatsapp} (WhatsApp)` : null].filter(Boolean).join(" · ");
  return (
    <PrintSection title="Datos de la empresa">
      <div className="lbprint-grid" data-testid="print-company-info">
        {place ? <PrintField label="Dirección" value={place} wide /> : null}
        {location.mapsUrl ? <PrintField label="Cómo llegar" value={location.mapsUrl} wide /> : null}
        {phones ? <PrintField label="Teléfonos" value={phones} /> : null}
        {contact.email ? <PrintField label="Correo" value={contact.email} /> : null}
        {contact.website ? <PrintField label="Web" value={contact.website.replace(/^https?:\/\//, "")} /> : null}
        {contact.instagram ? <PrintField label="Instagram" value={`@${contact.instagram}`} /> : null}
        {hours.length > 0 ? <PrintField label="Horario de atención" value={hours.map((line) => `${line.days}: ${line.text}`).join(" · ")} wide /> : null}
        {handover.length > 0 ? <PrintField label="Entrega, retiro y devolución" value={handover.map((kind) => `${HANDOVER_LABEL[kind]}: ${rangesLabel(profile.handover[kind])}`).join(" · ")} wide /> : null}
        {methods.length > 0 ? <PrintField label="Medios de pago aceptados" value={methods.join(" · ")} wide /> : null}
        {profile.conditions ? <PrintField label="Condiciones" value={profile.conditions} wide /> : null}
      </div>
    </PrintSection>
  );
}

export function PrintEmpty({ children }: { children: React.ReactNode }) {
  return <p className="lbprint-empty">{children}</p>;
}

/** Monto alineado a la derecha, sin decimales (PYG). */
export function PrintAmount({ children }: { children: React.ReactNode }) {
  return <td className="lbprint-num">{children}</td>;
}

export function PrintFooter({ note }: { note?: string | null }) {
  const site = publicConfig.siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return (
    <footer className="lbprint-foot">
      <span>
        {site} · Documento generado desde el panel de LedBox
      </span>
      {note ? <span>{note}</span> : null}
    </footer>
  );
}
