import { fontOf, googleFontHref, readAppearance } from "./appearance";
import { profileHasData, readOrgProfile, type OrgProfile } from "./org-profile";
import { storefrontTheme } from "./storefront-theme";

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

/** Variables CSS del acento de la empresa en el portal (la hoja elige el tono según el tema). */
export function portalBrandVars(company: PortalCompany | null): Record<string, string> {
  if (!company) return {};
  const vars: Record<string, string> = {};
  if (company.brand) {
    vars["--pb-l"] = company.brand.light.accent;
    vars["--pb-l-on"] = company.brand.light.on;
    vars["--pb-d"] = company.brand.dark.accent;
    vars["--pb-d-on"] = company.brand.dark.on;
  }
  if (company.fontFamily) vars["--pb-font"] = company.fontFamily;
  return vars;
}
