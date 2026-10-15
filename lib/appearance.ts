import {
  DEFAULT_STORE_THEME,
  STORE_THEMES,
  THEMES,
  isDisplayFont,
  isStoreTheme,
  resolveStoredTheme,
  themeAttrs,
  themeFontHref,
  themeVars,
  type DisplayFontId,
  type StoreThemeId,
} from "./storefront-templates";
import { DEFAULT_HOME, parseHome, readHome, type HomeConfig } from "./store-home";
import { STORE_MIN_CONTRAST, STORE_SURFACE_LIGHT, contrastRatio, hexToRgb, normalizeHex, rgbToHex, type Rgb } from "./storefront-theme";

/**
 * Apariencia de las superficies del cliente (tienda y catálogo, mayorista, seguimiento del
 * pedido, portal, presupuesto impreso y correos). Todo es una **lista cerrada** o un valor
 * validado: plantilla (Lienzo, Boutique, Noir o Studio: solo tokens CSS, sin CSS libre), tipografía
 * de títulos de una lista curada, color de marca con contraste AA, barra de anuncio y modo de precio.
 * Reglas puras: las usan el API, las páginas públicas, el panel (vista previa en vivo) y los tests.
 *
 * Las plantillas de versiones anteriores (clásica, minimalista, elegante, oscura, editorial, tecnológica,
 * boutique, noche, fresca, minimal) se leen con un alias (`LEGACY_TEMPLATE_MAP`) y además las migra
 * `202610300001_tienda_temas`: ninguna fila queda con un valor que no exista.
 */

export const TEMPLATES = STORE_THEMES;
export type TemplateId = StoreThemeId;
export const DEFAULT_TEMPLATE: TemplateId = DEFAULT_STORE_THEME;

export const TEMPLATE_META: Record<TemplateId, { label: string; description: string; forWho: string }> = {
  lienzo: { label: THEMES.lienzo.label, description: THEMES.lienzo.description, forWho: THEMES.lienzo.forWho },
  boutique: { label: THEMES.boutique.label, description: THEMES.boutique.description, forWho: THEMES.boutique.forWho },
  noir: { label: THEMES.noir.label, description: THEMES.noir.description, forWho: THEMES.noir.forWho },
  studio: { label: THEMES.studio.label, description: THEMES.studio.description, forWho: THEMES.studio.forWho },
  jardin: { label: THEMES.jardin.label, description: THEMES.jardin.description, forWho: THEMES.jardin.forWho },
  marmol: { label: THEMES.marmol.label, description: THEMES.marmol.description, forWho: THEMES.marmol.forWho },
  terracota: { label: THEMES.terracota.label, description: THEMES.terracota.description, forWho: THEMES.terracota.forWho },
  nordico: { label: THEMES.nordico.label, description: THEMES.nordico.description, forWho: THEMES.nordico.forWho },
  gala: { label: THEMES.gala.label, description: THEMES.gala.description, forWho: THEMES.gala.forWho },
  brisa: { label: THEMES.brisa.label, description: THEMES.brisa.description, forWho: THEMES.brisa.forWho },
};

export function isTemplateId(value: unknown): value is TemplateId {
  return isStoreTheme(value);
}

/** Tipografías permitidas para el portal, el presupuesto impreso y los correos. `google` es el parámetro `family` de Google Fonts (null = del sistema). La tienda usa las de su plantilla. */
export const FONTS = [
  { id: "sistema", label: "Del sistema", family: 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif', google: null },
  { id: "inter", label: "Inter", family: '"Inter", system-ui, sans-serif', google: "Inter:wght@400;600;700;800" },
  { id: "poppins", label: "Poppins", family: '"Poppins", system-ui, sans-serif', google: "Poppins:wght@400;600;700" },
  { id: "montserrat", label: "Montserrat", family: '"Montserrat", system-ui, sans-serif', google: "Montserrat:wght@400;600;700;800" },
  { id: "lato", label: "Lato", family: '"Lato", system-ui, sans-serif', google: "Lato:wght@400;700;900" },
  { id: "nunito", label: "Nunito", family: '"Nunito", system-ui, sans-serif', google: "Nunito:wght@400;600;700;800" },
  { id: "dm-sans", label: "DM Sans", family: '"DM Sans", system-ui, sans-serif', google: "DM+Sans:wght@400;600;700" },
  { id: "cormorant-garamond", label: "Cormorant Garamond", family: '"Cormorant Garamond", Georgia, serif', google: "Cormorant+Garamond:wght@500;600;700" },
  { id: "playfair-display", label: "Playfair Display", family: '"Playfair Display", Georgia, serif', google: "Playfair+Display:wght@400;600;700;800" },
  { id: "merriweather", label: "Merriweather", family: '"Merriweather", Georgia, serif', google: "Merriweather:wght@400;700;900" },
] as const;
export type FontId = (typeof FONTS)[number]["id"];
export const DEFAULT_FONT: FontId = "sistema";

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONTS.some((font) => font.id === value);
}

