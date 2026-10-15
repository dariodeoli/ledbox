import { STORE_MIN_CONTRAST, STORE_SURFACE_LIGHT, contrastRatio, hexToRgb, normalizeHex, rgbToHex, type Rgb } from "./storefront-theme";

/**
 * Apariencia de las superficies del cliente (tienda y catálogo, mayorista, seguimiento del
 * pedido, portal, presupuesto impreso y correos). Todo es una **lista cerrada** o un valor
 * validado: plantilla (solo tokens CSS, sin CSS libre), tipografía (Google Fonts de una lista),
 * color de marca con contraste AA y fondo opcional claro. Reglas puras: las usan el API, las
 * páginas públicas, el panel (vista previa en vivo) y los tests.
 */

export const TEMPLATES = ["clasica", "minimalista", "elegante", "oscura", "editorial"] as const;
export type TemplateId = (typeof TEMPLATES)[number];
export const DEFAULT_TEMPLATE: TemplateId = "clasica";

export const TEMPLATE_META: Record<TemplateId, { label: string; description: string }> = {
  clasica: { label: "Clásica", description: "Portada centrada, tarjetas con borde y esquinas redondeadas." },
  minimalista: { label: "Minimalista", description: "Sin recuadros, lista limpia y mucho aire entre secciones." },
  elegante: { label: "Elegante", description: "Títulos con serif, líneas finas y tarjetas sobrias." },
  oscura: { label: "Oscura", description: "Fondo oscuro siempre, con tarjetas elevadas." },
  editorial: { label: "Catálogo editorial", description: "Fondo crema, títulos serif con acento manuscrito, verde oliva y secciones grandes por categoría, como un catálogo impreso." },
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATES as readonly string[]).includes(value);
}

/** Tipografías permitidas. `google` es el parámetro `family` de Google Fonts (null = del sistema). */
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

/** Tipografías serif de la lista: sirven para los títulos de la plantilla editorial. */
const SERIF_FONTS: readonly FontId[] = ["cormorant-garamond", "playfair-display", "merriweather"];
const EDITORIAL_HEAD = fontOf("cormorant-garamond");

/** Acento manuscrito opcional de los títulos de sección (plantilla editorial). Lista cerrada de una. */
export const SCRIPT_FONT = { label: "Allura", family: '"Allura", "Segoe Script", cursive', google: "Allura" } as const;

/** Hoja de estilos de Google Fonts de las tipografías dadas; `null` si ninguna es de Google. */
function googleHref(families: ReadonlyArray<string | null>): string | null {
  const list = [...new Set(families.filter((family): family is string => Boolean(family)))];
  return list.length ? `https://fonts.googleapis.com/css2?${list.map((family) => `family=${family}`).join("&")}&display=swap` : null;
}

/** Hoja de estilos de Google Fonts de la tipografía; `null` si es la del sistema. */
export function googleFontHref(id: unknown): string | null {
  return googleHref([fontOf(id).google]);
}

export type Appearance = {
  template: TemplateId;
  font: FontId;
  /** Fondo claro opcional de la tienda (`#rrggbb`); `null` = el de la plantilla. */
  background: string | null;
  /** Acento manuscrito en los títulos de sección (solo lo usa la plantilla editorial). */
  script: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = { template: DEFAULT_TEMPLATE, font: DEFAULT_FONT, background: null, script: false };

/** El fondo propio tiene que ser claro: texto casi negro con contraste mínimo 7:1 (AAA). */
export const BACKGROUND_TEXT = "#14181d";
export const BACKGROUND_MIN_CONTRAST = 7;

export function parseBackground(value: unknown): { ok: true; background: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { ok: true, background: null };
  const hex = normalizeHex(value);
  if (!hex) return { ok: false, error: "El fondo tiene que ser un hexadecimal, por ejemplo #f6f1e8." };
  if (contrastRatio(hex, BACKGROUND_TEXT) < BACKGROUND_MIN_CONTRAST) {
    return { ok: false, error: "Ese fondo es muy oscuro para el texto: elegí un tono claro (o usá la plantilla Oscura)." };
  }
  return { ok: true, background: hex };
}

/** Valida lo que manda el panel; los campos ausentes mantienen `current`. */
export function parseAppearance(body: unknown, current: Appearance = DEFAULT_APPEARANCE): { ok: true; appearance: Appearance } | { ok: false; error: string } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const next: Appearance = { ...current };
  if (input.template !== undefined) {
    if (!isTemplateId(input.template)) return { ok: false, error: "Elegí una plantilla de la lista: Clásica, Minimalista, Elegante, Oscura o Catálogo editorial." };
    next.template = input.template;
  }
  if (input.font !== undefined) {
    if (!isFontId(input.font)) return { ok: false, error: "Elegí una tipografía de la lista." };
    next.font = input.font;
  }
  if (input.background !== undefined) {
    const background = parseBackground(input.background);
    if (!background.ok) return background;
    next.background = background.background;
  }
  if (input.script !== undefined) {
    if (typeof input.script !== "boolean") return { ok: false, error: "El acento manuscrito se enciende o se apaga." };
    next.script = input.script;
  }
  return { ok: true, appearance: next };
}

