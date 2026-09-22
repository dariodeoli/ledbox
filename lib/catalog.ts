export type BillingUnit = "sqm-day" | "day" | "event";

export type Product = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  description: string;
  price: number;
  unit: BillingUnit;
  unitLabel: string;
  image: string;
  width: number;
  height: number;
  alt: string;
  specs: string;
};

export const products: Product[] = [
  { id: "pantalla-led", code: "P·01", name: "Pantallas LED", shortName: "Pantalla LED", description: "Panel modular para escenarios, ferias y activaciones.", price: 480000, unit: "sqm-day", unitLabel: "por m² / día", image: "/assets/products/pantalla-led.png", width: 722, height: 1002, alt: "Pantalla LED modular para eventos", specs: "0,50 × 1,00 m por módulo · P1.85" },
  { id: "totem-led", code: "P·02", name: "Tótem LED", shortName: "Tótem LED", description: "Impacto vertical para accesos, stands y experiencias de marca.", price: 950000, unit: "day", unitLabel: "por día", image: "/assets/products/totem-led.png", width: 744, height: 976, alt: "Tótem LED vertical", specs: "0,64 × 1,90 m · 320 × 960 px · 2.500 nits" },
  { id: "totem-touch", code: "P·03", name: "Tótem Touch", shortName: "Tótem Touch", description: "Interacción digital para contenidos, registros y activaciones.", price: 1200000, unit: "day", unitLabel: "por día", image: "/assets/products/totem-touch.png", width: 740, height: 958, alt: "Tótem touch para eventos", specs: "Pantalla 0,60 × 1,85 m · LCD 43” · 1.080 × 1.920 px" },
  { id: "kiosko-touch", code: "P·04", name: "Kiosko Touch", shortName: "Kiosko Touch", description: "Punto interactivo móvil para ferias y exhibiciones.", price: 1200000, unit: "day", unitLabel: "por día", image: "/assets/products/kiosko-touch.png", width: 716, height: 992, alt: "Kiosko touch móvil", specs: "Pantalla vertical · base circular · batería 4–6 h" },
  { id: "pantalla-multimedia", code: "P·05", name: "Pantalla Multimedia", shortName: "Pantalla Multimedia", description: "Display inteligente para recepción, contenido y señalización.", price: 1000000, unit: "day", unitLabel: "por día", image: "/assets/products/pantalla-multimedia.png", width: 698, height: 992, alt: "Pantalla multimedia inteligente", specs: "21,5” · Full HD · Android 12 · batería 4–6 h" },
  { id: "cilindro-led", code: "P·06", name: "Cilindro LED", shortName: "Cilindro LED", description: "Formato inmersivo suspendido para espacios que buscan diferenciarse.", price: 1500000, unit: "day", unitLabel: "por día", image: "/assets/products/cilindro-led.png", width: 732, height: 1004, alt: "Cilindro LED suspendido", specs: "0,32 m alto × 0,65 m diámetro · P1.85" },
  { id: "dispensador-inteligente", code: "P·07", name: "Dispensador Inteligente", shortName: "Dispensador Inteligente", description: "Experiencia automatizada para bebidas y puntos de atención.", price: 650000, unit: "event", unitLabel: "por evento", image: "/assets/products/dispensador-inteligente.png", width: 850, height: 658, alt: "Dispensador inteligente para eventos", specs: "Medida a confirmar · consultar disponibilidad" }
];

export const formatGs = (amount: number) => `Gs. ${amount.toLocaleString("es-PY")}`;
export const unitDescription = (unit: BillingUnit) => unit === "sqm-day" ? "m² / día" : unit === "day" ? "día" : "evento";

// ── URLs públicas por producto (issue #38) ─────────────────────────────────
// El `id` del catálogo es el slug canónico de la ficha (`/productos/<id>`);
// no hay un segundo identificador que se pueda desincronizar.

/** Path público de la ficha de un producto. */
export function productPath(product: Pick<Product, "id">): string {
  return `/productos/${product.id}`;
}

/** Producto por slug de URL; `null` si no existe (la página responde 404). */
export function productBySlug(slug: string): Product | null {
  return products.find(product => product.id === slug) ?? null;
}
