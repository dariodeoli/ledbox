import type { ReactNode } from "react";
import "../tienda.css";

/**
 * Superficies públicas por empresa (catálogo y seguimiento de pedido). No usan la
 * identidad ni el JSON-LD de LedBox: cada página muestra el nombre de la empresa
 * dueña del catálogo. Los colores, tipografías y espacios son los tokens del tema
 * de la empresa (`StoreChrome`); los estilos viven en `app/tienda.css`.
 */
export default function CatalogLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="cp-root">{children}</div>;
}
