"use client";

import { useEffect, useMemo, useState } from "react";
import { adminRoleLabel, formatDateTime } from "@/lib/admin-format";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { adminAvatarUrl } from "@/lib/admin-types";
import { normalizePersonName, personNameValid, pinError, PIN_MAX_DIGITS, PIN_MIN_DIGITS } from "@/lib/field-rules";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { PasswordField, PinField, SegmentedField, TextField } from "../AdminFields";
import { AdminButton, AdminImageUpload, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Mi perfil (issue #22): cualquier rol edita su **nombre**, su **contraseña**
 * (pidiendo la actual, mínimo 8) y su **foto**. El correo no se edita acá: es la
 * identidad de acceso y lo cambia un OWNER/ADMIN desde Equipo.
 *
 * El avatar es el objeto único del panel (foto subida → iniciales), con
 * validación por magic bytes y recorte/compresión en el navegador. En la demo
 * pública todo queda en solo lectura (el API responde 403 «Modo demo»).
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

  // Seguridad del panel (issue #21): PIN de desbloqueo y auto-bloqueo.
  const pinConfig = useAdminResource("/api/admin/profile/pin", (payload) => ({
    pin: { hasPin: payload.pin?.hasPin === true, updatedAt: payload.pin?.updatedAt ?? null },
    autoLock: {
      enabled: payload.autoLock?.enabled !== false,
      minutes: typeof payload.autoLock?.minutes === "number" ? payload.autoLock.minutes : 10,
    },
    hasPassword: payload.hasPassword === true,
  }));
  const security = pinConfig.data;
  const hasPin = security?.pin.hasPin === true;
  const [pinCurrent, setPinCurrent] = useState("");
  const [pinPassword, setPinPassword] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [pinRepeat, setPinRepeat] = useState("");
  const [pinFormError, setPinFormError] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [removePinValue, setRemovePinValue] = useState("");
  const [removePinPassword, setRemovePinPassword] = useState("");
  const [removePinError, setRemovePinError] = useState("");
  const [removingPin, setRemovingPin] = useState(false);
  const [autoLockValue, setAutoLockValue] = useState("10");
  const [autoLockError, setAutoLockError] = useState("");
  const [savingAutoLock, setSavingAutoLock] = useState(false);

  useEffect(() => {
    if (data) setName(data.name);
  }, [data]);

  useEffect(() => {
    if (security) setAutoLockValue(security.autoLock.enabled ? String(security.autoLock.minutes) : "never");
  }, [security]);

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

  /** Configura o cambia el PIN (issue #21). Cambiarlo pide el PIN anterior o la contraseña. */
  async function savePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPinFormError("");
    setNotice("");
    const invalidPin = pinError(pinNew);
    if (invalidPin) {
      setPinFormError(invalidPin);
      return;
    }
    if (pinNew !== pinRepeat) {
      setPinFormError("Los dos PIN nuevos no coinciden.");
      return;
    }
    if (hasPin && !pinCurrent && !pinPassword) {
      setPinFormError("Para cambiar el PIN ingresá el PIN actual o tu contraseña.");
      return;
    }
    setSavingPin(true);
    const result = await adminSend("/api/admin/profile/pin", {
      pin: pinNew,
      currentPin: pinCurrent,
      currentPassword: pinPassword,
    });
    setSavingPin(false);
    if (!result.ok) {
      setPinFormError(result.error);
      return;
    }
    setPinCurrent("");
    setPinPassword("");
    setPinNew("");
    setPinRepeat("");
    setNotice(
      hasPin
        ? "PIN actualizado: el panel se reabre con el nuevo PIN."
        : "PIN configurado: el panel se reabre con el PIN después del bloqueo por inactividad.",
    );
    pinConfig.reload();
    reload();
  }

  /** Quita el PIN (mismas credenciales que el cambio): sin PIN no hay bloqueo rápido. */
  async function removePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRemovePinError("");
    setNotice("");
    if (!removePinValue && !removePinPassword) {
      setRemovePinError("Ingresá tu PIN actual o tu contraseña.");
      return;
    }
    setRemovingPin(true);
    const result = await adminSend(
      "/api/admin/profile/pin",
      { currentPin: removePinValue, currentPassword: removePinPassword },
      "DELETE",
    );
    setRemovingPin(false);
    if (!result.ok) {
      setRemovePinError(result.error);
      return;
    }
    setRemovePinValue("");
    setRemovePinPassword("");
    setNotice("Quitamos tu PIN: el panel deja de bloquearse por inactividad.");
    pinConfig.reload();
    reload();
  }

  /** Preferencia de auto-bloqueo: 5/10/15/30 minutos o «nunca», por usuario. */
  async function saveAutoLock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAutoLockError("");
    setNotice("");
    setSavingAutoLock(true);
    const result = await adminSend(
      "/api/admin/profile/pin",
      {
        autoLockEnabled: autoLockValue !== "never",
        autoLockMinutes: autoLockValue === "never" ? security?.autoLock.minutes ?? 10 : Number(autoLockValue),
      },
      "PATCH",
    );
    setSavingAutoLock(false);
    if (!result.ok) {
      setAutoLockError(result.error);
      return;
    }
    setNotice(
      autoLockValue === "never"
        ? "Listo: el panel no se va a bloquear por inactividad."
        : `Listo: el panel se bloquea tras ${autoLockValue} minutos de inactividad.`,
    );
    pinConfig.reload();
    reload();
  }

  return (
    <div className="admin-module-page">
      {demo ? <AdminNote>Modo demo: el perfil es de solo lectura.</AdminNote> : null}
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      <AdminPanel title="Datos personales" meta={data ? `Rol: ${adminRoleLabel(data.role)}` : undefined}>
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

      <AdminPanel title="Contraseña" meta="Mínimo 8 caracteres">
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

      <AdminPanel
        title="PIN y bloqueo por inactividad"
        meta={security?.pin.hasPin ? "PIN activo" : "Sin PIN"}
      >
        <form className="admin-settings" onSubmit={savePin}>
          {security && !security.pin.hasPin ? (
            <AdminNote>
              Configurá un PIN de {PIN_MIN_DIGITS} a {PIN_MAX_DIGITS} dígitos para reabrir el panel sin volver a iniciar sesión.
              Sin PIN, el auto-bloqueo por inactividad no se activa.
            </AdminNote>
          ) : null}
          <div className="admin-settings-grid">
            {hasPin ? (
              <PinField
                label="PIN actual"
                value={pinCurrent}
                onChange={(value) => {
                  setPinCurrent(value);
                  setPinFormError("");
                  setNotice("");
                }}
                length={PIN_MAX_DIGITS}
                hint="Para cambiar el PIN; si no lo recordás, usá tu contraseña."
                disabled={readOnly || !security}
              />
            ) : null}
            {hasPin && security?.hasPassword ? (
              <PasswordField
                label="Contraseña actual"
                autoComplete="current-password"
                value={pinPassword}
                onChange={(value) => {
                  setPinPassword(value);
                  setPinFormError("");
                  setNotice("");
                }}
                hint="Alternativa al PIN actual."
                disabled={readOnly || !security}
              />
            ) : null}
            <PinField
              label="PIN nuevo"
              value={pinNew}
              onChange={(value) => {
                setPinNew(value);
                setPinFormError("");
                setNotice("");
              }}
              length={PIN_MAX_DIGITS}
              hint={`${PIN_MIN_DIGITS} a ${PIN_MAX_DIGITS} dígitos, solo números. Nunca se muestra ni se guarda en claro.`}
              disabled={readOnly || !security}
            />
            <PinField
              label="Repetir PIN nuevo"
              value={pinRepeat}
              onChange={(value) => {
                setPinRepeat(value);
                setPinFormError("");
                setNotice("");
              }}
              length={PIN_MAX_DIGITS}
              disabled={readOnly || !security}
            />
          </div>
          {pinFormError ? (
            <span className="admin-field-error" role="alert">
              {pinFormError}
            </span>
          ) : null}
          <div className="admin-settings-actions">
            <AdminButton
              type="submit"
              variant="primary"
              icon="check"
              busy={savingPin}
              disabled={
                readOnly ||
                !security ||
                pinNew.length < PIN_MIN_DIGITS ||
                pinRepeat.length < PIN_MIN_DIGITS ||
                (hasPin && !pinCurrent && !pinPassword)
              }
            >
              {hasPin ? "Cambiar PIN" : "Crear PIN"}
            </AdminButton>
            {security?.pin.updatedAt ? (
              <span className="admin-panel-meta">Actualizado: {formatDateTime(security.pin.updatedAt)}</span>
            ) : null}
          </div>
        </form>

        <form className="admin-settings" onSubmit={saveAutoLock}>
          <SegmentedField
            label="Bloquear por inactividad"
            value={autoLockValue}
            onChange={(value) => {
              setAutoLockValue(value);
              setAutoLockError("");
              setNotice("");
            }}
            options={[
              { value: "5", label: "5 min" },
              { value: "10", label: "10 min" },
              { value: "15", label: "15 min" },
              { value: "30", label: "30 min" },
              { value: "never", label: "Nunca" },
            ]}
            hint="Al cumplirse, el panel se tapa y solo tu PIN lo reabre. Cualquier actividad reinicia el reloj; al volver de dormido se controla el tiempo transcurrido."
            error={autoLockError || null}
            disabled={readOnly || !security || !hasPin}
          />
          <div className="admin-settings-actions">
            <AdminButton type="submit" icon="clock" busy={savingAutoLock} disabled={readOnly || !security || !hasPin}>
              Guardar bloqueo
            </AdminButton>
          </div>
        </form>

        {hasPin ? (
          <form className="admin-settings" onSubmit={removePin}>
            <AdminNote>
              Quitar el PIN desactiva el bloqueo rápido (el auto-bloqueo deja de aplicarse). Para confirmarlo, ingresá el PIN
              actual o tu contraseña.
            </AdminNote>
            <div className="admin-settings-grid">
              <PinField
                label="PIN actual"
                value={removePinValue}
                onChange={(value) => {
                  setRemovePinValue(value);
                  setRemovePinError("");
                  setNotice("");
                }}
                length={PIN_MAX_DIGITS}
                disabled={readOnly || !security}
              />
              {security?.hasPassword ? (
                <PasswordField
                  label="Contraseña actual"
                  autoComplete="current-password"
                  value={removePinPassword}
                  onChange={(value) => {
                    setRemovePinPassword(value);
                    setRemovePinError("");
                    setNotice("");
                  }}
                  hint="Alternativa al PIN actual."
                  disabled={readOnly || !security}
                />
              ) : null}
            </div>
            {removePinError ? (
              <span className="admin-field-error" role="alert">
                {removePinError}
              </span>
            ) : null}
            <div className="admin-settings-actions">
              <AdminButton
                type="submit"
                icon="trash"
                busy={removingPin}
                disabled={readOnly || !security || (!removePinValue && !removePinPassword)}
              >
                Quitar PIN
              </AdminButton>
            </div>
          </form>
        ) : null}
      </AdminPanel>
    </div>
  );
}
