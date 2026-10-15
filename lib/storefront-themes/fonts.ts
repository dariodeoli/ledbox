/** Familias de Google Fonts de una lista cerrada. Un tema nuevo reutiliza estas o suma la suya acá. */
/** Familia de Google Fonts (parámetro `family` de la API css2). */
export type ThemeFont = { id: string; label: string; css: string; google: string };

export const font = (id: string, label: string, css: string, google: string): ThemeFont => ({ id, label, css, google });
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const F = {
  outfit: font("outfit", "Outfit", `"Outfit", ${SANS_FALLBACK}`, "Outfit:wght@400;500;600"),
  inter: font("inter", "Inter", `"Inter", ${SANS_FALLBACK}`, "Inter:wght@400;500;600;700"),
  cormorant: font("cormorant", "Cormorant Garamond", `"Cormorant Garamond", ${SERIF_FALLBACK}`, "Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500"),
  playfair: font("playfair", "Playfair Display", `"Playfair Display", ${SERIF_FALLBACK}`, "Playfair+Display:wght@400;500;600"),
  fraunces: font("fraunces", "Fraunces", `"Fraunces", ${SERIF_FALLBACK}`, "Fraunces:wght@400;500;600"),
  jost: font("jost", "Jost", `"Jost", ${SANS_FALLBACK}`, "Jost:wght@400;500;600"),
  sora: font("sora", "Sora", `"Sora", ${SANS_FALLBACK}`, "Sora:wght@400;600;700"),
  archivo: font("archivo", "Archivo", `"Archivo", ${SANS_FALLBACK}`, "Archivo:wght@500;700;800"),
  lora: font("lora", "Lora", `"Lora", ${SERIF_FALLBACK}`, "Lora:wght@400;500;600"),
  sourceSans: font("source-sans", "Source Sans 3", `"Source Sans 3", ${SANS_FALLBACK}`, "Source+Sans+3:wght@400;600;700"),
  jakarta: font("jakarta", "Plus Jakarta Sans", `"Plus Jakarta Sans", ${SANS_FALLBACK}`, "Plus+Jakarta+Sans:wght@400;500;600;700"),
  pinyon: font("pinyon", "Pinyon Script", '"Pinyon Script", "Segoe Script", cursive', "Pinyon+Script"),
} as const;

/** Tipografías de títulos que la empresa puede elegir (lista curada). `null` = la del tema. */
export const DISPLAY_FONTS: readonly ThemeFont[] = [F.cormorant, F.playfair, F.fraunces, F.outfit, F.sora, F.archivo];
export type DisplayFontId = (typeof DISPLAY_FONTS)[number]["id"];

export function isDisplayFont(value: unknown): value is DisplayFontId {
  return typeof value === "string" && DISPLAY_FONTS.some((entry) => entry.id === value);
}

export function displayFontOf(id: unknown): ThemeFont | null {
  return DISPLAY_FONTS.find((entry) => entry.id === id) ?? null;
}