export function fontOf(id: unknown): (typeof FONTS)[number] {
  return FONTS.find((font) => font.id === id) ?? FONTS[0];
}

/** Hoja de estilos de Google Fonts de la tipografía; `null` si es la del sistema. */
export function googleFontHref(id: unknown): string | null {
  const family = fontOf(id).google;
  return family ? `https://fonts.googleapis.com/css2?family=${family}&display=swap` : null;
}

/** Cómo se muestran los precios en la tienda: «por día», «c/u» (por pieza) o a cotizar (sin montos). */
export const PRICE_MODES = ["day", "unit", "quote"] as const;
export type PriceMode = (typeof PRICE_MODES)[number];
export const PRICE_MODE_LABEL: Record<PriceMode, string> = { day: "Por día", unit: "Por unidad (c/u)", quote: "A cotizar" };
export function isPriceMode(value: unknown): value is PriceMode {
  return typeof value === "string" && (PRICE_MODES as readonly string[]).includes(value);
}

export const ANNOUNCEMENT_MAX = 140;
export type Announcement = { on: boolean; text: string };

export type Appearance = {
  template: TemplateId;
  /** Tipografía del portal, el presupuesto impreso y los correos (la tienda usa la de su plantilla). */
  font: FontId;
  /** Tipografía de títulos de la tienda; `null` = la de la plantilla. */
  displayFont: DisplayFontId | null;
  /** Barra de anuncio de arriba de todo (opcional). */
  announcement: Announcement;
  priceMode: PriceMode;
  /** Inicio de la tienda: orden y visibilidad de las secciones, bloque editorial y textos de inspiración. */
  home: HomeConfig;
};

export const DEFAULT_APPEARANCE: Appearance = { template: DEFAULT_TEMPLATE, font: DEFAULT_FONT, displayFont: null, announcement: { on: false, text: "" }, priceMode: "day", home: DEFAULT_HOME };

/** Valida lo que manda el panel; los campos ausentes mantienen `current`. */
export function parseAppearance(body: unknown, current: Appearance = DEFAULT_APPEARANCE): { ok: true; appearance: Appearance } | { ok: false; error: string } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const next: Appearance = { ...current, announcement: { ...current.announcement }, home: current.home };
  if (input.template !== undefined) {
    if (!isTemplateId(input.template)) return { ok: false, error: "Elegí una plantilla de la lista: Lienzo, Boutique, Noir o Studio." };
    next.template = input.template;
  }
  if (input.font !== undefined) {
    if (!isFontId(input.font)) return { ok: false, error: "Elegí una tipografía de la lista." };
    next.font = input.font;
  }
  if (input.displayFont !== undefined) {
    if (input.displayFont === null || input.displayFont === "") next.displayFont = null;
    else if (isDisplayFont(input.displayFont)) next.displayFont = input.displayFont;
    else return { ok: false, error: "Elegí una tipografía de títulos de la lista." };
  }
  if (input.announcement !== undefined) {
    const raw = input.announcement && typeof input.announcement === "object" && !Array.isArray(input.announcement) ? (input.announcement as Record<string, unknown>) : null;
    if (!raw || (raw.on !== undefined && typeof raw.on !== "boolean") || (raw.text !== undefined && typeof raw.text !== "string")) {
      return { ok: false, error: "La barra de anuncio se enciende o se apaga y lleva un texto." };
    }
    const text = (typeof raw.text === "string" ? raw.text : next.announcement.text).replace(/\s+/g, " ").trim();
    if (text.length > ANNOUNCEMENT_MAX) return { ok: false, error: `El texto de la barra de anuncio no puede superar los ${ANNOUNCEMENT_MAX} caracteres.` };
    const on = typeof raw.on === "boolean" ? raw.on : next.announcement.on;
    if (on && !text) return { ok: false, error: "Escribí el texto de la barra de anuncio o apagala." };
    next.announcement = { on, text };
  }
  if (input.priceMode !== undefined) {
    if (!isPriceMode(input.priceMode)) return { ok: false, error: "Elegí cómo mostrar los precios: por día, por unidad o a cotizar." };
    next.priceMode = input.priceMode;
  }
  if (input.home !== undefined) {
    const home = parseHome(input.home, current.home);
    if (!home.ok) return home;
    next.home = home.home;
  }
  return { ok: true, appearance: next };
}