/** Lee lo guardado (JSON de la base) tolerando filas viejas o rotas: nunca lanza. */
export function readAppearance(stored: unknown): Appearance {
  const parsed = parseAppearance(stored);
  return parsed.ok ? parsed.appearance : { ...DEFAULT_APPEARANCE };
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
export function adjustBrandColor(
  value: unknown,
  options: { background?: string | null } = {},
): { ok: true; result: BrandColorResult | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { ok: true, result: null };
  const requested = normalizeHex(value);
  if (!requested) return { ok: false, error: "El color de marca tiene que ser un hexadecimal, por ejemplo #0b5cd5." };

  const surfaces = [STORE_SURFACE_LIGHT, ...(options.background ? [options.background] : [])];
  const worst = (hex: string) => Math.min(...surfaces.map((surface) => contrastRatio(hex, surface)));
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

/** Mezcla `text` hacia `bg` hasta el contraste justo ≥ 4,5 (texto secundario sobre el fondo propio). */
export function mutedOn(bg: string, text: string = BACKGROUND_TEXT): string {
  const base = hexToRgb(text);
  const to = hexToRgb(bg);
  let best = text;
  for (let step = 0; step <= 20; step += 1) {
    const candidate = rgbToHex(mixToward(base, to, (step / 20) * 0.6));
    if (contrastRatio(candidate, bg) >= STORE_MIN_CONTRAST) best = candidate;
    else break;
  }
  return best;
}

export type AppearanceView = {
  template: TemplateId;
  /** Hoja de Google Fonts a enlazar (null = tipografía del sistema). */
  fontHref: string | null;
  /** Variables CSS inline del contenedor. */
  vars: Record<string, string>;
  /** Atributos `data-*` del contenedor. */
  attrs: { "data-cp-template": TemplateId; "data-cp-bg": "custom" | "default"; "data-cp-script": "on" | "off" };
};

/** Todo lo que necesita una superficie para vestirse con la apariencia. */
export function appearanceView(appearance: Appearance): AppearanceView {
  const font = fontOf(appearance.font);
  const vars: Record<string, string> = { "--cp-font-body": font.family, "--cp-font-head": font.family };
  if (appearance.template === "elegante" && font.id === "sistema") vars["--cp-font-head"] = '"Playfair Display", Georgia, "Times New Roman", serif';
  const editorial = appearance.template === "editorial";
  // Editorial: los títulos van siempre en serif (la elegida, si lo es; si no, Cormorant Garamond).
  const headFont = editorial && !SERIF_FONTS.includes(font.id) ? EDITORIAL_HEAD : font;
  if (editorial) vars["--cp-font-head"] = headFont.family;
  const script = editorial && appearance.script;
  if (script) vars["--cp-font-script"] = SCRIPT_FONT.family;
  if (appearance.background && appearance.template !== "oscura") {
    vars["--cp-bg-custom"] = appearance.background;
    vars["--cp-text-custom"] = BACKGROUND_TEXT;
    vars["--cp-muted-custom"] = mutedOn(appearance.background);
  }
  return {
    template: appearance.template,
    fontHref: googleHref([font.google, editorial ? headFont.google : null, script ? SCRIPT_FONT.google : null]),
    vars,
    attrs: {
      "data-cp-template": appearance.template,
      "data-cp-bg": appearance.background && appearance.template !== "oscura" ? "custom" : "default",
      "data-cp-script": script ? "on" : "off",
    },
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
