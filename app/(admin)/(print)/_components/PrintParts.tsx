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
  issuedAt,
  meta,
  logo,
}: {
  title: string;
  reference: string | null;
  organization: string;
  issuedAt: string;
  meta?: string | null;
  /** Logo de la empresa (issue #22): en papel siempre la variante clara; `null` deja el monograma `LB`. */
  logo?: string | null;
}) {
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
          <span className="lbprint-company">{organization}</span>
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
