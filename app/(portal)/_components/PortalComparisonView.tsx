"use client";
import { Checkbox as SharedCheckbox, Input as SharedInput } from "owncoding-ui";

import { useState } from "react";
import { RadioControl } from "@/components/admin/AdminFields";
import type { PublicQuoteComparison } from "@/lib/server/quote-comparison-view";
import { formatMoney, formatDate } from "@/lib/admin-format";
import { AdminImageBox } from "@/components/admin/AdminImageBox";

export function PortalComparisonView({ initial, token }: { initial: PublicQuoteComparison; token: string }) {
  const [group, setGroup] = useState(initial);
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function approve(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/portal/comparison/${encodeURIComponent(token)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetId: choice, name, consent }) });
      const data = await response.json();
      if (!response.ok || !data.comparison) { setError(data.error || "No pudimos registrar la elección. Actualizá la página."); return; }
      setGroup(data.comparison);
    } catch { setError("No pudimos conectar. Revisá tu conexión e intentá nuevamente."); }
    finally { setBusy(false); }
  }
  const lowest = Math.min(...group.alternatives.map((q) => q.total));
  return <div className="portal-comparison">
    <header className="portal-card"><p className="portal-comparison-company">Propuesta de {group.company.name}</p><h1>{group.title}</h1><p>Compará las alternativas y aprobá solamente una. Válido hasta {formatDate(group.expiresAt)}.</p></header>
    {group.selectedBudgetId ? <section className="portal-card" role="status"><h2>Alternativa elegida</h2><p>{group.alternatives.find((q) => q.id === group.selectedBudgetId)?.label}. La elección quedó registrada; las demás alternativas no pueden aprobarse.</p></section> : null}
    <form onSubmit={approve}>
      <fieldset className="portal-comparison-choices"><legend>Elegí una alternativa</legend>
      {!group.selectedBudgetId ? <div className="portal-comparison-selector" aria-label="Selector de alternativas">
        {group.alternatives.map((quote, index) => <label className="portal-comparison-selector-option" key={quote.id}>
          <RadioControl name="alternative" value={quote.id} checked={choice === quote.id} onChange={() => setChoice(quote.id)} disabled={busy} required />
          <span><strong>{String.fromCharCode(65 + index)}</strong><span>{quote.label}</span></span>
        </label>)}
      </div> : null}
      <div className="portal-comparison-grid">
        {group.alternatives.map((quote) => <section className="portal-card portal-comparison-option" key={quote.id} aria-labelledby={`alternative-${quote.id}`}>
          <h2 id={`alternative-${quote.id}`}>{quote.label}</h2><p>{quote.title}</p>
          <strong className="portal-comparison-total">{formatMoney(quote.total)}</strong>
          <p>{quote.total === lowest ? "Menor total" : `${formatMoney(quote.total - lowest)} más que la alternativa de menor total`}</p>
          <dl><dt>Subtotal</dt><dd>{formatMoney(quote.subtotal)}</dd><dt>Descuento</dt><dd>{formatMoney(quote.discount)}</dd><dt>Anticipo</dt><dd>{formatMoney(quote.advanceAmount)}</dd></dl>
          <h3>Ítems incluidos</h3>
          <ul className="portal-comparison-items">{quote.items.map((item) => <li key={item.id} data-excluded={item.excluded ? "true" : undefined}>
            <AdminImageBox imageUrl={item.imageUrl} size={56} />
            <div><strong className="portal-item-name">{item.name}</strong>{item.excluded ? <p>Retirado / no incluido</p> : null}<p>{item.quantity} × {item.days} día(s) · {formatMoney(item.unitPrice)}</p>{item.notes ? <p>{item.notes}</p> : null}<strong>{formatMoney(item.subtotal)}</strong></div>
          </li>)}</ul>
          <h3>Condiciones</h3>
          <dl><dt>Vigencia</dt><dd>{quote.validUntil ? formatDate(quote.validUntil) : "Sin fecha indicada"}</dd><dt>Entrega</dt><dd>{quote.deliveryAt ? formatDate(quote.deliveryAt) : "A coordinar"}</dd><dt>IVA</dt><dd>{quote.ivaType || "Sin especificar"}</dd><dt>Garantía</dt><dd>{quote.warranty || "Sin especificar"}</dd></dl>
          {quote.paymentTerms ? <p>{quote.paymentTerms}</p> : null}{quote.notes ? <p>{quote.notes}</p> : null}
          {quote.installments.map((part, i) => <p key={i}>{part.label}: {formatMoney(part.amount)} {part.dueAt ? formatDate(part.dueAt) : ""}</p>)}
          {quote.attachments.length || quote.referenceLinks.length ? <h3>Documentos y referencias</h3> : null}
          {quote.attachments.map((file) => <div className="portal-quote-resource" key={file.id}><strong>{file.name}</strong><a href={`${quote.resourcePath}/pdf/${file.id}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ver PDF</a><a href={`${quote.resourcePath}/pdf/${file.id}?download=1`} referrerPolicy="no-referrer">Descargar</a></div>)}
          {quote.referenceLinks.map((link, i) => <p key={i}><a href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link.label} ↗</a></p>)}
        </section>)}
      </div>
      </fieldset>
      {!group.selectedBudgetId ? <section className="portal-card">
        <h2>Confirmar una alternativa</h2>
        <label className="portal-field">Nombre y apellido<SharedInput value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={120} required disabled={busy} autoComplete="name" /></label>
        <SharedCheckbox className="portal-comparison-select" checked={consent} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setConsent(event.target.checked)} required disabled={busy} label="Confirmo que apruebo únicamente la alternativa elegida y sus condiciones." />
        <button className="portal-btn" disabled={busy || !choice || !consent}>{busy ? "Registrando…" : "Aprobar alternativa elegida"}</button>
      </section> : null}
      {error ? <p className="portal-card" role="alert">{error}</p> : null}
    </form>
  </div>;
}
