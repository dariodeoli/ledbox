import type { ThemeFont } from "./fonts";

export type ThemeColors = {
  bg: string;
  surface: string;
  /** Fondo de las fotos de producto (contain): blanco, para que las fotos con fondo blanco no floten en una caja de otro color. */
  photo: string;
  /** Superficie secundaria (arena / gris suave): bloques de sección, miniaturas, campos. */
  sand: string;
  text: string;
  muted: string;
  border: string;
  borderSoft: string;
  primary: string;
  /** Variante «hover» del primario y fondo de la barra de anuncio. */
  primary700: string;
  onPrimary: string;
  /** Color decorativo (líneas, íconos, badges grandes). Para texto chico se usa `accentText`. */
  accent: string;
  accentText: string;
  /** Fondo del pie y su texto. */
  ink: string;
  onInk: string;
  onInkMuted: string;
  success: string;
  warning: string;
  danger: string;
  infoBg: string;
  /** Texto sobre fotos (overlays) y el degradé que lo sostiene. */
  onImage: string;
  scrim: string;
  /** Barra de anuncio. */
  announceBg: string;
  announceText: string;
};

/** Variantes de layout: las lee el CSS por `data-*`; el marcado de los componentes es el mismo en los cuatro temas. */
export type ThemeLayout = {
  /** Tarjeta de categoría: caja con imagen arriba, o imagen a sangre con el texto encima. */
  category: "card" | "overlay";
  /** Densidad de la grilla del catálogo en escritorio. */
  grid: "airy" | "dense";
  /** Héroe: foto a sangre con velo, o franja plana de color. */
  hero: "photo" | "band";
  /** Botones: píldora o esquina suave. */
  button: "pill" | "soft";
  /** Foto de la tarjeta de producto sobre superficie blanca (`contain`) o a sangre (`cover`). */
  photoFit: "contain" | "cover";
};

export type ThemeDef = {
  /** Identificador estable (se guarda en la base). */
  id: string;
  /** «Rubro ideal»: agrupa las plantillas en el selector de Apariencia. */
  rubro: string;
  label: string;
  description: string;
  /** Frase corta de para quién es (se muestra en la tarjeta). */
  forWho: string;
  scheme: "light" | "dark";
  colors: ThemeColors;
  fonts: { display: ThemeFont; body: ThemeFont; script: ThemeFont | null };
  radius: { sm: string; md: string; lg: string; pill: string };
  shadow: { card: string; float: string };
  /** Escritorio / móvil. */
  space: { sectionD: string; sectionM: string; gutterD: string; gutterM: string };
  container: string;
  imageRatio: { card: string; category: string; hero: string };
  /** Tamaños de título (escritorio / móvil). Siguen la escala 12/14/16/20/24/32/48/64 salvo donde la spec de Boutique manda otra. */
  size: { heroD: string; heroM: string; h2D: string; h2M: string; nameD: string; nameM: string; titleD: string; titleM: string; price: string; priceLg: string; display: string };
  layout: ThemeLayout;
  /** Muestras de la miniatura en Apariencia: fondo, superficie, color primario. */
  swatch: [string, string, string];
};

