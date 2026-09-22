import { faqs } from "@/lib/structured-data";

/**
 * Preguntas frecuentes reales del negocio (issue #38): el mismo listado que
 * emite el `FAQPage` de la landing, visible para las personas y para Google.
 */
export function PublicFaq() {
  return (
    <section id="faq" aria-labelledby="faq-title">
      <div className="sec-head">
        <div>
          <div className="sec-kicker">Antes de consultar</div>
          <h2 id="faq-title" className="sec-title rise">Preguntas<span className="led">.</span></h2>
        </div>
        <p className="sec-desc rise">Lo que más nos preguntan sobre equipos, precios y cobertura. Si queda algo suelto, escribinos.</p>
      </div>
      <div className="faq-grid">
        {faqs.map(faq => (
          <article className="faq-item" key={faq.question}>
            <h3>{faq.question}</h3>
            <p>{faq.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
