import Link from "next/link";

export function AdminFrame({ children, eyebrow = "LedBox · Panel privado" }: { children: React.ReactNode; eyebrow?: string }) {
  return (
    <main className="admin-page">
      <div className="admin-grid" aria-hidden="true" />
      <div className="admin-brandbar">
        <Link href="/" className="admin-brand" aria-label="Volver al sitio de LedBox">
          <span className="admin-brand-mark">LB</span>
          <span>LEDBOX<span className="admin-brand-dot">.</span></span>
        </Link>
        <span className="admin-brand-note">Owncoding · private workspace</span>
      </div>
      <div className="admin-content">
        <p className="admin-kicker">{eyebrow}</p>
        {children}
      </div>
    </main>
  );
}

export function AdminError({ message }: { message: string }) {
  return <p className="admin-alert admin-alert--error" role="alert">{message}</p>;
}

export function AdminSuccess({ children }: { children: React.ReactNode }) {
  return <p className="admin-alert admin-alert--success" role="status">{children}</p>;
}

export function AdminSpinner({ label = "Cargando" }: { label?: string }) {
  return <span className="admin-spinner" role="status" aria-label={label} />;
}
