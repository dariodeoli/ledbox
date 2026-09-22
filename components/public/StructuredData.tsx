import type { JsonLdGraph } from "@/lib/structured-data";

/**
 * Objeto único para emitir JSON-LD en el sitio público: se usa desde el layout
 * (grafo del sitio) y desde cada página (producto, migas, FAQ, catálogo). El
 * `<` se escapa para que el JSON nunca cierre el `<script>`.
 */
export function StructuredData({ graph }: { graph: JsonLdGraph }) {
  const json = JSON.stringify(graph).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
