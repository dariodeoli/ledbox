import Link from "next/link";
import { ProductoPage } from "@/components/product/ProductoPage";
import { publicConfig } from "@/lib/public-config";
import { PRODUCT_LANDING_VARIANTS, type ProductLandingVariant } from "@/lib/product-landing-previews";
import styles from "./LandingVariantPreview.module.css";

export function LandingVariantPreview({ variant }: { variant: ProductLandingVariant }) {
  return (
    <>
      <PreviewSwitcher current={variant} />
      {variant === "a" ? <ProductoPage /> : variant === "b" ? <OperationsLanding /> : <CatalogLanding />}
    </>
  );
}

function PreviewSwitcher({ current }: { current: ProductLandingVariant }) {
  return (
    <aside className={styles.previewBar} aria-label="Selector de vistas previas">
      <span>Vista previa · no publicada</span>
      <nav aria-label="Variantes de landing">
        {(Object.keys(PRODUCT_LANDING_VARIANTS) as ProductLandingVariant[]).map((variant) => (
          <Link key={variant} aria-current={current === variant ? "page" : undefined} href={`/preview/landing/${variant}`}>
            <span className={styles.previewLongLabel}>{variant.toUpperCase()} · {PRODUCT_LANDING_VARIANTS[variant].name}</span>
            <span className={styles.previewShortLabel}>{variant.toUpperCase()} · {variant === "a" ? "Actual" : variant === "b" ? "Gestión" : "Tienda"}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function PreviewHeader({ active }: { active: "operación" | "catálogo" }) {
  return (
    <header className={styles.header}>
      <Link href={publicConfig.productUrl} className={styles.wordmark} aria-label="EventOS, página principal">EventOS</Link>
      <nav aria-label="Navegación principal">
        <a href="#flujo">Flujo</a>
        <a href="#modulos">Módulos</a>
        <a href="#preguntas">Preguntas</a>
      </nav>
      <a className={styles.headerAction} href={publicConfig.demoUrl} target="_blank" rel="noreferrer">Ver demo</a>
      <span className={styles.activeContext} aria-live="polite">{active}</span>
    </header>
  );
}

function OperationsLanding() {
  return (
    <div className={`${styles.landing} ${styles.operations}`}>
      <PreviewHeader active="operación" />
      <main>
        <section className={styles.operationHero}>
          <div className={styles.heroCopy}>
          <h1>Administrá cada evento.</h1>
            <p>Presupuestos, eventos, inventario y finanzas siguen el mismo recorrido, con roles y datos separados para cada empresa.</p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href={publicConfig.demoUrl} target="_blank" rel="noreferrer">Recorrer la demo</a>
              <a className={styles.textAction} href={`${publicConfig.adminUrl}/login`}>Ingresar al sistema →</a>
            </div>
          </div>
          <div className={styles.operationBoard} data-ui="operations-preview">
            <div className={styles.boardHeading}>
              <div><strong>El evento, de punta a punta</strong><span>Una secuencia conectada</span></div>
              <span className={styles.boardStamp}>Vista ilustrativa</span>
            </div>
            <ol className={styles.workflow}>
              <li><span>Presupuesto</span><b>Preparar opciones y condiciones</b><em>Cliente</em></li>
              <li><span>Aprobación</span><b>Revisar y decidir desde el portal</b><em>Cliente</em></li>
              <li><span>Operación</span><b>Coordinar tareas, equipos y proveedores</b><em>Equipo</em></li>
              <li><span>Cierre</span><b>Registrar cobros y completar el evento</b><em>Finanzas</em></li>
            </ol>
          </div>
        </section>

        <section className={styles.operationSection} id="flujo">
          <div className={styles.sectionIntro}><h2>El equipo sabe qué sigue.</h2><p>La información acompaña al evento desde la propuesta hasta el cierre.</p></div>
          <div className={styles.processLines}>
            <article><span>Presupuestos</span><p>Prepará propuestas y compartí un portal claro para revisar y aprobar.</p></article>
            <article><span>Eventos e inventario</span><p>Conectá el trabajo del equipo con disponibilidad, entregas y devoluciones.</p></article>
            <article><span>Finanzas</span><p>Seguí anticipos, saldos y movimientos con su contexto operativo.</p></article>
          </div>
        </section>

        <section className={styles.roleSection} id="modulos">
          <p>Identidad, usuarios y permisos propios para cada empresa. Un equipo comparte la operación y accede solo a la información que le corresponde.</p>
          <div className={styles.roleRail} aria-label="Áreas conectadas"><span>Administración</span><span>Operaciones</span><span>Finanzas</span><span>Cliente</span></div>
        </section>

        <section className={styles.finalSection} id="preguntas">
          <h2>Conocé el flujo en la demo.</h2>
          <p>Entrá con datos de ejemplo y recorré el panel sin instalar nada.</p>
          <a className={styles.primaryAction} href={publicConfig.demoUrl} target="_blank" rel="noreferrer">Abrir EventOS demo →</a>
        </section>
      </main>
    </div>
  );
}

function CatalogLanding() {
  return (
    <div className={`${styles.landing} ${styles.catalog}`}>
      <PreviewHeader active="catálogo" />
      <main>
        <section className={styles.catalogHero}>
          <div>
            <h1>Presupuestos claros.</h1>
            <p>Mostrá productos con sus detalles, compará alternativas y compartí un presupuesto pensado para decidir desde cualquier pantalla.</p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href={publicConfig.demoUrl} target="_blank" rel="noreferrer">Ver el flujo en la demo</a>
              <a className={styles.textAction} href={`${publicConfig.adminUrl}/login`}>Preparar un presupuesto →</a>
            </div>
          </div>
          <div className={styles.quotePreview} data-ui="quote-comparison-preview">
            <div className={styles.quoteHeader}><span>Propuesta para tu evento</span><span>Vista ilustrativa</span></div>
            <div className={styles.quoteTabs} aria-label="Alternativas de propuesta"><span aria-current="page">Opción A</span><span>Opción B</span><span>Opción C</span></div>
            <div className={styles.quoteItem}><span className={styles.productGlyph} aria-hidden="true">LED</span><div><strong>Pantalla LED</strong><span>Detalle técnico y cantidad cotizada</span></div><b>Incluida</b></div>
            <div className={styles.quoteItem}><span className={styles.productGlyph} aria-hidden="true">TO</span><div><strong>Tótem Touch</strong><span>Especificaciones y condiciones</span></div><b>Incluido</b></div>
            <div className={styles.quoteDecision}><span>Alternativas comparables en un mismo portal</span><b>Revisar propuesta →</b></div>
          </div>
        </section>

        <section className={styles.catalogTiles} id="flujo">
          <h2>Del catálogo a la decisión.</h2>
          <div className={styles.catalogGrid}>
            <article className={styles.tileLarge}><h3>Productos que se entienden.</h3><p>Fotos, descripciones y características organizadas para que el cliente sepa qué está cotizando.</p></article>
            <article className={styles.tileTall}><h3>Condiciones a la vista.</h3><p>Importes, pagos y plazos quedan junto a los artículos de la propuesta.</p></article>
            <article className={styles.tileWide}><h3>Comparar y aprobar.</h3><p>El cliente revisa las alternativas y responde desde el enlace, también en su teléfono.</p></article>
            <article className={styles.tileAction}><a href={publicConfig.demoUrl} target="_blank" rel="noreferrer">Explorar EventOS →</a></article>
          </div>
        </section>

        <section className={styles.catalogClose} id="modulos">
          <h2>Una propuesta completa.</h2>
          <p>Catálogo, alternativas y aprobación se conectan con la operación que sigue.</p>
          <div className={styles.roleRail} aria-label="Partes del flujo"><span>Productos</span><span>Opciones</span><span>Aprobación</span><span>Evento</span></div>
        </section>
      </main>
    </div>
  );
}

