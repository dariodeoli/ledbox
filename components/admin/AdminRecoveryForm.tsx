"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AdminError, AdminSpinner, AdminSuccess } from "./AdminUI";
import { EmailField, HoneypotField } from "./AdminFields";
import { AdminFrame } from "./AdminFrame";

export function AdminRecoveryForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website: "", honeypot: "" }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) {
        setError(body.error || "No pudimos procesar la solicitud.");
        return;
      }
      setMessage(body.message || "Si la cuenta existe, enviamos las instrucciones de recuperación.");
    } catch {
      setError("No pudimos conectar con el panel. Intentá nuevamente.");
    } finally {
      setPending(false);
    }
  }

  return <AdminFrame eyebrow="LedBox · Recuperación segura">
    <section className="admin-card admin-card--narrow" aria-labelledby="recovery-title">
      <span className="admin-card-index">02 / recuperación</span>
      <h1 id="recovery-title" className="admin-title">Recuperar<br /><span>acceso.</span></h1>
      <p className="admin-lede">Te enviaremos un enlace de un solo uso al email asociado a tu cuenta.</p>
      <form className="admin-form" onSubmit={handleSubmit} noValidate>
        {error && <AdminError message={error} />}
        {message && <AdminSuccess>{message}</AdminSuccess>}
        <EmailField
          label="Email de acceso"
          value={email}
          onChange={setEmail}
          required
          placeholder="tu@email.com"
          id="recovery-email"
          name="email"
        />
        <HoneypotField />
        <button className="btn-led admin-submit" type="submit" disabled={pending}>{pending ? <><AdminSpinner label="Enviando recuperación" /> Enviando…</> : "Enviar enlace →"}</button>
      </form>
      <Link href="/login" className="admin-back-link">← Volver al inicio de sesión</Link>
    </section>
  </AdminFrame>;
}
