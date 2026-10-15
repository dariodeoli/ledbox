import { F, type ThemeFont } from "./storefront-themes/fonts";
import { STORE_THEMES, THEMES, type StoreThemeId } from "./storefront-themes";
import type { ThemeDef } from "./storefront-themes/types";
import { STORE_MIN_CONTRAST, contrastRatio, hexToRgb, normalizeHex, readableOn, rgbToHex, type Rgb } from "./storefront-theme";

/**
 * Sistema de temas de la tienda (docs/TIENDA-PLANTILLAS.md y docs/TIENDA-BOUTIQUE.md): Lienzo, Boutique, Noir y
 * Studio. Un tema = **un objeto de tokens** (colores, tipografías, radios, sombras, espacios, proporciones de imagen)
 * más **variantes de layout** (atributos `data-*` que el CSS de `app/tienda.css` lee). Es la ÚNICA fuente de verdad:
 * los componentes y el CSS de la tienda no llevan colores ni tamaños propios, solo `var(--…)`.
 *
 * Los nombres de las variables son los de la especificación: `--color-*`, `--font-*`, `--radius-*`, `--shadow-*`,
 * `--space-section`, `--container-max`, `--image-ratio-*`. Lo que cambia entre escritorio y móvil (gutter, espacio de
 * sección, tamaños de títulos) viaja como par `-d` / `-m` y el CSS elige según el ancho.
 *
 * Puro y testeable: el test mide el contraste AA de todos los pares de texto/fondo y de los botones de cada tema.
 */

export const DEFAULT_STORE_THEME: StoreThemeId = "lienzo";

export function isStoreTheme(value: unknown): value is StoreThemeId {
  return typeof value === "string" && (STORE_THEMES as readonly string[]).includes(value);
}

/**
 * Las plantillas de versiones anteriores pasan a las 4 nuevas (decisión del dueño, 2026-10-15). Las cinco de
 * v2.1.126 y las cinco clásicas anteriores a ellas. Es la tabla que usa el alias de lectura y la migración de datos
 * `202610300001_tienda_temas`: si cambia una, cambia la otra (lo verifica un test).
 */
export const LEGACY_TEMPLATE_MAP: Readonly<Record<string, StoreThemeId>> = {
  minimal: "lienzo",
  boutique: "boutique",
  noche: "noir",
  tecnologica: "noir",
  fresca: "studio",
  editorial: "boutique",
  clasica: "lienzo",
  minimalista: "lienzo",
  elegante: "boutique",
  oscura: "noir",
};

/** Plantilla vigente para un valor guardado (nuevo o viejo); `null` si no es de ninguna lista. */
export function resolveStoredTheme(value: unknown): StoreThemeId | null {
  if (isStoreTheme(value)) return value;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_TEMPLATE_MAP, value)) return LEGACY_TEMPLATE_MAP[value];
  return null;
}

/** Tipografías de títulos que la empresa puede elegir (lista curada). `null` = la del tema. */
export const DISPLAY_FONTS: readonly ThemeFont[] = [F.cormorant, F.playfair, F.fraunces, F.outfit, F.sora, F.archivo];
export type DisplayFontId = (typeof DISPLAY_FONTS)[number]["id"];

export function isDisplayFont(value: unknown): value is DisplayFontId {
  return typeof value === "string" && DISPLAY_FONTS.some((entry) => entry.id === value);
}

export function displayFontOf(id: unknown): ThemeFont | null {
  return DISPLAY_FONTS.find((entry) => entry.id === id) ?? null;
}

export { STORE_THEMES, THEMES };
export type { StoreThemeId, ThemeDef, ThemeFont };

// ── Color primario de la empresa (override) ──────────────────────────────────

const mix = (base: Rgb, target: Rgb, amount: number): Rgb => [0, 1, 2].map((i) => base[i] + (target[i] - base[i]) * amount) as Rgb;

