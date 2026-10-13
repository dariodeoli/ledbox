/**
 * Tema de la tienda web de la empresa a partir de su color de marca. Puro y
 * testeable: valida el hex, mide el contraste (WCAG) y deriva los colores de
 * acento para el modo claro y el oscuro. Sin color, rige un tema neutro.
 */

export type Rgb = [number, number, number];

/** Superficies de la tienda (deben coincidir con `.cp-root` en globals.css). */
export const STORE_SURFACE_LIGHT = "#ffffff";
export const STORE_SURFACE_DARK = "#171b20";
export const STORE_BG_DARK = "#0e1114";

/** Contraste mínimo del color de marca contra el blanco (texto, links y botones). */
export const STORE_MIN_CONTRAST = 4.5;

export const NEUTRAL_THEME = {
  light: { accent: "#1f2937", on: "#ffffff" },
  dark: { accent: "#e5e7eb", on: "#0e1114" },
} as const;

/** `#abc` / `#aabbcc` (con o sin `#`) → `#aabbcc` en minúsculas; `null` si no es un hex válido. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) return `#${raw.split("").map((char) => char + char).join("").toLowerCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const clean = normalizeHex(hex) ?? "#000000";
  return [parseInt(clean.slice(1, 3), 16), parseInt(clean.slice(3, 5), 16), parseInt(clean.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Relación de contraste WCAG entre dos colores hex (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Valida el color de marca de los ajustes: hex válido y legible sobre blanco. */
export function parseStorefrontAccent(value: unknown): { ok: true; accent: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { ok: true, accent: null };
  const hex = normalizeHex(value);
  if (!hex) return { ok: false, error: "El color de marca tiene que ser un hexadecimal, por ejemplo #0b5cd5." };
  const ratio = contrastRatio(hex, STORE_SURFACE_LIGHT);
  if (ratio < STORE_MIN_CONTRAST) {
    return { ok: false, error: `Ese color es muy claro para leerse sobre fondo blanco (contraste ${ratio.toFixed(1).replace(".", ",")}:1, mínimo 4,5:1). Elegí un tono más oscuro.` };
  }
  return { ok: true, accent: hex };
}

/** Color de texto (blanco o casi negro) con más contraste sobre `background`. */
export function readableOn(background: string): string {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#0e1114") ? "#ffffff" : "#0e1114";
}

/** Aclara `hex` mezclándolo con blanco hasta alcanzar `min` contra `surface` (modo oscuro). */
export function lightenUntil(hex: string, surface: string, min: number): string {
  const base = hexToRgb(hex);
  for (let step = 0; step <= 20; step += 1) {
    const mix = step / 20;
    const candidate = rgbToHex([0, 1, 2].map((i) => base[i] + (255 - base[i]) * mix) as Rgb);
    if (contrastRatio(candidate, surface) >= min) return candidate;
  }
  return "#ffffff";
}

export type StorefrontTheme = {
  light: { accent: string; on: string };
  dark: { accent: string; on: string };
  /** `true` si rige el color de la empresa; `false` = tema neutro. */
  branded: boolean;
};

/** Tema de la tienda: marca de la empresa (si es válida) o neutro. Nunca lanza. */
export function storefrontTheme(accent: string | null | undefined): StorefrontTheme {
  const parsed = parseStorefrontAccent(accent ?? null);
  if (!parsed.ok || !parsed.accent) return { ...NEUTRAL_THEME, branded: false };
  const darkAccent = lightenUntil(parsed.accent, STORE_SURFACE_DARK, STORE_MIN_CONTRAST);
  return {
    light: { accent: parsed.accent, on: readableOn(parsed.accent) },
    dark: { accent: darkAccent, on: readableOn(darkAccent) },
    branded: true,
  };
}

/** Variables CSS del tema (se aplican en el contenedor de la tienda). */
export function storefrontThemeVars(theme: StorefrontTheme): Record<string, string> {
  return {
    "--cp-brand-l": theme.light.accent,
    "--cp-brand-on-l": theme.light.on,
    "--cp-brand-d": theme.dark.accent,
    "--cp-brand-on-d": theme.dark.on,
  };
}
