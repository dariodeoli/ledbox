import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppFooter } from "@/components/app-footer";
import { publicConfig } from "@/lib/public-config";

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
    images: [{ url: "/assets/producto/panel-finanzas.jpg", width: 1280, height: 800, alt: "Panel de EventOS con finanzas y tesorería" }],
  },
  twitter: { card: "summary_large_image", title, description },
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
      offers: { "@type": "Offer", price: "0", priceCurrency: "PYG", description: "Demo pública y planes a medida" },
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
    <div className="producto">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="producto-top">
        <span className="producto-brand">
          <Image src="/assets/icon-192.png" alt="" width={28} height={28} className="producto-brand-mark" aria-hidden="true" />
          EventOS<span className="producto-brand-dot">.</span>
        </span>
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
          <Image
            className="producto-hero-shot"
            src="/assets/producto/panel-finanzas.jpg"
            alt="Panel de EventOS: finanzas, por confirmar y tesorería por cuentas"
            width={1280}
            height={800}
            priority
          />
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
          <div className="producto-shots">
            <Image src="/assets/producto/panel-presupuestos.jpg" alt="Presupuestos con estados, portal y acciones" width={1280} height={800} />
            <Image src="/assets/producto/panel-calendario.jpg" alt="Calendario operativo con eventos, cobros y vencimientos" width={1280} height={800} />
          </div>
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
          <h2>Probalo con datos reales de ejemplo</h2>
          <p>Sin instalar nada y sin crear cuenta: entrá a la demo y recorré el panel completo.</p>
          <div className="producto-cta">
            <a className="producto-button" href={publicConfig.demoUrl} target="_blank" rel="noreferrer">
              Abrir la demo →
            </a>
            <Link className="producto-button producto-button--ghost" href="/">
              Sitio de LedBox
            </Link>
          </div>
        </section>
      </main>

      <AppFooter variant="app" />
    </div>
  );
}
