"use client";

import { useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { adminRoleLabel, formatDateTime } from "@/lib/admin-format";
import type { AdminApiToken, AdminRole } from "@/lib/admin-types";
import { useAdminSession } from "./AdminShell";
import { SelectField, TextField } from "./AdminFields";
import { AdminBadge, AdminButton, AdminDialog, AdminEmpty, AdminLoadingRows, AdminNote, AdminPanel } from "./AdminUI";

/**
 * API keys de servicio (issue #69). Objeto único de la sección: crear (nombre +
 * rol), mostrar el **token una sola vez** con botón de copiar, listar (prefijo,
 * último uso y estado) y revocar. Lo monta Mi perfil y solo se dibuja para
 * OWNER; el API revalida esa regla server-side (`api-keys.manage`).
 *
 * El token plano jamás vuelve del servidor después de crearlo: la lista solo
 * trae prefijo, rol, fechas y estado.
 */

const ROLE_OPTIONS: Array<{ value: AdminRole; label: string }> = [
  { value: "ADMIN", label: "ADMIN · todo el panel (excepto claves)" },
  { value: "OPERATIONS", label: "OPERATIONS · clientes, eventos e inventario" },
  { value: "FINANCE", label: "FINANCE · presupuestos, cobros y proveedores" },
];

export function ApiKeysPanel() {
  const { demo } = useAdminSession();
  const keys = useAdminResource<AdminApiToken[]>("/api/admin/api-tokens", (payload) => payload.tokens ?? []);
  const tokens = keys.data ?? [];
  const activeTokens = tokens.filter((token) => !token.revokedAt);

  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("ADMIN");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [freshToken, setFreshToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  const readOnly = demo;

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFreshToken("");
    setCopied(false);
    setCreating(true);
    const result = await adminSend<{ token?: string }>("/api/admin/api-tokens", { name, role });
    setCreating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // El token plano viaja una sola vez: se muestra y no se vuelve a pedir.
    setFreshToken(result.data.token ?? "");
    setName("");
    keys.reload();
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    const result = await adminSend(`/api/admin/api-tokens/${revokeTarget.id}`, { action: "revoke" }, "PATCH");
    setRevoking(false);
    if (!result.ok) {
      setError(result.error);
      setRevokeTarget(null);
      return;
    }
    setRevokeTarget(null);
    keys.reload();
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
    } catch {
      setError("No pudimos copiar; seleccioná el token y copialo a mano.");
    }
  }

  return (
    <AdminPanel
      title="API keys de servicio"
      icon="lock"
      meta="Automatizaciones sin contraseñas · solo OWNER"
    >
      <p className="admin-field-hint">
        Para cargas automatizadas (por ejemplo la CLI de <code>scripts/admin-api.mjs</code>): la clave entra por{" "}
        <code>Authorization: Bearer</code>, queda auditada con su nombre y se puede revocar cuando quieras. El token se
        muestra una sola vez al crearlo.
      </p>

      {readOnly ? (
        <AdminNote>La demo es de solo lectura: acá no se muestran ni crean claves.</AdminNote>
      ) : (
        <>
          <form className="admin-settings" onSubmit={createKey}>
            <TextField
              label="Nombre"
              value={name}
              onChange={setName}
              maxLength={60}
              placeholder="Automatización ventas"
              hint="Queda en la auditoría y en la lista (`API · nombre`)."
              required
            />
            <SelectField label="Rol" value={role} onChange={(value) => setRole(value as AdminRole)} options={ROLE_OPTIONS} />
            <div className="admin-settings-actions">
              <AdminButton type="submit" variant="primary" icon="plus" busy={creating} disabled={!name.trim()}>
                Crear clave
              </AdminButton>
            </div>
          </form>

          {freshToken ? (
            <AdminNote tone="ok">
              <strong>Copiá el token ahora: no se vuelve a mostrar.</strong>
              <span className="admin-api-token">
                <code>{freshToken}</code>
                <AdminButton type="button" icon="copy" onClick={() => void copyToken()} title="Copiar el token">
                  {copied ? "Copiado" : "Copiar"}
                </AdminButton>
              </span>
            </AdminNote>
          ) : null}

          {error ? <AdminNote tone="error">{error}</AdminNote> : null}

          {keys.loading && !keys.data ? (
            <AdminLoadingRows rows={2} label="Cargando claves" />
          ) : activeTokens.length === 0 ? (
            <AdminEmpty
              title="Sin claves activas"
              hint="Creá una para que una automatización cargue clientes y presupuestos sin contraseñas."
            />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Prefijo</th>
                    <th>Rol</th>
                    <th>Creada</th>
                    <th>Último uso</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id} data-revoked={token.revokedAt ? true : undefined}>
                      <td>{token.name}</td>
                      <td>
                        <code>{token.prefix}…</code>
                      </td>
                      <td>{adminRoleLabel(token.role)}</td>
                      <td title={`Creada por ${token.createdByName}`}>{formatDateTime(token.createdAt)}</td>
                      <td>{token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "—"}</td>
                      <td className="admin-actions">
                        {token.revokedAt ? (
                          <AdminBadge tone="neutral">Revocada</AdminBadge>
                        ) : (
                          <AdminButton
                            type="button"
                            variant="ghost"
                            icon="trash"
                            title={`Revocar la clave «${token.name}»`}
                            onClick={() => setRevokeTarget(token)}
                          >
                            Revocar
                          </AdminButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {revokeTarget ? (
        <AdminDialog
          title="Revocar la API key"
          onClose={() => {
            if (!revoking) setRevokeTarget(null);
          }}
        >
          <p>
            La clave «{revokeTarget.name}» ({revokeTarget.prefix}…) deja de funcionar <strong>de inmediato</strong>. Las
            automatizaciones que la usen van a recibir 401 hasta que cargues una clave nueva.
          </p>
          <div className="admin-dialog-actions">
            <AdminButton type="button" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancelar
            </AdminButton>
            <AdminButton type="button" icon="trash" busy={revoking} onClick={() => void confirmRevoke()}>
              Revocar clave
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}
    </AdminPanel>
  );
}
