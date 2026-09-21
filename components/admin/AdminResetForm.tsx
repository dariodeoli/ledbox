"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminError, AdminFrame, AdminSpinner, AdminSuccess } from "./AdminFrame";

export function AdminResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, website: "", honeypot: "" }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(body.error || "El enlace no es válido o ya venció.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("No pudimos conectar con el panel. Intentá nuevamente.");
    } finally {
      setPending(false);
    }
  }

  return <AdminFrame eyebrow="LedBox · Nueva contraseña">
    <section className="admin-card admin-card--narrow" aria-labelledby="reset-title">
      <span className="admin-card-index">03 / contraseña</span>
      <h1 id="reset-title" className="admin-title">Elegí una<br /><span>nueva clave.</span></h1>
      {!token ? <AdminError message="Este enlace de recuperación no es válido." /> : success ? <div className="admin-success-block"><AdminSuccess>Contraseña actualizada correctamente.</AdminSuccess><p>Ya podés volver al panel e iniciar sesión con tu nueva contraseña.</p><Link href="/login" className="btn-led admin-inline-link">Ir a iniciar sesión →</Link></div> : <>
        <p className="admin-lede">Usá al menos 8 caracteres. El enlace vence en 30 minutos y solo puede usarse una vez.</p>
        <form className="admin-form" onSubmit={handleSubmit} noValidate>
          {error && <AdminError message={error} />}
          <div className="admin-field"><label htmlFor="new-password">Nueva contraseña</label><input id="new-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} /></div>
          <div className="admin-field"><label htmlFor="confirm-password">Repetir contraseña</label><input id="confirm-password" name="confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} /></div>
          <input className="admin-honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button className="btn-led admin-submit" type="submit" disabled={pending}>{pending ? <><AdminSpinner label="Actualizando contraseña" /> Actualizando…</> : "Actualizar contraseña →"}</button>
        </form>
      </>}
    </section>
  </AdminFrame>;
}
