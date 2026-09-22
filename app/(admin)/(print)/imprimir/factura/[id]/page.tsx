import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { formatDate, formatDateTime, formatMoney, formatNumber, invoiceConditionLabel, invoiceStatusLabel, invoiceTaxTypeLabel } from "@/lib/admin-format";
import { invoiceNumberLabel } from "@/lib/fiscal";
import { organizationLogoUrl } from "@/lib/admin-types";
import { loadOrganizationLogos } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { parseFiscalDetails } from "@/lib/server/fiscal";
import { requireAdminContext } from "@/lib/server/tenancy";
import { PrintAmount, PrintEmpty, PrintField, PrintFooter, PrintHeader, PrintSection } from "../../../_components/PrintParts";
import { PrintToolbar } from "../../../_components/PrintToolbar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Factura (registro interno)", robots: { index: false, follow: false } };

/**
 * Comprobante imprimible del registro fiscal interno (issue #41).
 *
 * Solo lectura y filtrado por la empresa activa: una factura de otra empresa no
 * existe para esta sesión (`notFound`). La hoja lleva la **leyenda honesta** de
 * que no es una factura electrónica de SIFEN/DNIT (ver `docs/FISCAL-SIFEN.md`) y,
 * si está anulada, el sello con el motivo.
 *
 * Los datos fiscales del emisor salen de `Organization.fiscalDetails` (los carga
 * OWNER/ADMIN); si faltan, se dice en la hoja — nunca se completa con otro dato.
 */
