import type { ReactNode } from "react";
import { StructuredData } from "@/components/public/StructuredData";
import { siteGraph } from "@/lib/structured-data";

/**
 * Layout del sitio público (issue #38): emite una sola vez por página el grafo
 * con `Organization` + `LocalBusiness` + `WebSite` (enlazados por `@id`), así
 * todas las URLs comparten la misma identidad y los nodos de producto la
 * referencian desde `seller`/`priceSpecification` sin repetir datos.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <StructuredData graph={siteGraph()} />
      {children}
    </>
  );
}
