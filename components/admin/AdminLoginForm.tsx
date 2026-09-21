"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminError, AdminFrame, AdminSpinner } from "./AdminFrame";

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, website: "", honeypot: "" }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, "No pudimos iniciar sesión. Revisá tus datos."));
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("No pudimos conectar con el panel. Intentá nuevamente.");
    } finally {
      setPending(false);
    }
  }

  return <AdminFrame>
    <section className="admin-card admin-card--narrow" aria-labelledby="login-title">
      <span className="admin-card-index">01 / acceso</span>
      <h1 id="login-title" className="admin-title">Entrar<br /><span>al panel.</span></h1>
      <p className="admin-lede">Gestioná consultas, leads y cotizaciones de LedBox desde un espacio privado.</p>
      <a className="admin-google-button" href="/api/auth/login/google"><span aria-hidden="true">G</span> Continuar con Google</a>
      <div className="admin-divider" aria-hidden="true"><span>o ingresá con correo</span></div>
      <form className="admin-form" onSubmit={handleSubmit} noValidate>
        {error && <AdminError message={error} />}
        <div className="admin-field">
          <label htmlFor="admin-email">Email</label>
          <input id="admin-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required maxLength={320} placeholder="tu@email.com" />
        </div>
        <div className="admin-field">
          <div className="admin-field-heading"><label htmlFor="admin-password">Contraseña</label><Link href="/recuperar">¿La olvidaste?</Link></div>
          <input id="admin-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} />
        </div>
        <input className="admin-honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <button className="btn-led admin-submit" type="submit" disabled={pending}>{pending ? <><AdminSpinner label="Iniciando sesión" /> Ingresando…</> : "Ingresar al panel →"}</button>
      </form>
      <p className="admin-footnote">Acceso restringido a usuarios autorizados de LedBox.</p>
    </section>
  </AdminFrame>;
}
