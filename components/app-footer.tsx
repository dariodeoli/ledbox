import type { ReactNode } from "react";
import { ProductFooter } from "owncoding-ui";
import { publicConfig } from "@/lib/public-config";
import { eventosSupportUrl } from "@/lib/legal";
import { APP_VERSION_LABEL } from "@/lib/version";

/** Composición institucional compartida, emitida una vez por el layout raíz.
 * ProductFooter aporta copyright, derechos, versión y crédito sin un fork.
 * Los documentos firmados quedan fuera de esta composición.
 */
export function AppFooter({ variant = "app", className, children }: { variant?: "app" | "product" | "company" | "portal"; className?: string; children?: ReactNode }) {
  return <ProductFooter
    className={["app-footer", `app-footer--${variant}`, className].filter(Boolean).join(" ")}
    nombre={variant === "company" ? "LedBox Paraguay · EventOS" : "EventOS"}
    version={APP_VERSION_LABEL}
    anio={new Date().getUTCFullYear()}
    modelo="distribuido"
    credito="Desarrollado en Paraguay por OwnCoding"
    creditoUrl="https://owncoding.dev"
    leading={children ? <div className="app-footer-public-content">{children}</div> : undefined}
    enlaces={variant === "product" ? [
      { href: `${publicConfig.productUrl}/privacidad`, etiqueta: "Privacidad", externo: false },
      { href: `${publicConfig.productUrl}/terminos`, etiqueta: "Términos", externo: false },
      { href: `${publicConfig.productUrl}/status`, etiqueta: "Estado", externo: false },
      { href: eventosSupportUrl(), etiqueta: "Soporte", externo: true },
      { href: publicConfig.siteUrl, etiqueta: "Operado por LedBox Paraguay", externo: true },
    ] : variant === "portal" ? [
      { href: `${publicConfig.siteUrl}/privacidad`, etiqueta: "Privacidad", externo: true },
      { href: publicConfig.siteUrl, etiqueta: "LedBox Paraguay", externo: true },
    ] : variant === "app" ? [
      { href: `${publicConfig.productUrl}/privacidad`, etiqueta: "Privacidad", externo: false },
      { href: `${publicConfig.productUrl}/terminos`, etiqueta: "Términos", externo: false },
      { href: `${publicConfig.productUrl}/status`, etiqueta: "Estado", externo: false },
    ] : []}
  />;
}
