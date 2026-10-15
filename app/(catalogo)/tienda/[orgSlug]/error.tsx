"use client";

import { useEffect } from "react";
import { StoreChrome } from "@/components/catalog-public/StoreChrome";
import { ErrorState } from "@/components/catalog-public/StoreStates";

/** Falla al armar la tienda: estado de error con reintento (el detalle queda en el registro del servidor, no en pantalla). */
export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("tienda: error al mostrar la tienda", error);
  }, [error]);
  return (
    <StoreChrome appearance={null}>
      <main className="cp-page">
        <div className="cp-container cp-sections">
          <ErrorState text="Tuvimos un problema al abrir la tienda. Probá de nuevo en unos segundos." onRetry={reset} />
        </div>
      </main>
    </StoreChrome>
  );
}
