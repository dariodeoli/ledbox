"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="app-feedback-page"><h1>No pudimos cargar esta página</h1><p>Podés reintentar o volver al inicio.</p><button className="app-feedback-button" onClick={reset}>Reintentar</button><a href="/">Volver al inicio</a></main>;
}
