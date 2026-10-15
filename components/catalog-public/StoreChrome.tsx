import type { CSSProperties, ReactNode } from "react";
import { DEFAULT_APPEARANCE, appearanceView, type AppearanceView } from "@/lib/appearance";
import type { StorefrontTheme } from "@/lib/storefront-theme";

/**
 * Contenedor de toda superficie pública de la empresa (tienda, ficha, seguimiento, acceso): pone los tokens del tema
 * (`--color-*`, `--font-*`, `--radius-*`…) y sus variantes de layout (`data-*`) calculados en `lib/appearance.ts`, enlaza
 * las tipografías (lista cerrada de Google Fonts) y dibuja la barra de anuncio si la empresa la encendió.
 * `theme` ya no se usa (el color de marca entra por `appearance`); se acepta para no romper a quien lo pasa.
 * Componente de servidor.
 */
export function StoreChrome({ appearance, children }: { theme?: StorefrontTheme; appearance: AppearanceView | null; children: ReactNode }) {
  const view = appearance ?? appearanceView(DEFAULT_APPEARANCE);
  return (
    <div className="cp-theme" style={view.vars as CSSProperties} {...view.attrs}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={view.fontHref} />
      {view.announcement ? (
        <div className="cp-announce" role="note" data-testid="store-announcement">
          <p>{view.announcement}</p>
        </div>
      ) : null}
      {children}
    </div>
  );
}
