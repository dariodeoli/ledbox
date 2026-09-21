"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminFrame({ children, eyebrow = "LedBox · Panel privado" }: { children: React.ReactNode; eyebrow?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { const stored = window.localStorage.getItem("ledbox-admin-theme"); if (stored === "light") setTheme("light"); }, []);
  function toggleTheme() { const next = theme === "dark" ? "light" : "dark"; setTheme(next); window.localStorage.setItem("ledbox-admin-theme", next); }
  return (
    <main className={`admin-page admin-page--${theme}`}>
      <div className="admin-grid" aria-hidden="true" />
      <div className="admin-brandbar">
        <Link href="/" className="admin-brand" aria-label="Volver al sitio de LedBox">
          <span className="admin-brand-mark">LB</span>
          <span>LEDBOX<span className="admin-brand-dot">.</span></span>
        </Link>
        <div className="admin-brand-tools"><span className="admin-brand-note">Owncoding · private workspace</span><button type="button" className="admin-theme-toggle" onClick={toggleTheme} aria-label={`Activar modo ${theme === "dark" ? "claro" : "oscuro"}`}>{theme === "dark" ? "☼ Claro" : "◐ Oscuro"}</button></div>
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
