import Link from "next/link";
import { totalPages, withParams, type RawParams } from "@/lib/platform/tablas";

/** Paginación como enlaces (conserva q, filtros, orden y período). */
export function TablePager({
  basePath,
  params,
  page,
  total,
  pageSize,
}: Readonly<{ basePath: string; params: RawParams; page: number; total: number; pageSize: number }>) {
  const pages = totalPages(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nf = new Intl.NumberFormat("es-PY");
  return (
    <div className="platform-pager" role="navigation" aria-label="Paginación">
      <p>{total === 0 ? "Sin resultados" : `${nf.format(from)}–${nf.format(to)} de ${nf.format(total)}`}</p>
      <div className="platform-pager-links">
        {page > 1 ? <Link className="platform-chip" href={withParams(basePath, params, { pag: page - 1 > 1 ? String(page - 1) : undefined })} rel="prev">Anterior</Link> : <span className="platform-chip platform-chip--off" aria-disabled="true">Anterior</span>}
        <span className="platform-pager-page">Página {nf.format(page)} de {nf.format(pages)}</span>
        {page < pages ? <Link className="platform-chip" href={withParams(basePath, params, { pag: String(page + 1) })} rel="next">Siguiente</Link> : <span className="platform-chip platform-chip--off" aria-disabled="true">Siguiente</span>}
      </div>
    </div>
  );
}
