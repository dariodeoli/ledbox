"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { adminRoleLabel, statusTone } from "@/lib/admin-format";
import { canManageOrganization } from "@/lib/admin-policy";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { adminAvatarUrl } from "@/lib/admin-types";
import { normalizePersonName, personNameValid } from "@/lib/field-rules";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { PasswordField, SelectField, TextField } from "../AdminFields";
import { AdminButton, AdminBadge, AdminConfirmDialog, AdminDataState, AdminImageUpload, AdminNote, AdminPanel } from "../AdminUI";
import { AdminIcon } from "../AdminIcons";
import { AdminPinSettings } from "../AdminPinSettings";
import { ApiKeysPanel } from "../ApiKeysPanel";

/**
 * Mi perfil (issue #22): cualquier rol edita su **nombre**, su **contraseña**
 * (pidiendo la actual, mínimo 8) y su **foto**. El correo no se edita acá: es la
 * identidad de acceso y lo cambia un OWNER/ADMIN desde Equipo.
 *
 * El avatar es el objeto único del panel (foto subida → iniciales), con
 * validación por magic bytes y recorte/compresión en el navegador. La seguridad
 * del panel (PIN y auto-bloqueo, issue #21) vive en `AdminPinSettings`, el mismo
 * bloque que monta la página de Configuración. En la demo pública todo queda en
 * solo lectura (el API responde 403 «Modo demo»).
 */
