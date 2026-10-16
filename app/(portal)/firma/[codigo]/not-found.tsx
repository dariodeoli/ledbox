import Link from "next/link";
import { PortalSupportLink } from "@/app/(portal)/_components/PortalSupportLink";

/** 404 del portal de firma (issue #79): código inválido o inexistente. */
export default function FirmaNotFound() {
  return (
    <section className="portal-hero" aria-labelledby="firma-404">
      <p className="portal-kicker">Firma de documentos</p>
      <h1 className="portal-title" id="firma-404">
        No encontramos esa solicitud de firma<span aria-hidden="true">.</span>
      </h1>
      <p className="portal-lead">
        El código puede estar mal escrito o el link ya no existe. Revisá el enlace que te compartieron o escribinos por
        WhatsApp al <PortalSupportLink /> y te enviamos uno nuevo.
      </p>
      <Link className="portal-btn portal-btn--primary" href="/portal">
        Volver al portal
      </Link>
    </section>
  );
}
