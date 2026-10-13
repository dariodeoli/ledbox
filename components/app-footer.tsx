import type { ReactNode } from "react";
import { ProductFooter } from "owncoding-ui";
import { publicConfig } from "@/lib/public-config";
import { EVENTOS_LEGAL, eventosSupportUrl } from "@/lib/legal";
import { APP_VERSION_LABEL } from "@/lib/version";

/** Composición institucional compartida, emitida una vez por el layout raíz.
 * ProductFooter aporta copyright, derechos, versión y crédito sin un fork.
 * Los documentos firmados quedan fuera de esta composición.
 *
 * El pie del panel (`variant="app"`) usa `modelo="panel"` de owncoding-ui v0.68:
 * una sola fila de 49 px a 1280 y 69 px a 375, en vez de los ~100 px del
 * distribuido. Portal, producto y empresa conservan `distribuido`.
 */
export function AppFooter({ variant = "app", className, children }: { variant?: "app" | "product" | "company" | "portal"; className?: string; children?: ReactNode }) {
  return <ProductFooter
    className={["app-footer", `app-footer--${variant}`, className].filter(Boolean).join(" ")}
    nombre={EVENTOS_LEGAL.product}
    version={APP_VERSION_LABEL}
    anio={new Date().getUTCFullYear()}
    modelo={variant === "app" ? "panel" : "distribuido"}
    credito="Desarrollado en Paraguay por OwnCoding"
    creditoUrl="https://owncoding.dev"
    leading={children ? <div className="app-footer-public-content">{children}</div> : undefined}
    enlaces={[
      { href: `${publicConfig.productUrl}/privacidad`, etiqueta: "Privacidad", externo: false },
      { href: `${publicConfig.productUrl}/terminos`, etiqueta: "Términos", externo: false },
      { href: `${publicConfig.productUrl}/status`, etiqueta: "Estado", externo: false },
      { href: eventosSupportUrl(), etiqueta: "Soporte", externo: true },
      { href: publicConfig.siteUrl, etiqueta: `Operado por ${EVENTOS_LEGAL.operator}`, externo: true },
      ...(variant === "company" || variant === "portal" ? [
        { href: `${publicConfig.siteUrl}/privacidad`, etiqueta: "Privacidad de LedBox", externo: false },
      ] : []),
    ]}
  />;
}
