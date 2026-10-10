"use client";
import { AppFooter } from "@/components/app-footer";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="es"><body><main className="app-feedback-page"><h1>No pudimos cargar la aplicación</h1><p>Reintentá en unos instantes.</p><button className="app-feedback-button" onClick={reset}>Reintentar</button><a href="/">Volver al inicio</a></main><AppFooter /></body></html>;
}
