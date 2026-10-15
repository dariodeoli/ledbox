import { fontOf, googleFontHref, readAppearance } from "./appearance";
import { profileHasData, readOrgProfile, type OrgProfile } from "./org-profile";
import { contrastRatio, hexToRgb, readableOn, storefrontTheme } from "./storefront-theme";

/**
 * Lo que el portal del cliente toma de la empresa: su perfil (contacto, horarios, condiciones),
 * el color de marca (en sus dos tonos, claro y oscuro) y la tipografía elegida. La plantilla de
 * la tienda no cambia el layout del portal. Puro: lo arma el servidor y viaja como datos.
 */
export type PortalCompany = {
  name: string;
  profile: OrgProfile | null;
  brand: { light: { accent: string; on: string }; dark: { accent: string; on: string } } | null;
  fontHref: string | null;
  fontFamily: string | null;
};

export function buildPortalCompany(input: {
  name: string;
  profile: unknown;
  appearance: unknown;
  accent: string | null | undefined;
}): PortalCompany {
  const profile = readOrgProfile(input.profile);
  const appearance = readAppearance(input.appearance);
  const theme = storefrontTheme(input.accent);
  const font = fontOf(appearance.font);
  return {
    name: input.name,
    profile: profileHasData(profile) ? profile : null,
    brand: theme.branded ? { light: theme.light, dark: theme.dark } : null,
    fontHref: googleFontHref(appearance.font),
    fontFamily: font.google ? font.family : null,
  };
}

/** Fondos del portal (`--bg` en oscuro y claro) contra los que el botón primario debe separarse. */
export const PORTAL_BG = { dark: "#0a0a13", light: "#f6f8ff" } as const;

/** Verde-azul de acción cuando el color de la empresa no sirve de botón: nunca gris. */
export const PORTAL_ACTION_FALLBACK = {
  dark: { bg: "#38bdf8", on: "#04202c" },
  light: { bg: "#0a6a8a", on: "#ffffff" },
} as const;

/** Saturación HSL (0 a 1): un color casi gris no sirve de acción. */
function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const light = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * light - 1));
}

/**
 * Botón primario sólido del portal, por tema. Sale del color de la empresa si cumple las tres: se
 * ve como color (no gris), el texto del botón da AA (4,5:1) y el botón se separa del fondo (3:1).
 * Si no, un azul de acción. Nunca se aclara el color de la empresa hacia el gris: ese es el
 * error que dejaba los botones apagados.
 */
export function portalActionColor(brandHex: string | null | undefined, theme: "dark" | "light"): { bg: string; on: string } {
  if (brandHex && /^#[0-9a-f]{6}$/i.test(brandHex)) {
    const on = readableOn(brandHex);
    if (saturation(brandHex) >= 0.25 && contrastRatio(on, brandHex) >= 4.5 && contrastRatio(brandHex, PORTAL_BG[theme]) >= 3) {
      return { bg: brandHex, on };
    }
  }
  return { ...PORTAL_ACTION_FALLBACK[theme] };
}

/** Variables CSS del acento de la empresa en el portal (la hoja elige el tono según el tema). */
export function portalBrandVars(company: PortalCompany | null): Record<string, string> {
  if (!company) return {};
  const vars: Record<string, string> = {};
  if (company.brand) {
    vars["--pb-l"] = company.brand.light.accent;
    vars["--pb-l-on"] = company.brand.light.on;
    vars["--pb-d"] = company.brand.dark.accent;
    vars["--pb-d-on"] = company.brand.dark.on;
    // El acento sólido de los botones sale del color original (el modo claro lo guarda sin tocar).
    const raw = company.brand.light.accent;
    const dark = portalActionColor(raw, "dark");
    const light = portalActionColor(raw, "light");
    vars["--pb-a-d"] = dark.bg;
    vars["--pb-a-d-on"] = dark.on;
    vars["--pb-a-l"] = light.bg;
    vars["--pb-a-l-on"] = light.on;
  }
  if (company.fontFamily) vars["--pb-font"] = company.fontFamily;
  return vars;
}
