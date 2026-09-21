"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeBudgetCode } from "@/lib/public-config";

/** Mensaje único del ejemplo caído (compartido por la portada y el fetch). */
const DEMO_UNAVAILABLE = "El presupuesto de ejemplo no está disponible en este momento. Probá de nuevo en unos minutos.";

/**
 * Validador online del portal (issue #12): el cliente pega el código del QR o
 * el link completo y el portal lo lleva al presupuesto. La normalización es la
 * misma que usa el API, así que un código válido siempre resuelve.
 *
 * Suma la entrada al ejemplo (issue #29): «Ver un ejemplo» y el envío vacío
 * abren el presupuesto demo con datos simulados (`GET /api/portal/demo`, que
 * responde JSON `{ code, path }`); sin código no hay error, se va al ejemplo.
 * `demoUnavailable` avisa cuando el endpoint volvió a la portada sin demo.
 */
export function PortalCodeForm({ demoUnavailable = false }: { demoUnavailable?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [demoError, setDemoError] = useState(demoUnavailable ? DEMO_UNAVAILABLE : "");
  const [demoBusy, setDemoBusy] = useState(false);

  async function openDemo() {
    setDemoBusy(true);
    setError("");
    setDemoError("");
    try {
      const response = await fetch("/api/portal/demo", { headers: { Accept: "application/json" } });
      const payload = (await response.json().catch(() => null)) as { path?: unknown; error?: unknown } | null;
      if (response.ok && typeof payload?.path === "string") {
        router.push(payload.path);
        return;
      }
      setDemoError(typeof payload?.error === "string" ? payload.error : DEMO_UNAVAILABLE);
    } catch {
      setDemoError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setDemoBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeBudgetCode(value);
    if (!code) {
      // Sin código no hay error: el visitante entra al ejemplo (issue #29).
      // Con un código con forma inválida se sigue pidiendo revisarlo.
      if (!value.trim()) void openDemo();
      else setError("Revisá el código: son 20 caracteres en grupos de 4, como ABCD-EFGH-JKMN-PQRS-TUVW.");
      return;
    }
    setError("");
    setDemoError("");
    router.push(`/p/${code}`);
  }

  return (
    <form className="portal-code" onSubmit={submit} noValidate>
      <label className="portal-field" htmlFor="portal-code">
        <span className="portal-field-label">Código del presupuesto</span>
        <input
          id="portal-code"
          name="code"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="ABCD-EFGH-JKMN-PQRS-TUVW"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "portal-code-error" : demoError ? "portal-demo-error" : "portal-code-help"}
        />
      </label>
      {error ? (
        <p className="portal-error" id="portal-code-error" role="alert">
          {error}
        </p>
      ) : demoError ? (
        <p className="portal-error" id="portal-demo-error" role="alert">
          {demoError}
        </p>
      ) : (
        <p className="portal-help" id="portal-code-help">
          Está impreso debajo del QR del presupuesto. También podés pegar el link completo.
        </p>
      )}
      <div className="portal-code-actions">
        <button className="portal-btn portal-btn--primary" type="submit" disabled={demoBusy}>
          Ver presupuesto
        </button>
        <button
          className="portal-btn"
          type="button"
          onClick={() => void openDemo()}
          disabled={demoBusy}
          aria-busy={demoBusy || undefined}
        >
          {demoBusy ? "Preparando el ejemplo…" : "Ver un ejemplo"}
        </button>
      </div>
      <p className="portal-help">
        «Ver un ejemplo» abre un presupuesto demo con datos simulados: podés ajustar cantidades, pedir una rebaja y enviar
        propuestas sin compromiso.
      </p>
    </form>
  );
}