/**
 * Lee lo guardado (JSON de la base) tolerando filas viejas o rotas: nunca lanza. Las plantillas anteriores se
 * traducen con `LEGACY_TEMPLATE_MAP` y lo que ya no existe (fondo propio, acento manuscrito) se ignora.
 */
export function readAppearance(stored: unknown): Appearance {
  const record = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const template = resolveStoredTheme(record.template);
  const parsed = parseAppearance({ ...record, home: undefined, ...(template ? { template } : { template: undefined }) });
  if (parsed.ok) return { ...parsed.appearance, home: readHome(record.home) };
  // Una fila con un campo roto no tira todo: se conserva lo válido campo por campo.
  const partial: Appearance = { ...DEFAULT_APPEARANCE, announcement: { ...DEFAULT_APPEARANCE.announcement }, home: readHome(record.home) };
  if (template) partial.template = template;
  if (isFontId(record.font)) partial.font = record.font;
  if (isDisplayFont(record.displayFont)) partial.displayFont = record.displayFont;
  if (isPriceMode(record.priceMode)) partial.priceMode = record.priceMode;
  const ann = parseAppearance({ announcement: record.announcement });
  if (ann.ok) partial.announcement = ann.appearance.announcement;
  return partial;
}

// ── Color de marca con control de contraste AA ───────────────────────────────

const mixToward = (base: Rgb, target: Rgb, amount: number): Rgb => [0, 1, 2].map((i) => base[i] + (target[i] - base[i]) * amount) as Rgb;

export type BrandColorResult = {
  /** Color que se guarda y se usa. */
  color: string;
  /** El que pidió la empresa (normalizado). */
  requested: string;
  adjusted: boolean;
  /** Contraste del color final contra la peor de las superficies. */
  ratio: number;
  /** Aviso para mostrar cuando se ajustó (castellano). */
  notice: string | null;
};

const fmt = (value: number) => value.toFixed(1).replace(".", ",");

/**
 * Valida el color de marca y, si no llega a AA (≥ 4,5:1) sobre las superficies donde se usa
 * como texto, botón o enlace, lo **oscurece** lo mínimo necesario y avisa. Superficies: blanco
 * (la tarjeta y el correo) y, si la empresa eligió un fondo claro propio, ese fondo. La
 * versión para modo oscuro/plantilla Oscura no se guarda: `storefrontTheme` la deriva
 * aclarando este mismo color hasta AA sobre la superficie oscura. `null` = sin color (tema neutro).
 */
export function adjustBrandColor(value: unknown): { ok: true; result: BrandColorResult | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { ok: true, result: null };
  const requested = normalizeHex(value);
  if (!requested) return { ok: false, error: "El color de marca tiene que ser un hexadecimal, por ejemplo #0b5cd5." };

  const worst = (hex: string) => contrastRatio(hex, STORE_SURFACE_LIGHT);
  if (worst(requested) >= STORE_MIN_CONTRAST) {
    return { ok: true, result: { color: requested, requested, adjusted: false, ratio: worst(requested), notice: null } };
  }
  const base = hexToRgb(requested);
  let color = requested;
  for (let step = 1; step <= 40; step += 1) {
    color = rgbToHex(mixToward(base, [0, 0, 0], step / 40));
    if (worst(color) >= STORE_MIN_CONTRAST) break;
  }
  const ratio = worst(color);
  return {
    ok: true,
    result: {
      color,
      requested,
      adjusted: true,
      ratio,
      notice: `Ajustamos ${requested} a ${color} para que se lea bien (contraste ${fmt(ratio)}:1, el mínimo es ${fmt(STORE_MIN_CONTRAST)}:1).`,
    },
  };
}