/** Variante «hover» del primario de la empresa: oscurece (tema claro) o aclara (tema oscuro) sin perder el contraste del texto del botón. */
function hoverOf(hex: string, scheme: "light" | "dark", on: string): string {
  const target: Rgb = scheme === "light" ? [0, 0, 0] : [255, 255, 255];
  for (let step = 4; step >= 1; step -= 1) {
    const candidate = rgbToHex(mix(hexToRgb(hex), target, step * 0.07));
    if (contrastRatio(on, candidate) >= STORE_MIN_CONTRAST) return candidate;
  }
  return hex;
}

/**
 * Color primario efectivo: el de la empresa si da contraste AA contra el fondo y la superficie del tema (y el texto del
 * botón sobre él también); si no, el primario propio del tema. Nunca un botón ilegible.
 */
export function themePrimary(id: StoreThemeId, brand: string | null | undefined): { primary: string; primary700: string; onPrimary: string; fromBrand: boolean } {
  const t = THEMES[id];
  const hex = normalizeHex(brand ?? null);
  if (hex) {
    const surfacesOk = [t.colors.bg, t.colors.surface].every((surface) => contrastRatio(hex, surface) >= STORE_MIN_CONTRAST);
    const on = readableOn(hex);
    if (surfacesOk && contrastRatio(on, hex) >= STORE_MIN_CONTRAST) {
      return { primary: hex, primary700: hoverOf(hex, t.scheme, on), onPrimary: on, fromBrand: true };
    }
  }
  return { primary: t.colors.primary, primary700: t.colors.primary700, onPrimary: t.colors.onPrimary, fromBrand: false };
}

// ── Variables CSS ────────────────────────────────────────────────────────────

export type ThemeOptions = { brand?: string | null; displayFont?: string | null };

/** Fuentes efectivas del tema con el override de títulos de la empresa. */
export function themeFonts(id: StoreThemeId, displayFont?: string | null): { display: ThemeFont; body: ThemeFont; script: ThemeFont | null } {
  const t = THEMES[id];
  return { display: displayFontOf(displayFont) ?? t.fonts.display, body: t.fonts.body, script: t.fonts.script };
}

/**
 * Todas las variables CSS del tema, con los nombres de la especificación. Es lo que `StoreChrome` pone inline en el
 * contenedor de la tienda: no hay otra definición de colores, fuentes ni tamaños en el CSS.
 */
export function themeVars(id: StoreThemeId, options: ThemeOptions = {}): Record<string, string> {
  const t = THEMES[id];
  const c = t.colors;
  const primary = themePrimary(id, options.brand);
  const fonts = themeFonts(id, options.displayFont);
  return {
    "--color-bg": c.bg,
    "--color-surface": c.surface,
    "--color-photo": c.photo,
    "--color-sand": c.sand,
    "--color-text": c.text,
    "--color-muted": c.muted,
    "--color-border": c.border,
    "--color-border-soft": c.borderSoft,
    "--color-primary": primary.primary,
    "--color-primary-700": primary.primary700,
    "--color-on-primary": primary.onPrimary,
    "--color-accent": c.accent,
    "--color-accent-text": c.accentText,
    "--color-ink": c.ink,
    "--color-on-ink": c.onInk,
    "--color-on-ink-muted": c.onInkMuted,
    "--color-success": c.success,
    "--color-warning": c.warning,
    "--color-danger": c.danger,
    "--color-info-bg": c.infoBg,
    "--color-on-image": c.onImage,
    "--color-scrim": c.scrim,
    "--color-announce-bg": c.announceBg,
    "--color-announce-text": c.announceText,
    "--font-display": fonts.display.css,
    "--font-body": fonts.body.css,
    ...(fonts.script ? { "--font-script": fonts.script.css } : {}),
    "--font-weight-display": t.size.display,
    "--radius-sm": t.radius.sm,
    "--radius-md": t.radius.md,
    "--radius-lg": t.radius.lg,
    "--radius-pill": t.radius.pill,
    "--shadow-card": t.shadow.card,
    "--shadow-float": t.shadow.float,
    "--container-max": t.container,
    "--space-section-d": t.space.sectionD,
    "--space-section-m": t.space.sectionM,
    "--gutter-d": t.space.gutterD,
    "--gutter-m": t.space.gutterM,
    "--image-ratio-card": t.imageRatio.card,
    "--image-ratio-category": t.imageRatio.category,
    "--image-ratio-hero": t.imageRatio.hero,
    "--fs-hero-d": t.size.heroD,
    "--fs-hero-m": t.size.heroM,
    "--fs-h2-d": t.size.h2D,
    "--fs-h2-m": t.size.h2M,
    "--fs-name-d": t.size.nameD,
    "--fs-name-m": t.size.nameM,
    "--fs-title-d": t.size.titleD,
    "--fs-title-m": t.size.titleM,
    "--fs-price": t.size.price,
    "--fs-price-lg": t.size.priceLg,
  };
}

