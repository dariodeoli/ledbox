import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSignatureImage, loadSignaturePortal, SignatureActionError } from "@/lib/server/signature/portal";
import { PortalPrintBar } from "../../../_components/PortalPrintBar";
import { PortalCardTitle } from "../../../_components/PortalCardTitle";
import { SignatureDocumentSheet, SignatureDocumentUnavailable } from "../../../_components/SignatureDocumentSheet";
import { SignatureSealBlock } from "../../../_components/SignatureSealBlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Documento firmado", robots: { index: false, follow: false } };

/**
 * Documento imprimible del portal de firma (issue #79): la hoja que el cliente
 * guarda como PDF con el documento y la constancia de firma. Con adjunto PDF se
 * muestra el original embebido; con presupuesto se dibuja la representación
 * canónica completa. Incluye el sello de tiempo y las huellas.
 */
export default async function FirmaDocumentoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  let request;
  try { request = await loadSignaturePortal(codigo); }
  catch (error) {
    if (error instanceof SignatureActionError && error.status === 409) return <SignatureDocumentUnavailable message={error.message} />;
    throw error;
  }
  if (!request) notFound();
  const image = await loadSignatureImage(codigo);

  return (
    <div className="portal-signature-print">
      <PortalPrintBar backHref={`/firma/${encodeURIComponent(request.code)}`} />

      <header className="portal-signature-print-head">
        <p className="portal-kicker">
          {request.organizationName} · Solicitud de firma {request.code}
        </p>
        <h1 className="portal-budget-title">{request.title}</h1>
        <p className="portal-budget-meta">
          {request.statusLabel}
          {request.signedAt ? ` · ${request.signedAt.slice(0, 10)}` : ""}
        </p>
      </header>

      {request.document.kind === "attachment" && request.urls.attachment ? (
        <section className="portal-card portal-print-hide">
          <PortalCardTitle icon="budgets">Documento original</PortalCardTitle>
          <iframe className="portal-signature-pdf" src={request.urls.attachment} title={`Documento ${request.document.name}`} />
          <div className="portal-form-actions">
            <a className="portal-btn portal-btn--sm" href={request.urls.attachment} target="_blank" rel="noreferrer">
              Abrir el documento original
            </a>
          </div>
        </section>
      ) : null}

      {request.budget ? <SignatureDocumentSheet document={request.budget} /> : null}

      <SignatureSealBlock request={request} image={image} />

      <div className="portal-form-actions portal-print-hide">
        <a className="portal-btn" href={`/firma/${encodeURIComponent(request.code)}/auditoria`}>
          Ver la auditoría completa
        </a>
      </div>
    </div>
  );
}
