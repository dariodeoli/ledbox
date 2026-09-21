"use client";

import Link from "next/link";
import { AdminIcon } from "@/components/admin/AdminIcons";

/**
 * Barra de la vista imprimible: volver al módulo, controles extra (mes del
 * reporte, descarga CSV) y el disparador de impresión. Se oculta al imprimir
 * (regla `@media print` del bloque de exportaciones en `app/globals.css`).
 */
export function PrintToolbar({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="lbprint-toolbar">
      <Link className="lbprint-btn" href={backHref} title={backLabel} aria-label={backLabel}>
        <span aria-hidden="true">←</span>
        <span>{backLabel}</span>
      </Link>
      <span className="lbprint-spacer" />
      {children}
      <button
        type="button"
        className="lbprint-btn lbprint-btn--primary"
        onClick={() => window.print()}
        title="Imprimir o guardar como PDF"
        aria-label="Imprimir o guardar como PDF"
      >
        <AdminIcon name="print" size={15} />
        <span>Imprimir / Guardar PDF</span>
      </button>
    </div>
  );
}
