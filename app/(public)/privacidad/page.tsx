import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/public/PublicNav";
import { whatsappUrl } from "@/lib/public-config";

/**
 * Política de privacidad del sitio (issue #92), en borrador para revisión del
 * dueño: los datos societarios van como `PENDIENTE-DUEÑO` —no se inventan— y el
 * texto cubre lo que pide la Ley 7593/2025 «De Protección de Datos Personales»
 * (finalidades, base legal, minimización, conservación, destinatarios, derechos
 * del titular con plazo, seguridad, cambios y autoridad de control).
 *
 * Es una página pública e indexable: misma piel que la landing y las fichas.
 */

export const metadata: Metadata = {
  title: "Política de privacidad",
  description:
    "Cómo trata LedBox los datos personales que recibimos por el sitio: finalidades, base legal, conservación, destinatarios y derechos del titular (Ley 7593/2025).",
  alternates: { canonical: "/privacidad" },
};

const LAST_UPDATE = "01-10-2026";
const CONTACT_PHONE = "+595 982 029 217";
const rightsUrl = whatsappUrl("Hola LedBox! Quiero ejercer mis derechos sobre mis datos personales.");

export default function PrivacidadPage() {
  return (
    <>
      <div className="led-grid-bg" aria-hidden="true" />
      <PublicNav />

      <main className="legal-page">
        <nav className="crumbs" aria-label="Migas de pan">
          <ol>
            <li><Link href="/">Inicio</Link></li>
            <li><span aria-current="page">Privacidad</span></li>
          </ol>
        </nav>

        <header className="legal-head">
          <div className="sec-kicker">Legales · Ley 7593/2025</div>
          <h1 className="prod-name">Privacidad<span className="led">.</span></h1>
          <p className="prod-lede">
            Cómo trata LedBox los datos personales que nos dejás en este sitio: para qué los usamos, con qué base
            legal, cuánto los conservamos y cómo ejercer tus derechos.
          </p>
          <p className="catalog-note legal-note">
            Última actualización: {LAST_UPDATE}. Documento en revisión del dueño: los datos marcados como{" "}
            <strong>PENDIENTE-DUEÑO</strong> y el texto legal se completan y validan antes de la publicación final.
            No constituye asesoramiento legal.
          </p>
        </header>

        <article className="legal-doc">
          <section aria-labelledby="legal-responsable">
            <h2 id="legal-responsable">1. Responsable del tratamiento<span className="led">.</span></h2>
            <dl className="prod-facts legal-facts">
              <div><dt>Responsable</dt><dd>LedBox</dd></div>
              <div><dt>Razón social</dt><dd>PENDIENTE-DUEÑO</dd></div>
              <div><dt>RUC</dt><dd>PENDIENTE-DUEÑO</dd></div>
              <div><dt>Domicilio</dt><dd>PENDIENTE-DUEÑO · Asunción, Paraguay</dd></div>
              <div>
                <dt>Contacto</dt>
                <dd>
                  <a href={rightsUrl} target="_blank" rel="noopener noreferrer">WhatsApp {CONTACT_PHONE}</a> · Asunción,
                  Paraguay
                </dd>
              </div>
            </dl>
            <p>
              Para consultas sobre esta política o para ejercer tus derechos, escribinos por WhatsApp al{" "}
              <a href={rightsUrl} target="_blank" rel="noopener noreferrer">{CONTACT_PHONE}</a>: es el canal habilitado
              por ahora y el domicilio postal queda disponible cuando se completen los datos societarios.
            </p>
          </section>

          <section aria-labelledby="legal-datos">
            <h2 id="legal-datos">2. Qué datos tratamos<span className="led">.</span></h2>
            <p>Tratamos solo los datos que nos das vos, con estos fines:</p>
            <ul>
              <li><strong>Datos de contacto:</strong> nombre, teléfono, correo y, si lo completás, empresa o RUC.</li>
              <li><strong>Datos de tu consulta:</strong> motivo, detalle, equipos, fechas y ciudad que mencionás.</li>
              <li><strong>Datos del pedido o evento</strong> que surgen de la relación comercial (por ejemplo, dirección de instalación) cuando contratás un servicio.</li>
            </ul>
            <p>
              Este sitio no usa cookies de publicidad ni herramientas de perfilamiento. Tu preferencia de tema (claro
              u oscuro) se guarda únicamente en tu navegador y no se envía a nuestros servidores.
            </p>
          </section>

          <section aria-labelledby="legal-finalidades">
            <h2 id="legal-finalidades">3. Para qué los usamos y con qué base legal<span className="led">.</span></h2>
            <ul>
              <li><strong>Responder tu consulta y preparar el presupuesto</strong> — consentimiento, que prestás al enviarnos el formulario y podés revocar cuando quieras.</li>
              <li><strong>Gestionar el alquiler, el evento y la relación comercial</strong> — ejecución del contrato o de medidas precontractuales a tu pedido.</li>
              <li><strong>Cumplir obligaciones legales, contables y fiscales</strong> cuando corresponda — cumplimiento de una obligación legal.</li>
            </ul>
            <p>
              No usamos tus datos para publicidad de terceros ni para decisiones automatizadas con efectos sobre vos.
            </p>
          </section>

          <section aria-labelledby="legal-conservacion">
            <h2 id="legal-conservacion">4. Minimización y conservación<span className="led">.</span></h2>
            <p>
              Pedimos solo lo necesario para las finalidades de arriba. Conservamos los datos mientras tu consulta siga
              vigente y, si se concreta el servicio, durante la relación comercial y los plazos legales aplicables
              (por ejemplo, obligaciones contables y fiscales). Después se eliminan o se anonimizan.
            </p>
          </section>

          <section aria-labelledby="legal-destinatarios">
            <h2 id="legal-destinatarios">5. Destinatarios<span className="led">.</span></h2>
            <p>No vendemos ni cedemos tus datos. Pueden acceder a ellos, solo para operar el servicio:</p>
            <ul>
              <li><strong>Infraestructura:</strong> proveedores que alojan el sitio y la base de datos donde vive tu consulta.</li>
              <li><strong>Mensajería:</strong> cuando elegís continuar por WhatsApp, el mensaje viaja por ese servicio con sus propias condiciones.</li>
              <li>
                <strong>Asistente de carga con IA (opcional):</strong> cuando el equipo de la empresa usa «Carga con IA»,
                el texto que pega se envía a un proveedor de inteligencia artificial para ordenarlo en clientes, eventos
                o productos. Se manda solo ese texto —no la base— y no se usa para publicidad ni para decisiones
                automatizadas sobre vos.
              </li>
              <li><strong>Autoridades públicas:</strong> cuando una norma o un requerimiento válido lo exija.</li>
            </ul>
            <p>
              Si alguno de esos proveedores opera desde otro país, el acceso se limita a lo necesario para prestar el
              servicio.
            </p>
          </section>

          <section aria-labelledby="legal-derechos">
            <h2 id="legal-derechos">6. Tus derechos<span className="led">.</span></h2>
            <p>Como titular de los datos, podés ejercer en cualquier momento:</p>
            <ul>
              <li><strong>Acceso:</strong> saber qué datos tuyos tratamos y con qué finalidad.</li>
              <li><strong>Rectificación:</strong> corregir los datos inexactos o incompletos.</li>
              <li><strong>Supresión:</strong> pedir que eliminemos tus datos cuando ya no sean necesarios.</li>
              <li><strong>Oposición:</strong> oponerte a tratamientos determinados, por ejemplo a comunicaciones comerciales.</li>
              <li><strong>Portabilidad:</strong> recibir tus datos en un formato legible y reutilizable.</li>
              <li><strong>Revocación del consentimiento:</strong> retirarlo en cualquier momento, sin afectar lo ya realizado.</li>
            </ul>
            <p>
              <strong>Canal:</strong> WhatsApp{" "}
              <a href={rightsUrl} target="_blank" rel="noopener noreferrer">{CONTACT_PHONE}</a>. <strong>Plazo:</strong>{" "}
              respondemos en un máximo de <strong>30 días corridos</strong>. El ejercicio es gratuito; solo podemos
              pedirte los datos mínimos para verificar tu identidad y proteger la información.
            </p>
          </section>

          <section aria-labelledby="legal-seguridad">
            <h2 id="legal-seguridad">7. Seguridad<span className="led">.</span></h2>
            <p>
              Aplicamos medidas técnicas y organizativas razonables: acceso restringido a las personas autorizadas,
              autenticación en los sistemas internos, cifrado en tránsito (HTTPS) y respaldo de la información. Si
              ocurre un incidente que afecte tus datos, lo evaluamos y comunicamos lo que corresponda.
            </p>
          </section>

          <section aria-labelledby="legal-cambios">
            <h2 id="legal-cambios">8. Cambios en esta política<span className="led">.</span></h2>
            <p>
              Podemos actualizar esta política para reflejar cambios normativos o del servicio. Publicamos siempre la
              fecha de la última actualización y, si el cambio es significativo, lo avisamos en el sitio.
            </p>
          </section>

          <section aria-labelledby="legal-autoridad">
            <h2 id="legal-autoridad">9. Autoridad de control<span className="led">.</span></h2>
            <p>
              En Paraguay, la autoridad de aplicación de la Ley 7593/2025 «De Protección de Datos Personales» es la
              Agencia Nacional de Protección de Datos Personales, dependiente del MITIC. Podés presentar allí un
              reclamo si considerás que tus derechos no fueron atendidos.
            </p>
          </section>
        </article>
      </main>

    </>
  );
}
