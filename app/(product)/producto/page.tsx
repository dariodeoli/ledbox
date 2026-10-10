import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { publicConfig } from "@/lib/public-config";
import { PRODUCT_BOOT_SCRIPT, PRODUCT_ROOT_ID } from "@/lib/site-theme";
import { eventosSupportUrl } from "@/lib/legal";

const title = "EventOS · Gestión para empresas de eventos";
const description =
  "EventOS es el sistema de gestión para empresas de alquiler de equipos y producción de eventos: presupuestos con portal de aprobación del cliente, eventos y checklist, inventario, proveedores, finanzas con tesorería y trazabilidad completa. Multiempresa y con auditoría.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: publicConfig.productUrl },
  openGraph: {
    title,
    description,
    url: publicConfig.productUrl,
    siteName: "EventOS",
    type: "website",
    images: [{ url: "/assets/producto/panel-finanzas.jpg", width: 1280, height: 800, alt: "Vista ilustrativa de EventOS: finanzas y tesorería" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/assets/producto/panel-finanzas.jpg"] },
};

const modules = [
  ["Presupuestos y portal", "Cotizá, enviá el link con QR y dejá que el cliente ajuste cantidades, pida rebajas y apruebe online con evidencia."],
  ["Eventos y checklist", "Montaje, evento y desmontaje con tareas, responsables, vencimientos y avance real de cada evento."],
  ["Inventario", "Disponibilidad por fecha, asignaciones por evento, salida y devolución con daños y faltantes, y sustitutos."],
  ["Proveedores", "Trabajos con estados, anticipos, entregas y saldos; cuentas por pagar siempre al día."],
  ["Finanzas y tesorería", "Cobros (incluidos cheque y factura a 30 días), por confirmar, cuentas de efectivo/banco/cheques y gastos con carga rápida."],
  ["Trazabilidad y auditoría", "La cronología completa de cada presupuesto y evento: quién hizo qué, cuándo y con qué evidencia."],
] as const;

const steps = [
  ["01", "Presupuesto", "Armás la propuesta y se la enviás al cliente con su link y QR."],
  ["02", "Aprobación online", "El cliente ajusta, pide rebaja y aprueba; queda la evidencia y el plan de pagos."],
  ["03", "Operación", "Se reservan los equipos, se activa el checklist y se coordinan proveedores."],
  ["04", "Cobro y cierre", "El cliente transfiere y sube el comprobante; confirmás el ingreso y queda en la cuenta."],
] as const;

const faqs = [
  ["¿EventOS sirve para varias empresas?", "Sí: es multiempresa. Cada empresa tiene sus datos aislados, usuarios con roles y su propio branding."],
  ["¿El cliente tiene que crear una cuenta?", "No para aprobar: recibe un link con QR y ve su presupuesto, lo ajusta y lo aprueba desde el celular."],
  ["¿Funciona sin internet en el evento?", "El panel es instalable (PWA) y permite marcar el checklist y registrar salidas sin conexión; sincroniza al volver."],
  ["¿Se puede probar?", "Sí, hay una demo pública con datos simulados de una operación real, sin instalar nada."],
] as const;

/**
 * Resultados (issue #133, 2ª pasada): lo que cambia en la operación, con el
 * mecanismo concreto del producto. Sin métricas inventadas: cada tarjeta dice
 * qué se deja de hacer o qué se ve antes.
 */
const benefits = [
  ["Tiempo", "Un dato, un solo camino", "Vinculá el presupuesto aprobado con el evento y consultá sus equipos y cobros en la misma operación: menos retipeo y menos planillas paralelas."],
  ["Faltantes", "Disponibilidad por fecha", "Cada equipo se reserva para su evento y la salida y la devolución se registran con daños y faltantes: lo que falta se ve antes del montaje, no en el camión."],
  ["Margen", "Costos y precios en la misma ficha", "Costos, descuentos y plan de pagos viven en el presupuesto, con trazabilidad de cada cambio: el margen se controla mientras se cotiza."],
] as const;

/** Perfiles para los que está diseñado el flujo de EventOS. */
const audiences = [
  ["Productoras de eventos", "Presupuesto, cronograma y checklist por evento, con el cliente aprobando online y el equipo sabiendo qué hace cada día."],
  ["Alquiladores de equipos", "Inventario por fecha, asignaciones por evento, sustitutos y devolución con faltantes: la disponibilidad manda."],
  ["Agencias", "Varias empresas y clientes en la misma cuenta, con roles, marcas propias y trazabilidad de cada propuesta enviada."],
] as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "LedBox Paraguay",
      url: publicConfig.siteUrl,
      logo: `${publicConfig.siteUrl}/assets/icon-512.png`,
    },
    {
      "@type": "SoftwareApplication",
      name: "EventOS",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description,
      url: publicConfig.productUrl,
      publisher: { "@type": "Organization", name: "LedBox Paraguay", url: publicConfig.siteUrl },
      featureList: modules.map(([name]) => name),
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

export default function ProductoPage() {
  return (
    <div className="producto" id={PRODUCT_ROOT_ID} data-theme="dark" suppressHydrationWarning>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* La piel (issue #133): el tema se fija antes del primer pintado y la
          matriz LED queda de fondo, como en el sitio. */}
      <script dangerouslySetInnerHTML={{ __html: PRODUCT_BOOT_SCRIPT }} />
      <div className="led-grid-bg" aria-hidden="true" />

      <header className="producto-top">
        <a href={publicConfig.productUrl} className="producto-brand" aria-label="EventOS, volver al inicio">
          <BrandMark className="producto-brand-mark" size={26} />
          EventOS<span className="producto-brand-dot">.</span>
        </a>
        <nav className="producto-nav" aria-label="Secciones">
          <a href="#modulos">Módulos</a>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#preguntas">Preguntas</a>
        </nav>
        <div className="producto-actions">
          <a className="producto-button producto-button--ghost" href={publicConfig.demoUrl} target="_blank" rel="noreferrer">
            Ver la demo
          </a>
          <a className="producto-button" href={`${publicConfig.adminUrl}/login`}>
            Ingresar
          </a>
        </div>
      </header>

      <main>
        <section className="producto-hero">
          <p className="producto-kicker">Sistema de gestión de eventos</p>
          <h1>
            Todo tu evento, <span>de la cotización al cobro.</span>
          </h1>
          <p className="producto-lede">
            EventOS ordena el presupuesto, la aprobación del cliente, la operación en el campo, el inventario, los proveedores y la
            plata — con trazabilidad completa y sin planillas sueltas.
          </p>
          <div className="producto-cta">
            <a className="producto-button" href={publicConfig.demoUrl} target="_blank" rel="noreferrer">
              Probar la demo →
            </a>
            <a className="producto-button producto-button--ghost" href={`${publicConfig.adminUrl}/login`}>
              Ingresar al panel
            </a>
          </div>
          <p className="producto-note">La demo es pública, con datos simulados de una operación real y solo lectura.</p>
          <ul className="producto-flow" aria-label="Del presupuesto al cobro">
            <li>Cotizá</li>
            <li>Aprobá</li>
            <li>Operá</li>
            <li>Cobrá</li>
          </ul>
          <figure className="producto-showcase" aria-labelledby="showcase-caption">
            <div className="producto-showcase-head"><BrandMark size={28} /><span>Una operación conectada</span><span className="producto-example-tag">Ejemplo ilustrativo</span></div>
            <div className="producto-showcase-grid">
              <div className="producto-proposal">
                <p className="producto-kicker">Del pedido a la propuesta</p>
                <h2>Lanzamiento de marca</h2>
                <p>Pantallas LED · sonido · montaje</p>
                <div className="producto-proposal-lines"><span>Equipos y cantidades</span><span>Condiciones y plan de pagos</span><span>Link de aprobación del cliente</span></div>
                <strong>La propuesta, sin perder el contexto.</strong>
              </div>
              <div className="producto-operation">
                <article><span className="producto-example-step">01 · Cliente</span><h3>Una decisión clara</h3><p>Revisar la propuesta y aprobar desde el celular.</p></article>
                <article><span className="producto-example-step">02 · Equipo</span><h3>Preparar el evento</h3><p>Asignaciones, tareas y responsables en el mismo lugar.</p></article>
                <article><span className="producto-example-step">03 · Finanzas</span><h3>Confirmar el cobro</h3><p>Comprobante recibido y verificación antes de registrar el ingreso.</p></article>
              </div>
            </div>
            <figcaption id="showcase-caption">Muestra comercial ilustrativa con un evento ficticio. Representa capacidades disponibles; no es una captura del panel ni información de clientes.</figcaption>
          </figure>
        </section>

        <section id="resultados" className="producto-section">
          <h2>Lo que cambia en la operación</h2>
          <div className="producto-grid">
            {benefits.map(([eyebrow, claim, text]) => (
              <article key={eyebrow} className="producto-card">
                <span className="producto-card-eyebrow">{eyebrow}</span>
                <h3>{claim}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="para-quien" className="producto-section">
          <h2>Para quién es</h2>
          <div className="producto-grid">
            {audiences.map(([name, text]) => (
              <article key={name} className="producto-card">
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="modulos" className="producto-section">
          <h2>Un módulo para cada parte de la operación</h2>
          <div className="producto-grid">
            {modules.map(([name, text]) => (
              <article key={name} className="producto-card">
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="producto-section">
          <h2>Cómo funciona</h2>
          <ol className="producto-steps">
            {steps.map(([number, name, text]) => (
              <li key={number}>
                <span className="producto-step-number">{number}</span>
                <strong>{name}</strong>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <p className="producto-note">Explorá los módulos en la demo de solo lectura: datos ficticios, sin modificar una operación real.</p>
        </section>

        <section id="preguntas" className="producto-section producto-faq">
          <h2>Preguntas frecuentes</h2>
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </section>

        <section className="producto-section producto-final">
          <h2>Conocé el flujo antes de decidir</h2>
          <p>Sin instalar nada y sin crear cuenta: entrá a la demo y recorré el panel completo.</p>
          <div className="producto-cta">
            <a className="producto-button" href={publicConfig.demoUrl} target="_blank" rel="noreferrer">
              Abrir la demo →
            </a>
            <a className="producto-button producto-button--ghost" href={eventosSupportUrl()} target="_blank" rel="noopener noreferrer">Conversar sobre mi operación</a>
            <Link className="producto-button producto-button--ghost" href={publicConfig.siteUrl}>Sitio de LedBox</Link>
          </div>
        </section>
      </main>

    </div>
  );
}
