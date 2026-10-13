import type { ReactNode } from "react";

/**
 * Superficies públicas por empresa (catálogo y seguimiento de pedido). No usan la
 * identidad ni el JSON-LD de LedBox: cada página muestra el nombre de la empresa
 * dueña del catálogo. Tema claro/oscuro según el sistema (sin script de arranque).
 */
export default function CatalogLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="cp-root">{children}</div>;
}
