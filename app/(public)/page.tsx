"use client";
import { useEffect, useState } from "react";
import { CartDrawer, type CartItem } from "@/components/cart/CartDrawer";
import { LeadCaptureDialog } from "@/components/leads/LeadCaptureDialog";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { type Product } from "@/lib/catalog";
import { InstagramIcon } from "@/components/public/InstagramIcon";
import { PublicFaq } from "@/components/public/PublicFaq";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicNav } from "@/components/public/PublicNav";
import { PublicWhatsappFloat } from "@/components/public/PublicWhatsappFloat";
import { StructuredData } from "@/components/public/StructuredData";
import { whatsappUrl } from "@/lib/public-config";
import { faqNode, pageGraph, productListNode } from "@/lib/structured-data";

const whatsapp = whatsappUrl;
const services = [
  ["01", "Stands para eventos", "Planificación y construcción de espacios que hacen visible tu marca.", "Diseñamos →"],
  ["02", "Activaciones de marca", "Experiencias con tecnología, interacción y soporte en cada detalle.", "Activamos →"],
  ["03", "Coberturas digitales", "Videos, reels y tomas aéreas con drone para que el evento continúe online.", "Cubrimos →"]
];
const steps = [["01", "Contanos tu idea", "Fecha, lugar, objetivo y todo lo que imaginás para tu evento."], ["02", "Armamos la propuesta", "Combinamos equipos, servicios y un plan a medida."], ["03", "Instalamos y probamos", "Nuestro equipo deja todo listo antes de que empiece el evento."], ["04", "Te acompañamos", "Soporte técnico durante la experiencia y retiro coordinado."]];
const reasons = [["◈", "Equipos propios", "Disponibilidad y control sobre cada equipo que alquilás."], ["⌁", "Soporte incluido", "Instalación, operación y asistencia técnica en el evento."], ["✦", "Experiencia real", "Más de 10 años creando experiencias para marcas."], ["↗", "Todo Paraguay", "Llegamos donde tu evento necesita impacto visual."]];

