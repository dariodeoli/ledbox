"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeBudgetCode } from "@/lib/public-config";

/**
 * Validador online del portal (issue #12): el cliente pega el código del QR o
 * el link completo y el portal lo lleva al presupuesto. La normalización es la
 * misma que usa el API, así que un código válido siempre resuelve.
 */
export function PortalCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeBudgetCode(value);
    if (!code) {
      setError("Revisá el código: son 20 caracteres en grupos de 4, como ABCD-EFGH-JKMN-PQRS-TUVW.");
      return;
    }
    setError("");
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
          aria-describedby={error ? "portal-code-error" : "portal-code-help"}
        />
      </label>
      {error ? (
        <p className="portal-error" id="portal-code-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="portal-help" id="portal-code-help">
          Está impreso debajo del QR del presupuesto. También podés pegar el link completo.
        </p>
      )}
      <button className="portal-btn portal-btn--primary" type="submit">
        Ver presupuesto
      </button>
    </form>
  );
}
