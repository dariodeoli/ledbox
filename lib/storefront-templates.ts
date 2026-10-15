import { STORE_MIN_CONTRAST, contrastRatio, normalizeHex, readableOn, type StorefrontTheme } from "./storefront-theme";

/**
 * Cinco plantillas «de diseño» de la tienda: Tecnológica, Boutique, Noche, Fresca y Minimal. Cada
 * una es **solo tokens** (colores, tipografías, radios, sombras, fondo y patrón) más CSS acotado
 * bajo `[data-store-template="<id>"]` en globals.css; no tocan el marcado de los componentes.
 * Puro y testeable: el test mide el contraste de todos los pares de texto/fondo y de los botones.
 * El color de marca de la empresa manda como acento solo si da contraste AA contra la superficie
 * y el fondo de la plantilla; si no, cae al acento propio de la plantilla.
 */

export const DESIGN_TEMPLATES = ["tecnologica", "boutique", "noche", "fresca", "minimal"] as const;
export type DesignTemplateId = (typeof DESIGN_TEMPLATES)[number];

export function isDesignTemplate(value: unknown): value is DesignTemplateId {
  return typeof value === "string" && (DESIGN_TEMPLATES as readonly string[]).includes(value);
}

/** Familia de Google Fonts de una lista cerrada (parámetro `family` de la API css2). */
export type TemplateFont = { family: string; css: string; google: string };

export type TemplateTokens = {
  label: string;
  description: string;
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  ok: string;
  warn: string;
  danger: string;
  /** Acento propio: rige cuando la empresa no tiene color de marca o el suyo no da contraste AA. */
  accent: string;
  /** Hasta dos familias por plantilla. `body` puede repetir `head` (una sola familia). */
  head: TemplateFont;
  body: TemplateFont;
  radiusCard: string;
  radiusButton: string;
  radiusChip: string;
  shadow: string;
  /** Fondo de la tienda (degradés y patrón de puntos en CSS puro; sin imágenes). */
  backdrop: string;
  /** Colores de la miniatura en Apariencia (fondo, superficie, acento). */
  swatch: [string, string, string];
};