export default async function FacturaImprimiblePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) redirect("/login");
  const { id } = await params;

  const invoice = await db.invoice.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: {
      items: { orderBy: { id: "asc" } },
      client: { select: { id: true, name: true, company: true } },
      budget: { select: { id: true, title: true } },
      event: { select: { id: true, name: true } },
      organization: { select: { fiscalDetails: true } },
    },
  });
  if (!invoice) notFound();

  const fiscal = parseFiscalDetails(invoice.organization.fiscalDetails);
  const issuedAt = formatDate(invoice.issuedAt);
  const reference = `Nº ${invoiceNumberLabel(invoice.number)}`;
  // En papel siempre el logo claro (issue #22); sin logo queda el monograma LB.
  const logos = await loadOrganizationLogos(auth.context.organizationId);
  const logo = logos.light ? organizationLogoUrl("light", logos.light.updatedAt) : null;
  const totalIva = invoice.iva10 + invoice.iva5;

  return (
    <>
      <PrintToolbar backHref="/facturacion" backLabel="Volver a Facturación" />

      <article className="lbprint-sheet lbprint-sheet--fiscal" aria-label={`Factura de registro interno ${reference}`}>
        {invoice.status === "VOID" ? <span className="lbprint-stamp" aria-hidden="true">Anulada</span> : null}

        <PrintHeader
          title="Factura · registro interno"
          reference={reference}
          organization={auth.context.organization.name}
          issuedAt={issuedAt}
          meta={`Estado: ${invoiceStatusLabel(invoice.status)} · ${invoiceConditionLabel(invoice.condition)}`}
          logo={logo}
        />

        <p className="lbprint-legal">
          <strong>No es una factura electrónica</strong>
          Este documento es el registro fiscal interno de {fiscal.razonSocial || auth.context.organization.name}. No fue
          emitido por SIFEN/DNIT ni tiene validez fiscal como comprobante electrónico: no incluye CDC, KuDE ni firma
          digital. Para respaldar el crédito fiscal del receptor hace falta el comprobante electrónico autorizado.
        </p>

        <PrintSection title="Emisor">
          <div className="lbprint-grid">
            <PrintField label="Razón social" value={fiscal.razonSocial || "Sin cargar en el panel"} />
            <PrintField label="RUC" value={fiscal.ruc || "Sin cargar en el panel"} />
            <PrintField label="Timbrado" value={fiscal.timbrado || "Sin timbrado autorizado"} />
            <PrintField label="Establecimiento" value={fiscal.establecimiento || "—"} />
            <PrintField label="Dirección" value={fiscal.direccion || "—"} wide />
          </div>
        </PrintSection>

        <PrintSection title="Receptor">
          <div className="lbprint-grid">
            <PrintField label="Razón social" value={invoice.clientName} />
            <PrintField label="RUC / CI" value={invoice.clientRuc || "Consumidor final"} />
            <PrintField label="Cliente del panel" value={invoice.client ? invoice.client.company?.trim() || invoice.client.name : "Sin cliente vinculado"} wide />
          </div>
        </PrintSection>

        <PrintSection title="Comprobante">
          <div className="lbprint-grid">
            <PrintField label="Número" value={reference} />
            <PrintField label="Emisión" value={formatDate(invoice.issuedAt)} />
            <PrintField label="Condición" value={invoiceConditionLabel(invoice.condition)} />
            <PrintField label="Vencimiento" value={invoice.dueAt ? formatDate(invoice.dueAt) : "Contado"} />
            <PrintField label="Presupuesto" value={invoice.budget?.title || "Sin presupuesto asociado"} />
            <PrintField label="Evento" value={invoice.event?.name || "Sin evento asociado"} />
          </div>
        </PrintSection>

        <PrintSection title="Detalle">
          {invoice.items.length === 0 ? (
            <PrintEmpty>Esta factura no tiene ítems cargados.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Producto / servicio</th>
                  <th scope="col" className="lbprint-num">
                    Cantidad
                  </th>
                  <th scope="col" className="lbprint-num">
                    Precio unitario
                  </th>
                  <th scope="col">IVA</th>
                  <th scope="col" className="lbprint-num">
                    Importe
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="lbprint-num">{formatNumber(item.quantity)}</td>
                    <td className="lbprint-num">{formatMoney(item.unitPrice)}</td>
                    <td>
                      {invoiceTaxTypeLabel(item.taxType)}
                      <span className="lbprint-label"> · IVA {formatMoney(item.taxAmount)}</span>
                    </td>
                    <td className="lbprint-num">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total de la factura</td>
                  <PrintAmount>{formatMoney(invoice.total)}</PrintAmount>
                </tr>
              </tfoot>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Liquidación de IVA">
          <div className="lbprint-totals">
            <div className="lbprint-total-row">
              <span>Gravada 10 %</span>
              <span className="lbprint-num">{formatMoney(invoice.taxable10)}</span>
            </div>
            <div className="lbprint-total-row">
              <span>IVA 10 %</span>
              <span className="lbprint-num">{formatMoney(invoice.iva10)}</span>
            </div>
            <div className="lbprint-total-row">
              <span>Gravada 5 %</span>
              <span className="lbprint-num">{formatMoney(invoice.taxable5)}</span>
            </div>
            <div className="lbprint-total-row">
              <span>IVA 5 %</span>
              <span className="lbprint-num">{formatMoney(invoice.iva5)}</span>
            </div>
            <div className="lbprint-total-row">
              <span>Exenta</span>
              <span className="lbprint-num">{formatMoney(invoice.exempt)}</span>
            </div>
            <div className="lbprint-total-row">
              <span>IVA total</span>
              <span className="lbprint-num">{formatMoney(totalIva)}</span>
            </div>
            <div className="lbprint-total-row lbprint-total-row--strong">
              <span>Total</span>
              <span className="lbprint-num">{formatMoney(invoice.total)}</span>
            </div>
          </div>
          <p className="lbprint-note">
            Los importes son brutos (IVA incluido) y se desagregan con redondeo medio hacia arriba a nivel de línea: la
            base más el IVA siempre suman el importe. Moneda: guaraníes (PYG), sin decimales.
          </p>
        </PrintSection>

        <PrintSection title="Estado">
          <div className="lbprint-grid">
            <PrintField label="Estado" value={invoiceStatusLabel(invoice.status)} />
            <PrintField label="Saldada el" value={invoice.paidAt ? formatDate(invoice.paidAt) : "—"} />
            <PrintField label="Emitida por" value={`${invoice.createdByName} · ${formatDateTime(invoice.createdAt)}`} />
            {invoice.status === "VOID" ? (
              <>
                <PrintField label="Anulada por" value={invoice.voidedByName || "—"} />
                <PrintField label="Fecha de anulación" value={formatDateTime(invoice.voidedAt)} />
                <PrintField label="Motivo de anulación" value={invoice.voidReason || "Sin motivo registrado"} wide />
              </>
            ) : null}
            <PrintField label="Notas" value={invoice.notes || "Sin notas adicionales."} wide />
          </div>
          {invoice.status === "VOID" ? (
            <p className="lbprint-note">
              La factura {reference} queda anulada con su número y su motivo: el número no se reutiliza y la anulación
              está auditada en el panel.
            </p>
          ) : null}
        </PrintSection>

        <PrintFooter note={`Registro fiscal interno · ${reference}`} />
      </article>
    </>
  );
}
