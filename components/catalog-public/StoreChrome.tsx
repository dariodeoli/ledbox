import type { CSSProperties, ReactNode } from "react";
import type { AppearanceView } from "@/lib/appearance";
import { editorialTheme } from "@/lib/storefront-editorial";
import { storefrontThemeVars, type StorefrontTheme } from "@/lib/storefront-theme";

/**
 * Contenedor de toda superficie pública de la empresa (tienda, seguimiento, acceso): aplica el
 * color de marca, la plantilla (atributo `data-cp-template`, solo tokens CSS) y la tipografía
 * elegida (hoja de Google Fonts de una lista cerrada). Componente de servidor.
 */
export function StoreChrome({ theme, appearance, children }: { theme: StorefrontTheme; appearance: AppearanceView | null; children: ReactNode }) {
  // Plantilla editorial: sin color de marca rige el verde oliva; con color, manda el de la empresa.
  const effective = appearance?.template === "editorial" ? editorialTheme(theme) : theme;
  const style = { ...storefrontThemeVars(effective), ...(appearance?.vars ?? {}) } as CSSProperties;
  return (
    <div className="cp-theme" style={style} {...(appearance?.attrs ?? {})}>
      {appearance?.fontHref ? (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={appearance.fontHref} />
        </>
      ) : null}
      {children}
    </div>
  );
}
