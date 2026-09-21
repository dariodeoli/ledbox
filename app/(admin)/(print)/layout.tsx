import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impresión",
  robots: { index: false, follow: false },
};

/**
 * Layout de los documentos imprimibles del panel (`/imprimir/...`).
 * No monta el shell: es una hoja limpia que se ve como previsualización en
 * pantalla y se imprime sin cromo (los estilos viven en `app/globals.css`,
 * bloque "Exportaciones e impresión").
 */
export default function AdminPrintLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="lbprint">{children}</div>;
}
