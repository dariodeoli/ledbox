import type { ReactNode } from "react";
import { StructuredData } from "@/components/public/StructuredData";
import { SITE_BOOT_SCRIPT, SITE_ROOT_ID } from "@/lib/site-theme";
import { siteGraph } from "@/lib/structured-data";
import { PublicCartProvider } from "@/components/cart/PublicCartProvider";

/**
 * Layout del sitio público (issue #38): emite una sola vez por página el grafo
 * con `Organization` + `LocalBusiness` + `WebSite` (enlazados por `@id`), así
 * todas las URLs comparten la misma identidad y los nodos de producto la
 * referencian desde `seller`/`priceSpecification` sin repetir datos.
 *
 * Desde la piel fase 3 (issue #83) el sitio vive dentro de `.site`, el
 * contenedor de la piel (tokens C · Vitrina / C1 · Aurora viva) que fija el
 * tema antes del primer pintado con `SITE_BOOT_SCRIPT`.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site" id={SITE_ROOT_ID} data-theme="dark" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: SITE_BOOT_SCRIPT }} />
      <StructuredData graph={siteGraph()} />
      <PublicCartProvider>{children}</PublicCartProvider>
    </div>
  );
}
