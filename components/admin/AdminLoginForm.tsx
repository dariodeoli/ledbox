"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminError, AdminSpinner } from "./AdminUI";
import { EmailField, HoneypotField, PasswordField } from "./AdminFields";
import { AdminFrame } from "./AdminFrame";
import { authErrorMessage } from "@/lib/google-auth";

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Marca oficial de Google (4 colores, SVG inline de 18 px) del botón de SSO.
 * Va dentro del círculo blanco que aporta `.admin-google-button span`, así el
 * icono se ve igual en modo claro y oscuro; el texto y el href no cambian.
 */
function GoogleMark() {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function AdminLoginForm({ googleError = "" }: { googleError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(googleError);
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
      <a className="admin-google-button" href="/api/auth/login/google"><span aria-hidden="true"><GoogleMark /></span> Continuar con Google</a>
      <div className="admin-divider" aria-hidden="true"><span>o ingresá con correo</span></div>
      <form className="admin-form" onSubmit={handleSubmit} noValidate>
        {error && <AdminError message={error} />}
        <EmailField
          label="Email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          required
          placeholder="tu@email.com"
          id="admin-email"
          name="email"
        />
        <PasswordField
          label="Contraseña"
          labelAction={<Link href="/recuperar">¿La olvidaste?</Link>}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          minLength={8}
          id="admin-password"
          name="password"
        />
        <HoneypotField />
        <button className="btn-led admin-submit" type="submit" disabled={pending}>{pending ? <><AdminSpinner label="Iniciando sesión" /> Ingresando…</> : "Ingresar al panel →"}</button>
      </form>
      <p className="admin-footnote">Acceso restringido a usuarios autorizados de LedBox.</p>
    </section>
  </AdminFrame>;
}
