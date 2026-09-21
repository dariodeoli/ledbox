import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  budgetApprovalMethodLabel,
  budgetReference,
  budgetStatusLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
} from "@/lib/admin-format";
import { portalBudgetUrl, publicConfig } from "@/lib/public-config";
import { qrSvg } from "@/lib/qr";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { PrintAmount, PrintEmpty, PrintField, PrintFooter, PrintHeader, PrintSection } from "../../../_components/PrintParts";
import { PrintToolbar } from "../../../_components/PrintToolbar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Presupuesto", robots: { index: false, follow: false } };

/**
 * Presupuesto imprimible (PDF vía `window.print()`).
 * Solo lectura y filtrado por la empresa activa: un presupuesto de otra empresa
 * no existe para esta sesión (`notFound`).
 *
 * Issue #12: la hoja suma el QR del portal del cliente con el código visible
 * (solo si el presupuesto tiene link público) y la evidencia de la aprobación
 * cuando ya fue aprobado (digital o manual).
 */
export default async function PresupuestoImprimiblePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) redirect("/login");
  const { id } = await params;

  const budget = await db.budget.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: {
      client: true,
      event: true,
      items: { orderBy: { name: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!budget) notFound();

  const paid = budget.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = budget.total - paid;
  const issuedAt = formatDateTime(budget.createdAt);
  const reference = `Nº ${budgetReference(budget.id)}`;
  const portalUrl = budget.publicToken ? portalBudgetUrl(budget.publicToken) : null;
  const portalQr = portalUrl ? await qrSvg(portalUrl, 168) : null;

  return (
    <>
      <PrintToolbar backHref="/presupuestos" backLabel="Volver a Presupuestos" />

      <article className="lbprint-sheet" aria-label={`Presupuesto ${budget.title}`}>
        <PrintHeader
          title="Presupuesto"
          reference={reference}
          organization={auth.context.organization.name}
          issuedAt={issuedAt}
          meta={`Estado: ${budgetStatusLabel(budget.status)}`}
        />

        <PrintSection title="Cliente">
          <div className="lbprint-grid">
            <PrintField label="Razón social" value={budget.client.company || budget.client.name} />
            <PrintField label="Contacto" value={budget.client.company ? budget.client.name : "—"} />
            <PrintField label="RUC" value={budget.client.ruc || "—"} />
            <PrintField label="Teléfono" value={budget.client.phone || "—"} />
            <PrintField label="Correo" value={budget.client.email || "—"} wide />
          </div>
        </PrintSection>

        <PrintSection title="Evento y vigencia">
          <div className="lbprint-grid">
            <PrintField label="Evento" value={budget.event?.name || "Sin evento asociado"} />
            <PrintField label="Lugar" value={budget.event?.location || "—"} />
            <PrintField label="Inicio" value={budget.event?.startsAt ? formatDateTime(budget.event.startsAt) : "—"} />
            <PrintField label="Válido hasta" value={budget.validUntil ? formatDate(budget.validUntil) : "Sin fecha de vencimiento"} />
            <PrintField label="Título" value={budget.title} wide />
          </div>
        </PrintSection>

        <PrintSection title="Detalle">
          {budget.items.length === 0 ? (
            <PrintEmpty>Este presupuesto no tiene ítems cargados.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Producto / servicio</th>
                  <th scope="col" className="lbprint-num">
                    Cantidad
                  </th>
                  <th scope="col" className="lbprint-num">
                    Días
                  </th>
                  <th scope="col" className="lbprint-num">
                    Precio unitario
                  </th>
                  <th scope="col" className="lbprint-num">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {budget.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="lbprint-num">{formatNumber(item.quantity)}</td>
                    <td className="lbprint-num">{formatNumber(item.days)}</td>
                    <td className="lbprint-num">{formatMoney(item.unitPrice)}</td>
                    <td className="lbprint-num">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Totales">
          <div className="lbprint-totals">
            <div className="lbprint-total-row">
              <span>Subtotal</span>
              <span className="lbprint-num">{formatMoney(budget.subtotal)}</span>
            </div>
            {budget.discount > 0 ? (
              <div className="lbprint-total-row">
                <span>Descuento</span>
                <span className="lbprint-num">− {formatMoney(budget.discount)}</span>
              </div>
            ) : null}
            <div className="lbprint-total-row lbprint-total-row--strong">
              <span>Total</span>
              <span className="lbprint-num">{formatMoney(budget.total)}</span>
            </div>
            {budget.payments.length > 0 ? (
              <>
                <div className="lbprint-total-row">
                  <span>Cobrado</span>
                  <span className="lbprint-num">{formatMoney(paid)}</span>
                </div>
                <div className="lbprint-total-row">
                  <span>Saldo</span>
                  <span className="lbprint-num">{formatMoney(balance)}</span>
                </div>
              </>
            ) : null}
          </div>
        </PrintSection>

        <PrintSection title="Cobros registrados">
          {budget.payments.length === 0 ? (
            <PrintEmpty>Sin cobros registrados a la fecha de emisión.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Método</th>
                  <th scope="col">Referencia</th>
                  <th scope="col" className="lbprint-num">
                    Monto
                  </th>
                </tr>
              </thead>
              <tbody>
                {budget.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDateTime(payment.paidAt)}</td>
                    <td>{payment.method || "—"}</td>
                    <td>{payment.reference || "—"}</td>
                    <td className="lbprint-num">{formatMoney(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total cobrado</td>
                  <PrintAmount>{formatMoney(paid)}</PrintAmount>
                </tr>
              </tfoot>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Condiciones">
          <div className="lbprint-grid">
            <PrintField label="Validez de la oferta" value={budget.validUntil ? `Hasta el ${formatDate(budget.validUntil)}` : "Sin fecha de vencimiento"} />
            <PrintField label="Moneda" value="Guaraníes (PYG), sin decimales" />
            <PrintField label="Notas" value={budget.notes || "Sin notas adicionales."} wide />
          </div>
        </PrintSection>

        {portalUrl && portalQr ? (
          <PrintSection title="Aprobación online">
            <div className="lbprint-portal">
              <div className="lbprint-portal-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: portalQr }} />
              <div className="lbprint-portal-data">
                <p className="lbprint-portal-code">{budget.publicToken}</p>
                <PrintField label="Link del presupuesto" value={portalUrl} wide />
                <p className="lbprint-note">
                  Escaneá el QR o entrá a {publicConfig.clientUrl.replace(/^https?:\/\//, "")} con el código para ver el detalle
                  y aprobar el presupuesto online. El link es personal del cliente y puede revocarse desde el panel.
                </p>
              </div>
            </div>
          </PrintSection>
        ) : null}

        <PrintSection title="Aceptación del cliente">
          {budget.approvedAt ? (
            <>
              <p className="lbprint-note">
                Presupuesto aprobado por {budget.approvedByName || "el cliente"} el {formatDateTime(budget.approvedAt)} (
                {budgetApprovalMethodLabel(budget.approvalMethod).toLowerCase()}).
              </p>
              <div className="lbprint-grid">
                <PrintField label="Aprobado por" value={budget.approvedByName || "—"} />
                <PrintField label="Fecha y hora" value={formatDateTime(budget.approvedAt)} />
                <PrintField label="Vía" value={budgetApprovalMethodLabel(budget.approvalMethod)} />
                {budget.approvalNote ? <PrintField label="Comentario" value={budget.approvalNote} wide /> : null}
              </div>
            </>
          ) : (
            <>
              <p className="lbprint-note">
                La firma de este documento aprueba el detalle, los montos y las condiciones del presupuesto {reference}.
              </p>
              <div className="lbprint-sign">
                <span className="lbprint-sign-box">Firma</span>
                <span className="lbprint-sign-box">Aclaración</span>
                <span className="lbprint-sign-box">Fecha</span>
              </div>
            </>
          )}
          {!budget.approvedAt && budget.revisionRequestedAt ? (
            <p className="lbprint-note">
              El cliente pidió cambios el {formatDateTime(budget.revisionRequestedAt)}: {budget.revisionNote || "sin comentario"}.
            </p>
          ) : null}
        </PrintSection>

        <PrintFooter note={`Presupuesto ${reference}`} />
      </article>
    </>
  );
}