export function PerfilModule() {
  const { user, demo, reload, lockEligible, lockPanel, logout, loggingOut } = useAdminSession();
  const profile = useAdminResource("/api/admin/profile", (payload) => payload.profile ?? null);
  const data = profile.data ?? null;
  const readOnly = demo;

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [notice, setNotice] = useState("");

  const [avatarVersion, setAvatarVersion] = useState<string | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  /** Confirmación propia para quitar la foto (nunca confirm() nativo). */
  const [confirmAvatar, setConfirmAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (data) setName(data.name);
  }, [data]);

  const avatarUpdatedAt = avatarVersion ?? data?.avatarUpdatedAt ?? null;
  const avatarSrc = useMemo(() => {
    if (pendingAvatar) return pendingAvatar;
    if (!user) return null;
    return avatarUpdatedAt ? adminAvatarUrl(user.id, avatarUpdatedAt) : null;
  }, [pendingAvatar, user, avatarUpdatedAt]);

  const nameChanged = Boolean(data) && normalizePersonName(name) !== data?.name;
  const hasPassword = Boolean(data?.hasPassword);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setSavingName(true);
    setNotice("");
    const result = await adminSend("/api/admin/profile", { name: normalizePersonName(name) }, "PATCH");
    setSavingName(false);
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    setNameError("");
    setNotice("Guardamos tu nombre: ya se ve en el chip del panel.");
    profile.reload();
    reload();
  }

  const organizations: Array<{ id: string; name: string }> = data?.organizations ?? [];
  const [defaultOrg, setDefaultOrg] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState("");
  useEffect(() => {
    if (data) setDefaultOrg(data.defaultOrganizationId ?? "");
  }, [data]);

  async function saveDefaultOrganization(value: string) {
    const previous = defaultOrg;
    setDefaultOrg(value);
    setSavingDefault(true);
    setDefaultError("");
    setNotice("");
    const result = await adminSend("/api/admin/profile/default-organization", { organizationId: value || null }, "PATCH");
    setSavingDefault(false);
    if (!result.ok) {
      setDefaultOrg(previous);
      setDefaultError(result.error);
      return;
    }
    setNotice(value ? "Listo: al iniciar sesión se abre esa empresa." : "Quitamos tu empresa predeterminada: se abre la primera.");
    profile.reload();
  }

  async function uploadAvatar(image: PreparedIdentityImage) {
    setAvatarBusy(true);
    setAvatarError("");
    setNotice("");
    const result = await adminSend<{ avatarUpdatedAt?: string }>("/api/admin/profile/avatar", {
      data: image.base64,
      mime: image.mime,
      width: image.width,
      height: image.height,
    });
    setAvatarBusy(false);
    if (!result.ok) {
      setPendingAvatar(null);
      setAvatarError(result.error);
      return;
    }
    setPendingAvatar(image.dataUrl);
    setAvatarVersion(result.data.avatarUpdatedAt ?? null);
    setNotice("Foto de perfil actualizada.");
    profile.reload();
    reload();
  }

  async function removeAvatar() {
    setConfirmAvatar(false);
    setAvatarBusy(true);
    setAvatarError("");
    setNotice("");
    const result = await adminSend("/api/admin/profile/avatar", undefined, "DELETE");
    setAvatarBusy(false);
    if (!result.ok) {
      setAvatarError(result.error);
      return;
    }
    setPendingAvatar(null);
    setAvatarVersion(null);
    setNotice("Quitamos tu foto: el avatar vuelve a tus iniciales.");
    profile.reload();
    reload();
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setNotice("");
    if (newPassword.length < 8) {
      setPasswordError("La contraseña nueva debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    setSavingPassword(true);
    const result = await adminSend<{ otherSessionsClosed?: number }>("/api/admin/profile/password", {
      currentPassword,
      newPassword,
    });
    setSavingPassword(false);
    if (!result.ok) {
      setPasswordError(result.error);
      return;
    }
    const closed = result.data.otherSessionsClosed ?? 0;
    setCurrentPassword("");
    setNewPassword("");
    setRepeatPassword("");
    setNotice(
      closed > 0
        ? `Contraseña actualizada. Se cerraron ${closed} ${closed === 1 ? "sesión abierta" : "sesiones abiertas"} en otros dispositivos.`
        : "Contraseña actualizada.",
    );
  }

  // Identidad arriba (issue #117): nombre, correo y rol, como los mostraba el menú.
  const identity = {
    name: data?.name ?? user?.name ?? "",
    email: data?.email ?? user?.email ?? "",
    role: data?.role ?? user?.role ?? null,
  };

  return (
    <div className="admin-module-page">
      <section className="admin-account-head" aria-label="Tu identidad en el panel">
        <AdminAvatar name={identity.name} src={avatarSrc} size={40} />
        <span className="admin-account-head-copy">
          <strong>{identity.name}</strong>
          <small>{identity.email}</small>
        </span>
        {identity.role ? <AdminBadge tone={statusTone(identity.role)}>{adminRoleLabel(identity.role)}</AdminBadge> : null}
      </section>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      <AdminDataState loading={profile.loading} error={profile.error} onRetry={profile.reload} rows={4}>
        <AdminPanel title="Datos personales" icon="user" meta={data ? `Rol: ${adminRoleLabel(data.role)}` : undefined}>
          <div className="admin-profile-grid">
            <AdminImageUpload
              label="Foto de perfil"
              mode="avatar"
              hint="JPG, PNG o WebP hasta 1 MB. Se recorta cuadrada y se comprime en tu navegador; solo se ve con sesión del panel."
              preview={<AdminAvatar name={data?.name ?? user?.name} src={avatarSrc} size={64} />}
              busy={avatarBusy}
              disabled={readOnly || !data}
              error={avatarError}
              onPrepared={(image) => void uploadAvatar(image)}
              onRemove={avatarUpdatedAt ? () => setConfirmAvatar(true) : undefined}
              removeLabel="Quitar foto"
            />

            <form className="admin-settings-form" onSubmit={saveName}>
              <TextField
                label="Nombre"
                required
                maxLength={120}
                autoComplete="name"
                value={name}
                onChange={(value) => {
                  setName(value);
                  setNameError("");
                  setNotice("");
                }}
                error={nameError}
                disabled={readOnly || !data}
                hint="Así te ve el equipo en el panel y en la auditoría."
              />
              <TextField
                label="Correo"
                value={data?.email ?? ""}
                onChange={() => {}}
                readOnly
                hint="El correo es tu identidad de acceso: lo cambia un OWNER/ADMIN del equipo."
              />
              <div className="admin-settings-actions">
                <AdminButton
                  type="submit"
                  variant="primary"
                  icon="check"
                  busy={savingName}
                  disabled={readOnly || !data || !nameChanged || !personNameValid(name)}
                >
                  Guardar nombre
                </AdminButton>
              </div>
            </form>
          </div>
        </AdminPanel>

        <AdminPanel title="Contraseña" icon="lock" meta="Mínimo 8 caracteres">
          <form className="admin-settings" onSubmit={savePassword}>
            {data && !hasPassword ? (
              <AdminNote>
                Tu cuenta ingresa con Google y todavía no tiene contraseña propia. Podés crear una desde «¿La olvidaste?» en el
                login: te llega un correo para definirla.
              </AdminNote>
            ) : null}
            <div className="admin-settings-grid">
              <PasswordField
                label="Contraseña actual"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(value) => {
                  setCurrentPassword(value);
                  setPasswordError("");
                }}
                disabled={readOnly || !data || !hasPassword}
              />
              <PasswordField
                label="Contraseña nueva"
                required
                minLength={8}
                hint="Al menos 8 caracteres. Al guardarla se cierran las demás sesiones abiertas."
                value={newPassword}
                onChange={(value) => {
                  setNewPassword(value);
                  setPasswordError("");
                }}
                disabled={readOnly || !data || !hasPassword}
              />
              <PasswordField
                label="Repetir contraseña nueva"
                required
                minLength={8}
                value={repeatPassword}
                onChange={(value) => {
                  setRepeatPassword(value);
                  setPasswordError("");
                }}
                disabled={readOnly || !data || !hasPassword}
              />
            </div>
            {passwordError ? (
              <span className="admin-field-error" role="alert">
                {passwordError}
              </span>
            ) : null}
            <div className="admin-settings-actions">
              <AdminButton
                type="submit"
                variant="primary"
                icon="check"
                busy={savingPassword}
                disabled={readOnly || !data || !hasPassword || !currentPassword || !newPassword}
              >
                Cambiar contraseña
              </AdminButton>
            </div>
          </form>
        </AdminPanel>
      </AdminDataState>

      {/* Empresa predeterminada: la que se abre al iniciar sesión. Cambiar de empresa en el panel no la modifica. */}
      {organizations.length > 0 ? (
        <AdminPanel title="Empresa predeterminada" icon="building">
          <SelectField
            label="Empresa predeterminada"
            value={defaultOrg}
            disabled={readOnly || savingDefault}
            error={defaultError}
            hint="Es la empresa que se abre al iniciar sesión. Cambiar de empresa dentro del panel no modifica esta elección."
            options={[{ value: "", label: "La primera de mis empresas" }, ...organizations.map((org) => ({ value: org.id, label: org.name }))]}
            onChange={(value) => void saveDefaultOrganization(value)}
          />
        </AdminPanel>
      ) : null}

      {/* Seguridad del panel (issue #21): PIN y auto-bloqueo por inactividad. */}
      <AdminPinSettings />

      {/* API keys de servicio (issue #69): solo OWNER. */}
      {user?.role === "OWNER" ? <ApiKeysPanel /> : null}

      {/* Cuenta (issue #117): cerrar sesión arriba de Empresa; el bloqueo por
          PIN se conserva cuando el usuario lo tiene habilitado. */}
      <AdminPanel title="Cuenta" icon="logout">
        <div className="admin-account-actions">
          {lockEligible ? (
            <button type="button" className="admin-account-item" onClick={() => lockPanel("manual")}>
              <AdminIcon name="power" size={15} />
              <span>Bloquear panel</span>
              <small>Se reabre con tu PIN</small>
            </button>
          ) : null}
          <button type="button" className="admin-account-item" onClick={() => void logout()} disabled={loggingOut}>
            <AdminIcon name="logout" size={15} />
            <span>{demo ? "Salir de la demo" : "Cerrar sesión"}</span>
            <small>{demo ? "Volver a ledbox.online" : "Terminar la sesión en este dispositivo"}</small>
          </button>
          {canManageOrganization(user?.role ?? null) ? (
            <Link className="admin-account-item" href="/ajustes/empresa">
              <AdminIcon name="building" size={15} />
              <span>Empresa</span>
              <small>Nombre y logos</small>
            </Link>
          ) : null}
        </div>
      </AdminPanel>
      {confirmAvatar ? (
        <AdminConfirmDialog
          title="Quitar tu foto de perfil"
          message="El avatar vuelve a tus iniciales."
          confirmLabel="Quitar"
          icon="trash"
          danger
          onConfirm={() => void removeAvatar()}
          onClose={() => setConfirmAvatar(false)}
        />
      ) : null}
    </div>
  );
}