// ── Variables CSS de la apariencia ───────────────────────────────────────────

export type AppearanceView = {
  template: TemplateId;
  /** Hoja de Google Fonts a enlazar. */
  fontHref: string;
  /** Variables CSS inline del contenedor (todas con los nombres de la especificación: `--color-*`, `--font-*`…). */
  vars: Record<string, string>;
  /** Atributos `data-*` del contenedor: tema, esquema y variantes de layout. */
  attrs: Record<string, string>;
  /** Barra de anuncio: solo si está encendida y tiene texto. */
  announcement: string | null;
  priceMode: PriceMode;
  home: HomeConfig;
};

/**
 * Todo lo que necesita una superficie para vestirse con la apariencia. `brand` es el color de marca de la empresa
 * (`storefrontAccent`): rige como color primario solo si da contraste AA con el tema (ver `themePrimary`).
 */
export function appearanceView(appearance: Appearance, brand: string | null = null): AppearanceView {
  return {
    template: appearance.template,
    fontHref: themeFontHref(appearance.template, appearance.displayFont),
    vars: themeVars(appearance.template, { brand, displayFont: appearance.displayFont }),
    attrs: themeAttrs(appearance.template),
    announcement: appearance.announcement.on && appearance.announcement.text ? appearance.announcement.text : null,
    priceMode: appearance.priceMode,
    home: appearance.home,
  };
}

// ── Portada: dos archivos separados ──────────────────────────────────────────

export const COVER_KINDS = ["desktop", "mobile"] as const;
export type CoverKind = (typeof COVER_KINDS)[number];
export const COVER_SPEC: Record<CoverKind, { label: string; width: number; height: number; hint: string }> = {
  desktop: { label: "Portada de escritorio", width: 1920, height: 600, hint: "Recomendada 1920 × 600 px (horizontal)." },
  mobile: { label: "Portada de celular", width: 1080, height: 1350, hint: "Recomendada 1080 × 1350 px (vertical, 4:5)." },
};
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_MIN_WIDTH = 400;
export const COVER_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isCoverKind(value: unknown): value is CoverKind {
  return typeof value === "string" && (COVER_KINDS as readonly string[]).includes(value);
}

export const COVER_MESSAGES = {
  empty: "El archivo está vacío; probá con otra imagen.",
  tooBig: "La portada supera los 2 MB: comprimila o elegí otra.",
  notImage: "El archivo no es un JPG, PNG o WebP real: revisá que no esté renombrado.",
  tooSmall: `La imagen es demasiado chica (mínimo ${COVER_MIN_WIDTH} px de ancho).`,
  unreadable: "No pudimos procesar la imagen; probá con otra.",
} as const;

/** Chequeo previo y puro del archivo de la portada (tamaño y firma real). */
export function checkCoverFile(bytes: Uint8Array): { ok: true; mime: (typeof COVER_MIMES)[number] } | { ok: false; error: string } {
  if (bytes.byteLength === 0) return { ok: false, error: COVER_MESSAGES.empty };
  if (bytes.byteLength > COVER_MAX_BYTES) return { ok: false, error: COVER_MESSAGES.tooBig };
  const mime = sniffImageMime(bytes);
  if (!mime) return { ok: false, error: COVER_MESSAGES.notImage };
  return { ok: true, mime };
}

/** Firma real (magic bytes) de JPG, PNG o WebP. */
export function sniffImageMime(bytes: Uint8Array): (typeof COVER_MIMES)[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Cómo se recorta la portada en pantalla: la caja tiene esta proporción y la imagen la cubre (`cover`). */
export const COVER_ASPECT: Record<CoverKind, string> = { desktop: "1920 / 600", mobile: "1080 / 1350" };
