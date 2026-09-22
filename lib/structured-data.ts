import { products, productPath, unitDescription, type Product } from "@/lib/catalog";
import { publicConfig } from "@/lib/public-config";

/**
 * Datos estructurados del sitio público (issue #38).
 *
 * Fuente única de los nodos JSON-LD (schema.org) y del perfil real del negocio:
 * la landing emite `Organization` + `LocalBusiness` + `WebSite` + `FAQPage` +
 * `ItemList`, cada ficha de producto emite `Product` + `Offer` + `BreadcrumbList`
 * y las páginas enlazan los nodos por `@id` (nada de copias paralelas).
 *
 * Los datos que todavía no tenemos se dejan como campo preparado (`null` /
 * lista vacía) y el nodo los omite: cuando el dato real esté, se completa acá y
 * aparece en todas las páginas sin tocar los componentes.
 */

export type JsonLdNode = Record<string, unknown>;
export type JsonLdGraph = { "@context": "https://schema.org"; "@graph": JsonLdNode[] };
export type FaqEntry = { question: string; answer: string };

const SITE = publicConfig.siteUrl;

/** Identificadores estables de los nodos, para enlazarlos entre páginas. */
export const ORGANIZATION_ID = `${SITE}/#organization`;
export const LOCAL_BUSINESS_ID = `${SITE}/#localbusiness`;
export const WEBSITE_ID = `${SITE}/#website`;
export const FAQ_ID = `${SITE}/#faq`;
export const PRODUCT_LIST_ID = `${SITE}/#productos`;

/**
 * Perfil real del negocio.
 *
 * Reales hoy: nombre, descripción, teléfono/WhatsApp, correo, dirección
 * (Senador Long, Asunción), país, horario de atención, Instagram, logo e imagen
 * social. Preparados para completar: `postalCode`, `latitude`/`longitude` y
 * `taxID` (RUC). Mientras estén vacíos, los nodos no los declaran (nunca datos
 * inventados).
 */
export const businessProfile = {
  name: "LedBox Paraguay",
  description:
    "Alquiler de pantallas LED, tótems, kioskos touch y soluciones visuales para eventos. Instalación y soporte técnico incluidos en todo Paraguay.",
  telephone: "+595982029217",
  email: "santiago.rodas.sjr@gmail.com",
  streetAddress: "Senador Long",
  city: "Asunción",
  region: "Asunción",
  country: "PY",
  /** Código postal. Falta el dato real. */
  postalCode: null as string | null,
  /** Coordenadas del local. Falta el número de la calle para geolocalizar. */
  latitude: null as number | null,
  longitude: null as number | null,
  /** Horario de atención (lunes a viernes); schema.org lo publica tal cual. */
  openingHours: ["Mo-Fr 07:00-19:00"] as string[],
  areaServed: "Paraguay",
  sameAs: ["https://www.instagram.com/ledboxpy/"],
  logo: "/assets/icon-512.png",
  image: "/assets/og-image.png",
  language: "es-PY",
};

/** Preguntas frecuentes reales: las mismas que se ven en la landing y en su JSON-LD. */
export const faqs: FaqEntry[] = [
  {
    question: "¿Qué equipos puedo alquilar en LedBox?",
    answer:
      "Pantallas LED modulares, tótems LED y touch, kioskos touch, pantallas multimedia, cilindros LED y dispensadores inteligentes. Cada alquiler incluye instalación y soporte técnico durante el evento.",
  },
  {
    question: "¿Los precios que figuran son definitivos?",
    answer:
      "Son precios de lista orientativos. La cotización final depende de días, cantidad, combinación, traslado, instalación y necesidades del evento.",
  },
  {
    question: "¿El alquiler incluye instalación y soporte?",
    answer:
      "Sí. Instalamos y probamos cada equipo antes del evento, acompañamos la experiencia con soporte técnico y coordinamos el retiro al finalizar.",
  },
  {
    question: "¿Trabajan en todo Paraguay?",
    answer:
      "Sí, coordinamos alquileres, instalación y soporte para eventos en todo Paraguay, además de eventos internacionales con equipo propio.",
  },
  {
    question: "¿Puedo combinar equipos o alquilar por menos de un día?",
    answer:
      "Podés combinar todos los equipos que necesites y armar combos a medida. La pantalla LED se cotiza por m² y día, los tótems, kioskos y pantallas multimedia por día, y el dispensador por evento.",
  },
  {
    question: "¿Cómo pido una cotización?",
    answer:
      "Agregá los equipos que te interesan al pedido y enviá la consulta por WhatsApp, o completá el formulario del sitio. Te pedimos solo los datos necesarios para responderte y preparar la propuesta.",
  },
];

