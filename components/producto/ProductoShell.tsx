import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { publicConfig } from "@/lib/public-config";
import { PRODUCT_BOOT_SCRIPT, PRODUCT_ROOT_ID } from "@/lib/site-theme";

/**
 * Piel de EventOS para las páginas internas del producto (issue #168: legales,
 * estado y 404): la misma raíz, tipografía, matriz LED y arranque de tema que
 * la landing, con la barra de marca y el pie del producto. El contenido entra
 * como children dentro del `main` (que ya lleva el ancho y el ritmo de la piel).
 */
export function ProductoShell({ children }: { children: ReactNode }) {
  return (
    <div className="producto" id={PRODUCT_ROOT_ID} data-theme="dark" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: PRODUCT_BOOT_SCRIPT }} />
      <div className="led-grid-bg" aria-hidden="true" />

      <header className="producto-top">
        <Link className="producto-brand" href="/" aria-label="EventOS, volver al inicio">
          <BrandMark className="producto-brand-mark" size={26} />
          EventOS<span className="producto-brand-dot">.</span>
        </Link>
        <nav className="producto-nav" aria-label="Secciones">
          <Link href="/#modulos">Módulos</Link>
          <Link href="/#como-funciona">Cómo funciona</Link>
          <Link href="/#preguntas">Preguntas</Link>
        </nav>
        <div className="producto-actions">
          <a className="producto-button producto-button--ghost" href={publicConfig.demoUrl} target="_blank" rel="noreferrer">
            Ver la demo
          </a>
          <a className="producto-button" href={`${publicConfig.adminUrl}/login`}>
            Ingresar
          </a>
        </div>
      </header>

      <main>{children}</main>

    </div>
  );
}
