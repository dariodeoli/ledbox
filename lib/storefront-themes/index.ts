import { BOUTIQUE_THEME } from "./boutique";
import { CORPORATIVO_THEME } from "./corporativo";
import { ESCENARIO_THEME } from "./escenario";
import { FIESTA_THEME } from "./fiesta";
import { GOURMET_THEME } from "./gourmet";
import { INDUSTRIAL_THEME } from "./industrial";
import { KIDS_THEME } from "./kids";
import type { ThemeDef } from "./types";

/**
 * Registro de plantillas de la tienda. **Sumar una plantilla = un archivo de tokens en esta carpeta + una línea acá**
 * (y, si trae una variante de layout nueva, su regla `[data-…]` en `app/tienda.css`). Los componentes no se tocan.
 * El orden de este arreglo es el orden dentro de cada rubro en el selector de Apariencia. Los tests de contraste y de
 * ausencia de hardcodes recorren TODO el registro.
 */
export const THEME_REGISTRY = [BOUTIQUE_THEME, ESCENARIO_THEME, CORPORATIVO_THEME, FIESTA_THEME, GOURMET_THEME, KIDS_THEME, INDUSTRIAL_THEME] as const;

export type StoreThemeId = (typeof THEME_REGISTRY)[number]["id"];
export const STORE_THEMES = THEME_REGISTRY.map((theme) => theme.id) as readonly StoreThemeId[];
export const THEMES = Object.fromEntries(THEME_REGISTRY.map((theme) => [theme.id, theme])) as unknown as Record<StoreThemeId, ThemeDef>;

/** Plantillas agrupadas por rubro (alfabético), para el selector: cada grupo conserva el orden del registro. */
export function themesByRubro(): Array<{ rubro: string; themes: ThemeDef[] }> {
  const groups = new Map<string, ThemeDef[]>();
  for (const theme of THEME_REGISTRY as readonly ThemeDef[]) groups.set(theme.rubro, [...(groups.get(theme.rubro) ?? []), theme]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([rubro, themes]) => ({ rubro, themes }));
}