/** URL absoluta a partir de un path del sitio (para los `@id` y los `item`). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
}

function postalAddressNode(): JsonLdNode {
  const address: JsonLdNode = {
    "@type": "PostalAddress",
    addressLocality: businessProfile.city,
    addressCountry: businessProfile.country,
  };
  if (businessProfile.streetAddress) address.streetAddress = businessProfile.streetAddress;
  if (businessProfile.region) address.addressRegion = businessProfile.region;
  if (businessProfile.postalCode) address.postalCode = businessProfile.postalCode;
  return address;
}

function geoNode(): JsonLdNode | null {
  if (businessProfile.latitude === null || businessProfile.longitude === null) return null;
  return { "@type": "GeoCoordinates", latitude: businessProfile.latitude, longitude: businessProfile.longitude };
}

function contactFields(): JsonLdNode {
  const fields: JsonLdNode = { telephone: businessProfile.telephone };
  if (businessProfile.email) fields.email = businessProfile.email;
  return fields;
}

/** Empresa dueña del sitio: se enlaza desde el resto de los nodos. */
export function organizationNode(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: businessProfile.name,
    url: `${SITE}/`,
    logo: absoluteUrl(businessProfile.logo),
    image: absoluteUrl(businessProfile.image),
    description: businessProfile.description,
    ...contactFields(),
    address: postalAddressNode(),
    areaServed: { "@type": "Country", name: businessProfile.areaServed },
    sameAs: businessProfile.sameAs,
  };
}

/** Negocio local con los datos reales de LedBox (dirección parcial mientras falte la calle). */
export function localBusinessNode(): JsonLdNode {
  const geo = geoNode();
  return {
    "@type": "LocalBusiness",
    "@id": LOCAL_BUSINESS_ID,
    name: businessProfile.name,
    description: businessProfile.description,
    url: `${SITE}/`,
    image: absoluteUrl(businessProfile.image),
    logo: absoluteUrl(businessProfile.logo),
    ...contactFields(),
    address: postalAddressNode(),
    areaServed: { "@type": "Country", name: businessProfile.areaServed },
    parentOrganization: { "@id": ORGANIZATION_ID },
    sameAs: businessProfile.sameAs,
    ...(geo ? { geo } : {}),
    ...(businessProfile.openingHours.length ? { openingHours: businessProfile.openingHours } : {}),
  };
}

export function websiteNode(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: `${SITE}/`,
    name: businessProfile.name,
    inLanguage: businessProfile.language,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** Organización + negocio local + sitio: va en el layout público, en todas las páginas. */
export function siteGraph(): JsonLdGraph {
  return { "@context": "https://schema.org", "@graph": [organizationNode(), localBusinessNode(), websiteNode()] };
}

/** Preguntas frecuentes visibles de la landing. */
export function faqNode(): JsonLdNode {
  return {
    "@type": "FAQPage",
    "@id": FAQ_ID,
    mainEntity: faqs.map(faq => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

/** Catálogo de la landing enlazando cada producto con su URL propia. */
export function productListNode(): JsonLdNode {
  return {
    "@type": "ItemList",
    "@id": PRODUCT_LIST_ID,
    name: "Equipos en alquiler",
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: product.name,
      url: absoluteUrl(productPath(product)),
    })),
  };
}

function offerNode(product: Product, url: string): JsonLdNode {
  return {
    "@type": "Offer",
    "@id": `${url}#offer`,
    url,
    priceCurrency: "PYG",
    price: product.price,
    availability: "https://schema.org/InStock",
    // Alquiler de equipos (GoodRelations): deja explícito que el precio es de alquiler.
    businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
    seller: { "@id": ORGANIZATION_ID },
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      priceCurrency: "PYG",
      price: product.price,
      unitText: unitDescription(product.unit),
    },
  };
}

/** Ficha de producto: `Product` + `Offer` con precio PYG y unidad de cobro. */
export function productNode(product: Product): JsonLdNode {
  const url = absoluteUrl(productPath(product));
  return {
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: `${product.description} ${product.specs}.`,
    image: [absoluteUrl(product.image)],
    sku: product.code,
    category: "Alquiler de equipos para eventos",
    brand: { "@type": "Brand", name: businessProfile.name },
    url,
    offers: offerNode(product, url),
  };
}

/** Migas de pan visibles y en JSON-LD (mismo listado, una sola fuente). */
export function breadcrumbNode(items: Array<{ name: string; path: string }>): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Grafo de la página con el `@context` una sola vez. */
export function pageGraph(...nodes: JsonLdNode[]): JsonLdGraph {
  return { "@context": "https://schema.org", "@graph": nodes };
}
