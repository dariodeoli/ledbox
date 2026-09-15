import Link from "next/link";
export default function NotFound() {
  return <main className="not-found-page"><div className="not-found-card"><span className="admin-card-index">LedBox · 404</span><p className="not-found-code">404</p><h1>Página no encontrada</h1><p>El enlace que buscás no existe o fue movido.</p><Link className="btn-led" href="/">Volver al inicio →</Link></div></main>;
}