const INTER: TemplateFont = { family: "Inter", css: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif', google: "Inter:wght@400;500;600;700" };

export const TEMPLATE_TOKENS: Record<DesignTemplateId, TemplateTokens> = {
  tecnologica: {
    label: "Tecnológica",
    description: "Degradé cian y violeta con puntos, títulos en mayúsculas, códigos y botones con contorno.",
    scheme: "light",
    bg: "#f1f4ff",
    surface: "#ffffff",
    text: "#141a33",
    muted: "#4a5072",
    line: "#c3cae6",
    ok: "#0f6b3a",
    warn: "#8a4b00",
    danger: "#b3261e",
    accent: "#4338ca",
    head: { family: "Space Grotesk", css: '"Space Grotesk", "Inter", system-ui, sans-serif', google: "Space+Grotesk:wght@500;600;700" },
    body: INTER,
    radiusCard: "14px",
    radiusButton: "10px",
    radiusChip: "6px",
    shadow: "0 22px 44px -34px rgba(76, 61, 186, 0.55), 0 2px 8px -4px rgba(76, 61, 186, 0.16)",
    backdrop:
      "radial-gradient(60rem 40rem at 4% -6%, rgba(110, 231, 249, 0.5), transparent 62%), radial-gradient(54rem 38rem at 102% 0%, rgba(186, 172, 255, 0.45), transparent 62%), radial-gradient(rgba(28, 34, 74, 0.1) 1px, transparent 1.4px) 0 0 / 22px 22px, linear-gradient(180deg, #f2f4ff, #f1f4ff)",
    swatch: ["#e7f7ff", "#ffffff", "#4338ca"],
  },
  boutique: {
    label: "Boutique",
    description: "Blanco roto, serif fina, mucho aire y acentos dorados. Para vajilla y decoración.",
    scheme: "light",
    bg: "#faf7f2",
    surface: "#fffdf9",
    text: "#2b2620",
    muted: "#6a5f52",
    line: "#e0d5c3",
    ok: "#2b6638",
    warn: "#864a00",
    danger: "#a3231c",
    accent: "#8a6a2f",
    head: { family: "Cormorant Garamond", css: '"Cormorant Garamond", Georgia, "Times New Roman", serif', google: "Cormorant+Garamond:wght@500;600;700" },
    body: { family: "Jost", css: '"Jost", system-ui, -apple-system, "Segoe UI", sans-serif', google: "Jost:wght@400;500;600" },
    radiusCard: "2px",
    radiusButton: "0px",
    radiusChip: "0px",
    shadow: "0 1px 0 rgba(138, 106, 47, 0.14)",
    backdrop: "linear-gradient(180deg, #fbf8f3, #faf7f2 60%, #f6f0e6)",
    swatch: ["#faf7f2", "#fffdf9", "#8a6a2f"],
  },
  noche: {
    label: "Noche",
    description: "Oscura y elegante, con acento champagne. Para eventos nocturnos y sonido.",
    scheme: "dark",
    bg: "#0b0d14",
    surface: "#141826",
    text: "#eef0f7",
    muted: "#a9b0c6",
    line: "#343b52",
    ok: "#6fdc9b",
    warn: "#ffc27a",
    danger: "#ff8f88",
    accent: "#e6c78a",
    head: { family: "Sora", css: '"Sora", "Inter", system-ui, sans-serif', google: "Sora:wght@400;600;700" },
    body: INTER,
    radiusCard: "16px",
    radiusButton: "12px",
    radiusChip: "999px",
    shadow: "0 24px 48px -30px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
    backdrop:
      "radial-gradient(56rem 34rem at 12% -8%, rgba(120, 90, 220, 0.2), transparent 62%), radial-gradient(48rem 32rem at 100% 4%, rgba(230, 199, 138, 0.1), transparent 60%), linear-gradient(180deg, #0d1018, #0b0d14)",
    swatch: ["#0b0d14", "#141826", "#e6c78a"],
  },
  fresca: {
    label: "Fresca",
    description: "Clara y luminosa, pasteles, radios grandes y letra redondeada. Para infantiles y catering.",
    scheme: "light",
    bg: "#f5fbf8",
    surface: "#ffffff",
    text: "#1f2a37",
    muted: "#4b5a6b",
    line: "#cfe6dd",
    ok: "#0f6b3a",
    warn: "#8a4b00",
    danger: "#b3261e",
    accent: "#be185d",
    head: { family: "Fredoka", css: '"Fredoka", "Nunito", system-ui, sans-serif', google: "Fredoka:wght@500;600;700" },
    body: { family: "Nunito", css: '"Nunito", system-ui, -apple-system, "Segoe UI", sans-serif', google: "Nunito:wght@400;600;700;800" },
    radiusCard: "26px",
    radiusButton: "999px",
    radiusChip: "999px",
    shadow: "0 18px 36px -26px rgba(190, 24, 93, 0.35), 0 2px 6px -2px rgba(31, 42, 55, 0.08)",
    backdrop:
      "radial-gradient(34rem 26rem at 0% 0%, rgba(255, 214, 224, 0.75), transparent 62%), radial-gradient(32rem 26rem at 100% 8%, rgba(200, 235, 255, 0.8), transparent 62%), radial-gradient(36rem 28rem at 92% 100%, rgba(255, 238, 190, 0.7), transparent 60%), radial-gradient(30rem 24rem at 4% 96%, rgba(204, 245, 222, 0.8), transparent 60%), #f5fbf8",
    swatch: ["#ffe3ec", "#ffffff", "#be185d"],
  },
  minimal: {
    label: "Minimal",
    description: "Monocromo, grilla estricta, tipografía suiza y bordes finos. Para empresas corporativas.",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    text: "#111111",
    muted: "#555555",
    line: "#d4d4d4",
    ok: "#0f6b3a",
    warn: "#8a4b00",
    danger: "#b3261e",
    accent: "#111111",
    head: INTER,
    body: INTER,
    radiusCard: "0px",
    radiusButton: "0px",
    radiusChip: "0px",
    shadow: "none",
    backdrop: "#ffffff",
    swatch: ["#ffffff", "#f1f1f1", "#111111"],
  },
};

/** Hoja de Google Fonts de la plantilla (hasta 2 familias, `display=swap`). */
export function templateFontHref(id: DesignTemplateId, bodyOverride?: string | null): string {
  const { head, body } = TEMPLATE_TOKENS[id];
  const families = [...new Set([head.google, bodyOverride ?? body.google])];
  return `https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join("&")}&display=swap`;
}

/** Pares (texto, fondo) y su mínimo AA: lo que el test mide para cada plantilla. */
export function templateContrastPairs(id: DesignTemplateId): Array<{ name: string; fg: string; bg: string; min: number }> {
  const t = TEMPLATE_TOKENS[id];
  const accent = templateAccent(id, null);
  return [
    { name: "texto/fondo", fg: t.text, bg: t.bg, min: STORE_MIN_CONTRAST },
    { name: "texto/superficie", fg: t.text, bg: t.surface, min: STORE_MIN_CONTRAST },
    { name: "secundario/fondo", fg: t.muted, bg: t.bg, min: STORE_MIN_CONTRAST },
    { name: "secundario/superficie", fg: t.muted, bg: t.surface, min: STORE_MIN_CONTRAST },
    { name: "acento/fondo", fg: accent.accent, bg: t.bg, min: STORE_MIN_CONTRAST },
    { name: "acento/superficie", fg: accent.accent, bg: t.surface, min: STORE_MIN_CONTRAST },
    { name: "botón primario", fg: accent.on, bg: accent.accent, min: STORE_MIN_CONTRAST },
    { name: "ok/superficie", fg: t.ok, bg: t.surface, min: STORE_MIN_CONTRAST },
    { name: "aviso/superficie", fg: t.warn, bg: t.surface, min: STORE_MIN_CONTRAST },
    { name: "error/superficie", fg: t.danger, bg: t.surface, min: STORE_MIN_CONTRAST },
    { name: "borde/fondo (control)", fg: t.muted, bg: t.bg, min: 3 },
  ];
}

/**
 * Acento de la plantilla: el color de marca de la empresa si da contraste AA contra el fondo y la
 * superficie de la plantilla (y el texto del botón sobre él también); si no, el acento propio.
 */
export function templateAccent(id: DesignTemplateId, brand: string | null | undefined): { accent: string; on: string; fromBrand: boolean } {
  const t = TEMPLATE_TOKENS[id];
  const hex = normalizeHex(brand ?? null);
  if (hex) {
    const ok = [t.bg, t.surface].every((surface) => contrastRatio(hex, surface) >= STORE_MIN_CONTRAST);
    const on = readableOn(hex);
    if (ok && contrastRatio(on, hex) >= STORE_MIN_CONTRAST) return { accent: hex, on, fromBrand: true };
  }
  return { accent: t.accent, on: readableOn(t.accent), fromBrand: false };
}

/** Tema de la tienda para una plantilla de diseño: mismo acento en claro y oscuro (la plantilla manda el esquema). */
export function designTemplateTheme(id: DesignTemplateId, theme: StorefrontTheme): StorefrontTheme {
  const brand = theme.branded ? theme.light.accent : null;
  const { accent, on, fromBrand } = templateAccent(id, brand);
  return { light: { accent, on }, dark: { accent, on }, branded: fromBrand };
}

/** Variables CSS de la plantilla (todas `--cp-*`). El acento lo pone `StoreChrome` con el color de marca. */
export function templateVars(id: DesignTemplateId): Record<string, string> {
  const t = TEMPLATE_TOKENS[id];
  return {
    "--cp-bg": t.bg,
    "--cp-surface": t.surface,
    "--cp-text": t.text,
    "--cp-muted": t.muted,
    "--cp-line": t.line,
    "--cp-ok": t.ok,
    "--cp-warn": t.warn,
    "--cp-danger": t.danger,
    "--cp-font-head": t.head.css,
    "--cp-font-body": t.body.css,
    "--cp-r-card": t.radiusCard,
    "--cp-r-btn": t.radiusButton,
    "--cp-r-chip": t.radiusChip,
    "--cp-shadow": t.shadow,
    "--cp-backdrop": t.backdrop,
  };
}
