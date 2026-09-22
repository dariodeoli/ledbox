import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductOrderPanel } from "@/components/catalog/ProductOrderPanel";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicNav } from "@/components/public/PublicNav";
import { PublicWhatsappFloat } from "@/components/public/PublicWhatsappFloat";
import { StructuredData } from "@/components/public/StructuredData";
import { formatGs, productBySlug, productPath, products } from "@/lib/catalog";
import { breadcrumbNode, pageGraph, productNode } from "@/lib/structured-data";

/**
 * Ficha pública de un producto (issue #38): URL propia (`/productos/<slug>`),
 * metadata y JSON-LD `Product` + `Offer` por producto, migas de pan visibles y
 * en JSON-LD, y el carrito/WhatsApp de la landing funcionando igual.
 */

type ProductPageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return products.map(product => ({ slug: product.id }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = productBySlug(slug);
  if (!product) return { title: "Producto no encontrado", robots: { index: false, follow: false } };
  const title = `${product.name} en alquiler`;
  const description = `${product.description} Alquiler ${product.unitLabel}: ${formatGs(product.price)} de lista. Instalación y soporte técnico en todo Paraguay.`;
  const path = productPath(product);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "es_PY",
      url: path,
      siteName: "LedBox Paraguay",
      title,
      description,
      images: [{ url: product.image, width: product.width, height: product.height, alt: product.alt }],
    },
    twitter: { card: "summary_large_image", title, description, images: [product.image] },
  };
}

const included = [
  "Instalación y puesta en marcha",
  "Operación y soporte técnico durante el evento",
  "Retiro coordinado al finalizar",
];

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = productBySlug(slug);
  if (!product) notFound();

  const path = productPath(product);
  const crumbs = [
    { name: "Inicio", path: "/" },
    { name: "Productos", path: "/#productos" },
    { name: product.name, path },
  ];
  const related = products.filter(item => item.id !== product.id);
  const whatsappMessage = `Hola LedBox! Quiero consultar disponibilidad para ${product.name} (${product.code}).`;

  return (
    <>
      <div className="led-grid-bg" aria-hidden="true" />
      <PublicNav />

      <main className="prod-page">
        <nav className="crumbs" aria-label="Migas de pan">
          <ol>
            {crumbs.map((crumb, index) => (
              <li key={crumb.path}>
                {index < crumbs.length - 1
                  ? <Link href={crumb.path}>{crumb.name}</Link>
                  : <span aria-current="page">{crumb.name}</span>}
              </li>
            ))}
          </ol>
        </nav>

        <article className="prod-hero">
          <div className="prod-hero-art">
            <Image
              src={product.image}
              alt={product.alt}
              width={product.width}
              height={product.height}
              priority
              sizes="(max-width: 900px) calc(100vw - 40px), 460px"
            />
          </div>
          <div className="prod-hero-info">
            <p className="hero-kicker">{product.code} · Alquiler de equipos</p>
            <h1 className="prod-name">{product.name}</h1>
            <p className="prod-lede">{product.description}</p>

            <dl className="prod-facts">
              <div>
                <dt>Precio de lista</dt>
                <dd className="prod-price-lg">{formatGs(product.price)} <small>{product.unitLabel}</small></dd>
              </div>
              <div>
                <dt>Medidas y tecnología</dt>
                <dd>{product.specs}</dd>
              </div>
              <div>
                <dt>Disponibilidad</dt>
                <dd>Según fecha del evento · consultanos</dd>
              </div>
            </dl>

            <ProductOrderPanel product={product} />
            <p className="catalog-note prod-note">Precio de lista orientativo. El valor final puede variar según los días, la cantidad y combinación de equipos, instalación, traslado y necesidades del evento. Armamos combos a medida.</p>
          </div>
        </article>

        <section className="prod-includes" aria-labelledby="prod-includes-title">
          <h2 id="prod-includes-title">Incluido en el alquiler<span className="led">.</span></h2>
          <ul>
            {included.map(item => <li key={item}>{item}</li>)}
          </ul>
          <p>
            ¿Necesitás algo más? Mirá los <Link href="/#servicios">servicios</Link>, <Link href="/#proceso">cómo trabajamos</Link> o las <Link href="/#faq">preguntas frecuentes</Link>.
          </p>
        </section>

        <section className="prod-related" aria-labelledby="prod-related-title">
          <h2 id="prod-related-title">Otros equipos<span className="led">.</span></h2>
          <ul>
            {related.map(item => (
              <li key={item.id}>
                <Link href={productPath(item)}>
                  <strong>{item.name}</strong>
                  <span>{formatGs(item.price)} · {item.unitLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link className="btn-line prod-related-cta" href="/#productos">Ver todo el catálogo →</Link>
        </section>
      </main>

      <PublicFooter />
      <PublicWhatsappFloat message={whatsappMessage} />
      <StructuredData graph={pageGraph(productNode(product), breadcrumbNode(crumbs))} />
    </>
  );
}