/** Atributos `data-*` del contenedor: tema, esquema y variantes de layout (el CSS los lee). */
export function themeAttrs(id: StoreThemeId): Record<string, string> {
  const t = THEMES[id];
  return {
    "data-store-theme": id,
    "data-store-scheme": t.scheme,
    "data-category": t.layout.category,
    "data-grid": t.layout.grid,
    "data-hero": t.layout.hero,
    "data-button": t.layout.button,
    "data-photo-fit": t.layout.photoFit,
  };
}

/** Hoja de Google Fonts del tema (títulos + cuerpo, y la manuscrita si el tema la usa), con `display=swap`. */
export function themeFontHref(id: StoreThemeId, displayFont?: string | null): string {
  const fonts = themeFonts(id, displayFont);
  const families = [...new Set([fonts.display.google, fonts.body.google, ...(fonts.script ? [fonts.script.google] : [])])];
  return `https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join("&")}&display=swap`;
}

/** Pares (texto, fondo) y su mínimo AA: lo que el test mide para cada tema (y con cualquier color de marca ya filtrado). */
export function themeContrastPairs(id: StoreThemeId): Array<{ name: string; fg: string; bg: string; min: number }> {
  const c = THEMES[id].colors;
  const min = STORE_MIN_CONTRAST;
  return [
    { name: "texto/fondo", fg: c.text, bg: c.bg, min },
    { name: "texto/superficie", fg: c.text, bg: c.surface, min },
    { name: "texto/arena", fg: c.text, bg: c.sand, min },
    { name: "texto/info", fg: c.text, bg: c.infoBg, min },
    { name: "secundario/fondo", fg: c.muted, bg: c.bg, min },
    { name: "secundario/superficie", fg: c.muted, bg: c.surface, min },
    { name: "secundario/arena", fg: c.muted, bg: c.sand, min },
    { name: "eyebrow/fondo", fg: c.accentText, bg: c.bg, min },
    { name: "eyebrow/superficie", fg: c.accentText, bg: c.surface, min },
    { name: "eyebrow/arena", fg: c.accentText, bg: c.sand, min },
    { name: "botón primario", fg: c.onPrimary, bg: c.primary, min },
    { name: "botón primario (hover)", fg: c.onPrimary, bg: c.primary700, min },
    { name: "primario como texto/fondo", fg: c.primary, bg: c.bg, min },
    { name: "primario como texto/superficie", fg: c.primary, bg: c.surface, min },
    { name: "ok/superficie", fg: c.success, bg: c.surface, min },
    { name: "aviso/superficie", fg: c.warning, bg: c.surface, min },
    { name: "error/superficie", fg: c.danger, bg: c.surface, min },
    { name: "pie", fg: c.onInk, bg: c.ink, min },
    { name: "pie (secundario)", fg: c.onInkMuted, bg: c.ink, min },
    { name: "barra de anuncio", fg: c.announceText, bg: c.announceBg, min },
    { name: "borde de control/fondo", fg: c.muted, bg: c.bg, min: 3 },
  ];
}
