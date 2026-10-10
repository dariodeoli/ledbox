import { formatDate, formatDayKey, formatMoney, formatNumber, invoiceTaxTypeLabel } from "@/lib/admin-format";
import { formatPercent } from "@/lib/field-rules";
import type { SignatureBudgetDocument } from "@/lib/server/signature/document";

export function SignatureDocumentUnavailable({ message }: { message: string }) {
  return <section className="portal-card" role="alert"><h1 className="portal-budget-title">Documento original no disponible</h1><p>{message}</p></section>;
}

/**
 * Documento firmable del portal (issue #79): la representación imprimible del
 * presupuesto tal como la ve el cliente —título, partes, ítems con precio de
 * venta, totales y plan de pagos—, sin costos internos ni datos de gestión.
 * Es la misma estructura cuya huella canónica se firma cuando no hay adjunto.
 */
export function SignatureDocumentSheet({ document, compact = false }: { document: SignatureBudgetDocument; compact?: boolean }) {
  const plan = document.plan;
  const clientLabel = (document.documentVersion ?? 1) >= 2 ? document.client.displayName : document.client.company?.trim() || document.client.name;
  const hasPlan = plan.advanceAmount > 0 || plan.installments.length > 0 || (document.documentVersion === 3 && document.commercialTerms?.advancePercentBps != null);
  return (
    <article className="portal-signature-sheet" aria-label={`Documento ${document.title}`}>
      <header className="portal-signature-sheet-head">
        <div>
          <p className="portal-kicker">Documento Nº {document.reference}</p>
          <h2 className="portal-signature-sheet-title">{document.title}</h2>
          <p className="portal-budget-meta">
            {document.organizationName} · {clientLabel}
          </p>
        </div>
      </header>

      <dl className="portal-facts">
        <div>
          <dt>Cliente</dt>
          <dd>{clientLabel}</dd>
        </div>
        {(document.documentVersion ?? 1) >= 2 && document.client.legalName ? <div><dt>Razón social</dt><dd>{document.client.legalName}</dd></div> : null}
        <div>
          <dt>Evento</dt>
          <dd>{document.event?.name ?? "Sin evento asociado"}</dd>
        </div>
        <div>
          <dt>Emisión</dt>
          <dd>{formatDate(document.createdAt)}</dd>
        </div>
        <div>
          <dt>Válido hasta</dt>
          <dd>{document.validUntil ? formatDate(document.validUntil) : "Sin fecha de vencimiento"}</dd>
        </div>
        {document.deliveryAt ? (
          <div>
            <dt>Entrega</dt>
            <dd>{formatDate(document.deliveryAt)}</dd>
          </div>
        ) : null}
        {document.ivaType ? (
          <div>
            <dt>IVA</dt>
            <dd>{invoiceTaxTypeLabel(document.ivaType)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="portal-items-wrap">
        <table className="portal-table portal-table--items">
          <caption className="portal-table-caption">Detalle</caption>
          <thead>
            <tr>
              <th scope="col">Producto / servicio</th>
              <th scope="col" className="portal-num">
                Cantidad
              </th>
              <th scope="col" className="portal-num">
                Días
              </th>
              {!compact ? (
                <th scope="col" className="portal-num">
                  Precio unitario
                </th>
              ) : null}
              <th scope="col" className="portal-num">
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody>
            {document.items.map((item, index) => (
              <tr key={`${item.name}-${index}`} data-excluded={item.excluded ? "true" : undefined}>
                <td className="portal-item-cell">
                  <span className="portal-item-name">{item.name}</span>{item.excluded ? <small>Retirado / no incluido</small> : null}
                  {item.notes ? <small className="portal-item-note">{item.notes}</small> : null}
                  {document.documentVersion === 3 && item.commercialTerms ? <>
                    {item.commercialTerms.priceMode ? <small className="portal-item-note">{item.commercialTerms.priceMode === "MANUAL" ? "Precio pactado" : `Tarifa ${item.commercialTerms.tariffSnapshot?.front === "WHOLESALE" ? "mayorista" : "final"}`}</small> : null}
                    {item.commercialTerms.tariffSnapshot ? <small className="portal-item-note">Normal: {formatMoney(item.commercialTerms.tariffSnapshot.normalPrice)}{item.commercialTerms.tariffSnapshot.fromDays > 0 && item.commercialTerms.tariffSnapshot.fromPrice > 0 ? ` · Desde ${item.commercialTerms.tariffSnapshot.fromDays} días: ${formatMoney(item.commercialTerms.tariffSnapshot.fromPrice)}` : ""}</small> : null}
                    {item.commercialTerms.minimumPrice !== null ? <small className="portal-item-note">Piso unitario neto: {formatMoney(item.commercialTerms.minimumPrice)}</small> : null}
                    {item.commercialTerms.discountMode ? <small className="portal-item-note">Descuento de línea{item.commercialTerms.discountMode === "PERCENT" ? ` (${formatPercent(item.commercialTerms.discountValue! / 100)}%)` : ""}: {formatMoney(item.commercialTerms.discountAmount)}</small> : null}
                  </> : null}
                </td>
                <td className="portal-num" data-label="Cantidad">
                  {formatNumber(item.quantity)}
                </td>
                <td className="portal-num" data-label="Días">
                  {formatNumber(item.days)}
                </td>
                {!compact ? (
                  <td className="portal-num" data-label="Precio unitario">
                    {formatMoney(item.unitPrice)}
                  </td>
                ) : null}
                <td className="portal-num" data-label="Subtotal">
                  {formatMoney(item.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="portal-totals">
        {document.documentVersion === 3 && document.commercialTerms?.discountMode ? <p className="portal-help">Descuento global: {document.commercialTerms.discountMode === "PERCENT" ? `${formatPercent(document.commercialTerms.discountValue! / 100)}%` : formatMoney(document.commercialTerms.discountValue)}</p> : null}
        <div className="portal-total-row">
          <span>Subtotal</span>
          <span>{formatMoney(document.subtotal)}</span>
        </div>
        {document.discount > 0 ? (
          <div className="portal-total-row">
            <span>Descuento</span>
            <span>− {formatMoney(document.discount)}</span>
          </div>
        ) : null}
        <div className="portal-total-row portal-total-row--strong">
          <span>Total</span>
          <span>{formatMoney(document.total)}</span>
        </div>
      </div>

      {hasPlan ? (
        <div className="portal-signature-plan">
          <h3 className="portal-card-title">Plan de pagos</h3>
          {document.documentVersion === 3 && document.commercialTerms?.advancePercentBps != null ? <p className="portal-help">Seña automática: {formatPercent(document.commercialTerms.advancePercentBps / 100)}% del total</p> : null}
          <ul className="portal-signature-plan-list">
            {plan.advanceAmount > 0 ? (
              <li>
                <strong>Anticipo</strong>
                <span>{formatMoney(plan.advanceAmount)}</span>
              </li>
            ) : null}
            {plan.installments.map((installment, index) => (
              <li key={`${installment.label}-${index}`}>
                <strong>{installment.label}</strong>
                <span>
                  {formatMoney(installment.amount)}
                  {installment.dueAt ? ` · ${formatDayKey(installment.dueAt)}` : ""}
                   {(document.documentVersion ?? 1) >= 2 && installment.moment ? ` · ${installment.moment}` : ""}
                </span>
              </li>
            ))}
            {plan.pending > 0 ? (
              <li>
                <strong>Saldo sin fecha</strong>
                <span>{formatMoney(plan.pending)}</span>
              </li>
            ) : null}
          </ul>
          {document.paymentTerms ? <p className="portal-help">{document.paymentTerms}</p> : null}
        </div>
      ) : null}

      {document.warranty || document.notes ? (
        <div className="portal-signature-notes">
          {document.warranty ? (
            <p className="portal-note">
              <strong>Garantía: </strong>
              {document.warranty}
            </p>
          ) : null}
          {document.notes ? <p className="portal-note">{document.notes}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
