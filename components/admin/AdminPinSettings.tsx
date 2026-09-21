"use client";

import { useEffect, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { PIN_MAX_DIGITS, PIN_MIN_DIGITS, pinError } from "@/lib/field-rules";
import { useAdminSession } from "./AdminShell";
import { PasswordField, PinField, SegmentedField } from "./AdminFields";
import { AdminButton, AdminNote, AdminPanel } from "./AdminUI";

/**
 * Configuración del PIN de desbloqueo y del auto-bloqueo por inactividad
 * (issue #21). Es el **objeto único** de esa configuración: se monta con una
 * sola línea (`<AdminPinSettings />`) donde haga falta, sin repetir estado ni
 * reglas. Hoy lo usa Mi perfil; la página de Configuración puede montarlo tal
 * cual debajo de su sección Seguridad.
 *
 * Todo sale del API real (`/api/admin/profile/pin`): crear el PIN, cambiarlo (o
 * quitarlo) pidiendo el PIN anterior **o** la contraseña, y elegir cada cuánto se
 * bloquea el panel (5/10/15/30 minutos o «nunca»). Sin PIN el auto-bloqueo no se
 * activa, así que la preferencia queda deshabilitada hasta configurarlo. En la
 * demo pública todo es de solo lectura.
 */
export function AdminPinSettings() {
  const { demo, reload } = useAdminSession();
  const readOnly = demo;
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

  const [notice, setNotice] = useState("");
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
    if (security) setAutoLockValue(security.autoLock.enabled ? String(security.autoLock.minutes) : "never");
  }, [security]);

  /** Cualquier edición limpia el aviso y el error del bloque que se está tocando. */
  function touch(clear: () => void) {
    clear();
    setNotice("");
  }

  /** Configura o cambia el PIN. Cambiarlo pide el PIN anterior o la contraseña. */
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
    <AdminPanel title="PIN y bloqueo por inactividad" meta={hasPin ? "PIN activo" : "Sin PIN"}>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      <form className="admin-settings" onSubmit={savePin}>
        {security && !hasPin ? (
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
              onChange={(value) => touch(() => setPinCurrent(value))}
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
              onChange={(value) => touch(() => setPinPassword(value))}
              hint="Alternativa al PIN actual."
              disabled={readOnly || !security}
            />
          ) : null}
          <PinField
            label="PIN nuevo"
            value={pinNew}
            onChange={(value) => touch(() => setPinNew(value))}
            length={PIN_MAX_DIGITS}
            hint={`${PIN_MIN_DIGITS} a ${PIN_MAX_DIGITS} dígitos, solo números. Nunca se muestra ni se guarda en claro.`}
            disabled={readOnly || !security}
          />
          <PinField
            label="Repetir PIN nuevo"
            value={pinRepeat}
            onChange={(value) => touch(() => setPinRepeat(value))}
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
          onChange={(value) => touch(() => setAutoLockValue(value))}
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
              onChange={(value) => touch(() => setRemovePinValue(value))}
              length={PIN_MAX_DIGITS}
              disabled={readOnly || !security}
            />
            {security?.hasPassword ? (
              <PasswordField
                label="Contraseña actual"
                autoComplete="current-password"
                value={removePinPassword}
                onChange={(value) => touch(() => setRemovePinPassword(value))}
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
  );
}