export default function HomePage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const [stickyClosed, setStickyClosed] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setStickyVisible(window.scrollY > Math.min(520, window.innerHeight * 0.65));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("has-sticky", stickyVisible && !stickyClosed);
    return () => document.body.classList.remove("has-sticky");
  }, [stickyClosed, stickyVisible]);
  const addProduct = (product: Product) => { setCart(current => { const existing = current.find(item => item.product.id === product.id); return existing ? current.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { product, quantity: 1, duration: 1 }]; }); setLeadOpen(true); };
  const openLead = () => setLeadOpen(true);
  // Datos estructurados de la landing (issue #38): el catálogo enlaza cada
  // producto con su URL propia y el FAQPage acompaña la sección visible.
  const structuredData = pageGraph(productListNode(), faqNode());
  return <>
    <div className="led-grid-bg" aria-hidden="true" />
    <PublicNav />

    <main>
      <header id="hero">
        <div><div className="hero-kicker rise on">LedBox Paraguay · Alquileres & Eventos</div><h1 className="mega rise on">Tecnología<br /><span className="led glow">visual</span> que<br />impulsa tu marca</h1><p className="hero-sub rise on">Alquiler de <strong>pantallas LED, iPoster, tótems y kioskos touch</strong>. Planificación y construcción de <strong>stands</strong> para eventos nacionales e internacionales. Coberturas digitales: <strong>videos, reels y tomas aéreas con drone</strong>.</p><div className="hero-actions rise on"><button className="btn-led" type="button" onClick={openLead}>Consultar disponibilidad</button><a href="#productos" className="btn-line">Ver productos</a></div></div>
        <div className="hero-foot"><span><b>Alquileres</b> en todo Paraguay</span><span><b>Eventos</b> nacionales e internacionales</span><span><b>Instalación + soporte</b> incluidos</span></div>
      </header>
      <div className="ticker" aria-hidden="true"><div className="ticker-track"><span>Pantallas LED ● iPoster ● Tótem Touch ● Kiosko Touch ● Stands ● Activaciones ● Coberturas Digitales ● </span><span>Pantallas LED ● iPoster ● Tótem Touch ● Kiosko Touch ● Stands ● Activaciones ● Coberturas Digitales ● </span></div></div>
      <section id="stats" aria-label="LedBox en números"><div className="stat rise"><div className="n">+10<em>+</em></div><div className="l">Años de experiencia en eventos</div></div><div className="stat rise"><div className="n">+100<em>+</em></div><div className="l">Expoferias cubiertas</div></div><div className="stat rise"><div className="n">PY<em>+</em></div><div className="l">Cobertura nacional e internacional</div></div><a className="stat rise stat-social" href="https://www.instagram.com/ledboxpy/" target="_blank" rel="noopener noreferrer"><div className="n"><InstagramIcon /> <em>@ledboxpy</em></div><div className="l">Seguinos en Instagram →</div></a></section>

      <section id="productos" aria-labelledby="products-title"><div className="sec-head"><div><div className="sec-kicker">Alquiler de equipos</div><h2 id="products-title" className="sec-title rise">Productos<span className="led">.</span></h2></div><p className="sec-desc rise">Equipos propios, <strong>instalación y soporte técnico incluidos</strong>. Consultá disponibilidad para la fecha de tu evento.</p></div><p className="catalog-note">Precios de lista orientativos. El valor final puede variar según la cantidad de días, la cantidad y combinación de equipos, instalación, traslado y necesidades del evento. Podemos armar combos a medida.</p><ProductGrid onAdd={addProduct} /></section>
      <section id="servicios" aria-labelledby="services-title"><div className="sec-head"><div><div className="sec-kicker">Más que equipos</div><h2 id="services-title" className="sec-title rise">Servicios<span className="led">.</span></h2></div><p className="sec-desc rise">Una experiencia visual completa, desde la primera idea hasta el último minuto de tu evento.</p></div>{services.map(([num,title,desc,cta]) => <a className="svc rise" href="#contacto" key={num}><span className="num">{num}</span><h3>{title}</h3><p>{desc}</p><span className="go">{cta}</span></a>)}</section>
      <section id="marcas" aria-labelledby="brands-title"><div className="sr-only" id="brands-title">Marcas que confiaron en LedBox</div><div className="brands-track" aria-hidden="true">{["Tigo", "Personal", "Bancard", "Cervepar", "Coca-Cola", "Pilsen", "Banco Atlas", "Claro", "ueno", "Shopping del Sol", "Tigo", "Personal", "Bancard"].map((brand, i) => <span className="brand" key={`${brand}-${i}`}>{brand}</span>)}</div><p className="marcas-note">Marcas que ya hicieron visible su próximo evento · <a href="#contacto">La próxima puede ser la tuya →</a></p></section>
      <section id="proceso" aria-labelledby="process-title"><div className="sec-head"><div><div className="sec-kicker">Así trabajamos</div><h2 id="process-title" className="sec-title rise">Proceso<span className="led">.</span></h2></div><p className="sec-desc rise">Simple para vos. Preciso para nosotros. Sin sorpresas el día del evento.</p></div><div className="steps">{steps.map(([num,title,desc]) => <div className="stp rise" key={num}><div className="n">{num}</div><h3>{title}</h3><p>{desc}</p></div>)}</div></section>
      <section id="porque" aria-labelledby="why-title"><div className="sec-head"><div><div className="sec-kicker">Por qué LedBox</div><h2 id="why-title" className="sec-title rise">Hecho para<br /><span className="led">impactar.</span></h2></div><p className="sec-desc rise">La tecnología es el medio. Tu marca es la protagonista.</p></div><div className="why-grid">{reasons.map(([icon,title,desc]) => <div className="why rise" key={title}><div className="ico" aria-hidden="true">{icon}</div><h3>{title}</h3><p>{desc}</p></div>)}</div></section>
      <PublicFaq />
      <section id="contacto" aria-labelledby="contact-title"><div className="c-left"><div><div className="sec-kicker">Hablemos</div><h2 id="contact-title" className="c-title rise">Tu evento.<br /><span className="led">En grande.</span></h2><p className="c-desc">Contanos qué estás preparando y armamos una propuesta a la medida de tu evento.</p></div><div className="c-meta"><a href={whatsapp("Hola LedBox! Quiero consultar disponibilidad.")} target="_blank" rel="noopener noreferrer"><b>WhatsApp:</b> +595 982 029 217 →</a><a href="https://www.instagram.com/ledboxpy/" target="_blank" rel="noopener noreferrer"><b>Instagram:</b> @ledboxpy</a><span><b>Santiago J. Rodas</b> · Gerente</span><span>Asunción · Alquileres en todo Paraguay 🇵🇾</span></div></div><div className="c-right rise"><p className="chips-title">Consultas rápidas — un toque y te ayudamos</p><div className="chips"><button className="chip" type="button" onClick={openLead}>▣ Pantalla LED →</button><button className="chip" type="button" onClick={openLead}>◫ Tótem / Kiosko Touch →</button><button className="chip" type="button" onClick={openLead}>⌂ Stand para evento →</button><button className="chip" type="button" onClick={openLead}>🎥 Cobertura digital →</button></div><button className="btn-led" type="button" onClick={openLead}>Solicitar cotización →</button><p className="f-note contact-note">Te pedimos solo los datos necesarios para responderte y preparar tu cotización.</p></div></section>
    </main>

    <PublicFooter />
    <CartDrawer items={cart} onChange={setCart} onQuote={openLead} />
    <PublicWhatsappFloat />
    {!stickyClosed && <div id="sticky-cta" className={stickyVisible ? "show" : ""} role="complementary" aria-label="Consultar disponibilidad" aria-hidden={!stickyVisible} inert={!stickyVisible}><span className="txt">¿Evento a la vista? <strong>Consultá disponibilidad hoy</strong></span><button className="go-btn" type="button" onClick={openLead}>WhatsApp →</button><button className="x" type="button" onClick={() => setStickyClosed(true)} aria-label="Cerrar aviso">✕</button></div>}
    <LeadCaptureDialog open={leadOpen} items={cart} onClose={() => setLeadOpen(false)} />
    <StructuredData graph={structuredData} />
  </>;
}
