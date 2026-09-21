"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { adminRoleLabel, formatDate } from "@/lib/admin-format";
import type { AdminInvitationPublicView } from "@/lib/admin-types";
import { AdminCountdown, AdminError, AdminNote, AdminSpinner, AdminSuccess } from "./AdminUI";
import { HoneypotField, PasswordField, TextField } from "./AdminFields";
import { AdminFrame } from "./AdminFrame";

/**
 * Aceptación pública de una invitación al equipo (issue #31): la persona
 * completa su nombre y contraseña (cuenta nueva) o confirma su contraseña
 * (cuenta existente), o entra con Google.
 *
 * - Con Google la identidad la verifica Google y el correo tiene que ser el
 *   invitado; la página ofrece el botón siempre que la invitación siga vigente.
 * - Una cuenta que ya es miembro de la empresa avisa y manda al login: no se
 *   duplica la membresía.
 * - Al aceptar, el API abre la sesión y la persona entra al panel.
 */

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/** Ficha de la invitación: empresa, rol, quién invita y vencimiento. */
function InvitationFacts({ view }: { view: AdminInvitationPublicView }) {
  return (
    <dl className="admin-facts">
      <div>
        <dt>Empresa</dt>
        <dd>{view.organization}</dd>
      </div>
      <div>
        <dt>Rol</dt>
        <dd>{adminRoleLabel(view.role)}</dd>
      </div>
      <div>
        <dt>Invita</dt>
        <dd>{view.invitedByName}</dd>
      </div>
      <div>
        <dt>Correo</dt>
        <dd>{view.email}</dd>
      </div>
      <div>
        <dt>Vence</dt>
        <dd>
          {formatDate(view.expiresAt)}
          <AdminCountdown value={view.expiresAt} className="admin-countdown--inline" />
        </dd>
      </div>
    </dl>
  );
}

export function AdminInvitationForm({
  token,
  view,
  errorParam = "",
}: {
  token: string;
  view: AdminInvitationPublicView;
  /** Error devuelto por el flujo de Google (`?error=`). */
  errorParam?: string;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(errorParam);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const newAccount = !view.account.exists;
  const googleUrl = `/api/auth/login/google?invitation=${encodeURIComponent(token)}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newAccount && password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/accept-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password, website: "", honeypot: "" }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, "No pudimos aceptar la invitación. Intentá nuevamente."));
        return;
      }
      setDone(true);
      // El API ya abrió la sesión: se entra al panel con el rol invitado.
      window.setTimeout(() => window.location.assign("/dashboard"), 1200);
    } catch {
      setError("No pudimos conectar con el panel. Intentá nuevamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminFrame eyebrow="LedBox · Invitación al equipo">
      <section className="admin-card admin-card--narrow" aria-labelledby="invitation-title">
        <span className="admin-card-index">04 / invitación</span>
        <h1 id="invitation-title" className="admin-title">
          Sumate al<br />
          <span>{view.organization}.</span>
        </h1>

        {done ? (
          <div className="admin-success-block">
            <AdminSuccess>Listo: ya sos parte del equipo de {view.organization}.</AdminSuccess>
            <p>Entrando al panel con el rol {adminRoleLabel(view.role)}…</p>
            <Link href="/dashboard" className="btn-led admin-inline-link">
              Ir al panel →
            </Link>
          </div>
        ) : !view.canAccept ? (
          <>
            <InvitationFacts view={view} />
            <div className="admin-invitation-blocked">
              {view.account.alreadyMember ? (
                <AdminNote tone="error">Ya sos miembro del equipo de {view.organization}. Entrá al panel con tu cuenta.</AdminNote>
              ) : view.status === "expired" ? (
                <AdminNote tone="error">Esta invitación venció. Pedile al equipo que te la reenvíen.</AdminNote>
              ) : view.status === "revoked" ? (
                <AdminNote tone="error">Esta invitación fue revocada por el equipo. Pedí una nueva.</AdminNote>
              ) : view.status === "accepted" ? (
                <AdminNote tone="error">Esta invitación ya fue aceptada. Entrá al panel con tu cuenta.</AdminNote>
              ) : (
                <AdminNote tone="error">Tu cuenta está desactivada. Pedile al equipo que la reactive para sumarte.</AdminNote>
              )}
            </div>
            <Link href="/login" className="btn-led admin-inline-link">
              Ir a iniciar sesión →
            </Link>
          </>
        ) : (
          <>
            <p className="admin-lede">
              {view.invitedByName} te invitó a sumarte al equipo de {view.organization} en el panel de LedBox. El link es
              personal: elegí cómo entrar y quedás dentro.
            </p>
            <InvitationFacts view={view} />

            <a className="admin-google-button admin-invitation-google" href={googleUrl}>
              <span aria-hidden="true">G</span> Continuar con Google
            </a>

            <div className="admin-divider" aria-hidden="true">
              <span>{newAccount ? "o creá tu acceso" : "o entrá con tu contraseña"}</span>
            </div>
            <form className="admin-form" onSubmit={handleSubmit} noValidate>
              {error ? <AdminError message={error} /> : null}
              {newAccount ? (
                <TextField
                  label="Tu nombre"
                  required
                  maxLength={120}
                  value={name}
                  onChange={setName}
                  autoComplete="name"
                  placeholder="Ej.: Ana Martínez"
                  id="invitation-name"
                  name="name"
                />
              ) : null}
              <PasswordField
                label={newAccount ? "Contraseña" : "Tu contraseña de LedBox"}
                hint={newAccount ? "Mínimo 8 caracteres" : "La misma con la que entrás al panel"}
                required
                minLength={8}
                value={password}
                onChange={setPassword}
                autoComplete={newAccount ? "new-password" : "current-password"}
                id="invitation-password"
                name="password"
              />
              {newAccount ? (
                <PasswordField
                  label="Repetir contraseña"
                  required
                  minLength={8}
                  value={confirmation}
                  onChange={setConfirmation}
                  autoComplete="new-password"
                  id="invitation-password-confirm"
                  name="confirmation"
                />
              ) : null}
              <HoneypotField />
              <button className="btn-led admin-submit" type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <AdminSpinner label="Aceptando la invitación" /> Aceptando…
                  </>
                ) : (
                  "Aceptar la invitación →"
                )}
              </button>
            </form>
          </>
        )}
      </section>
    </AdminFrame>
  );
}

/** Invitación inexistente o link mal copiado: mensaje claro, sin formulario. */
export function AdminInvitationMissing() {
  return (
    <AdminFrame eyebrow="LedBox · Invitación al equipo">
      <section className="admin-card admin-card--narrow" aria-labelledby="invitation-missing-title">
        <span className="admin-card-index">04 / invitación</span>
        <h1 id="invitation-missing-title" className="admin-title">
          Invitación<br />
          <span>no válida.</span>
        </h1>
        <p className="admin-lede">
          No encontramos esta invitación: el link puede estar incompleto o corresponder a una invitación revocada o
          eliminada. Pedile al equipo de LedBox que te la reenvíen.
        </p>
        <Link href="/login" className="btn-led admin-inline-link">
          Ir a iniciar sesión →
        </Link>
      </section>
    </AdminFrame>
  );
}
