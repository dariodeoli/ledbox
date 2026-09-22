"use client";

import { useEffect, useMemo, useState } from "react";
import { adminRoleLabel } from "@/lib/admin-format";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { adminAvatarUrl } from "@/lib/admin-types";
import { normalizePersonName, personNameValid } from "@/lib/field-rules";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { PasswordField, TextField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminImageUpload, AdminNote, AdminPanel } from "../AdminUI";
import { AdminPinSettings } from "../AdminPinSettings";

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
  const { user, demo, reload } = useAdminSession();
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
    if (!window.confirm("¿Quitar tu foto de perfil? El avatar vuelve a tus iniciales.")) return;
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

  return (
    <div className="admin-module-page">
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
              onRemove={avatarUpdatedAt ? () => void removeAvatar() : undefined}
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

      {/* Seguridad del panel (issue #21): PIN y auto-bloqueo por inactividad. */}
      <AdminPinSettings />
    </div>
  );
}
