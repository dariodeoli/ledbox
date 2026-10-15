"use client";

import { kpiState } from "@/components/admin/kpi-state";
import { useEffect, useId, useMemo, useState } from "react";
import { adminRoleLabel, formatCountdown, formatDate, formatDateShort, formatDateTime, formatNumber, invitationStatusLabel, invitationStatusTone, mailStatusLabel, statusTone } from "@/lib/admin-format";
import type { AdminTeamInvitation } from "@/lib/admin-types";
import { canManageUsers, matchesQuery } from "@/lib/admin-policy";
import { adminAvatarUrl, type AdminUserRow } from "@/lib/admin-types";
import { invitationFormValidity, userFormValidity } from "./usuarios-form-validity";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import { useAdminNarrowViewport } from "../AdminBoard";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminEmpty,
  AdminConfirmDialog,
  AdminDialog,
  AdminDialogSection,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminPanel,
  AdminPlanLimitNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminIconButton,
} from "../AdminUI";
import { EmailField, PasswordField, SearchField, SelectField, TextField } from "../AdminFields";
import { adminSend, redirectToLogin, useAdminResource } from "@/lib/admin-api";

const ROLE_OPTIONS = [
  { value: "ALL", label: "Todos los roles" },
  { value: "OWNER", label: "Propietario" },
  { value: "ADMIN", label: "Administrador" },
  { value: "FINANCE", label: "Finanzas" },
  { value: "OPERATIONS", label: "Operaciones" },
  { value: "VIEWER", label: "Consulta" },
];

const ASSIGNABLE_ROLES = ["ADMIN", "FINANCE", "OPERATIONS", "VIEWER"];

const ROLE_SELECT_OPTIONS = ASSIGNABLE_ROLES.map((value) => ({ value, label: adminRoleLabel(value) }));

const EMPTY_FORM = { name: "", email: "", password: "", role: "VIEWER" };

const EMPTY_EDIT = { name: "", email: "" };

const EMPTY_INVITE = { email: "", role: "VIEWER" };

/**
 * Equipo / Usuarios (issue #22): además de crear, cambiar el rol y
 * activar/desactivar, un OWNER/ADMIN edita el **nombre** y el **correo** de un
 * usuario de la empresa. El correo es la identidad de acceso: al cambiarlo se
 * cierran sus sesiones y vuelve a entrar con el correo nuevo (si el cambio es
 * del propio usuario, el panel lo manda al login).
 *
 * Un ADMIN no toca a un OWNER y nadie edita su propio rol ni se desactiva.
 *
 * Issue #31: suma la invitación por correo (`InvitationsPanel`): el diálogo
 * crea la invitación con su rol y la manda, y la lista muestra las que están por
 * aceptar con reenviar/revocar.
 */
export function UsuariosModule() {
  const { role, user: sessionUser } = useAdminSession();
  const users = useAdminResource("/api/admin/users", (payload) => payload.users ?? []);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState("");
  const [formError, setFormError] = useState("");
  const [formLimit, setFormLimit] = useState("");
  const [rowError, setRowError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const writable = canManageUsers(role);
  const createValidity = userFormValidity(form, "create");
  const editValidity = userFormValidity(editForm, "edit");
  const createFormId = useId();
  const editFormId = useId();
  const createDirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
  const editDirty = editing !== null && (editForm.name !== editing.name || editForm.email !== editing.email);
  const compact = useAdminNarrowViewport();
  const list = useMemo(() => users.data ?? [], [users.data]);
  const rows = useMemo(
    () =>
      list
        .filter((user) => (roleFilter === "ALL" ? true : user.role === roleFilter))
        .filter((user) => matchesQuery(query, [user.name, user.email, user.role])),
    [list, query, roleFilter],
  );

  const totals = useMemo(
    () => ({
      active: list.filter((user) => user.active).length,
      admins: list.filter((user) => user.role === "OWNER" || user.role === "ADMIN").length,
      viewers: list.filter((user) => user.role === "VIEWER").length,
    }),
    [list],
  );

  /** Un ADMIN no edita a un OWNER; nadie se edita el rol (issue #22). */
  function canEditUser(user: AdminUserRow): boolean {
    if (!writable) return false;
    return user.role !== "OWNER" || role === "OWNER";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || busy) return;
    if (createValidity.error) {
      setFormError(createValidity.error);
      return;
    }
    setBusy(true);
    setFormError("");
    setFormLimit("");
    setNotice("");
    const result = await adminSend("/api/admin/users", { ...form, name: createValidity.name, email: createValidity.email });
    setBusy(false);
    if (!result.ok) {
      // Tope del plan (issue #42): el servidor explica el límite y acá se suma
      // el acceso a la página de Plan para pedir el cambio.
      if (result.code === "plan_limit") setFormLimit(result.error);
      else setFormError(result.error);
      return;
    }
    setNotice(`Usuario «${form.name}» creado.`);
    setForm(EMPTY_FORM);
    users.reload();
  }

  function startEdit(user: AdminUserRow) {
    setEditing(user);
    setEditForm({ name: user.name, email: user.email });
    setEditError("");
    setNotice("");
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !canEditUser(editing) || editBusy) return;
    const { name, email, error } = editValidity;
    if (error) {
      setEditError(error);
      return;
    }
    setEditBusy(true);
    setEditError("");
    const result = await adminSend<{ sessionsClosed?: number; loggedOut?: boolean }>(
      "/api/admin/users",
      { id: editing.id, name, email },
      "PATCH",
    );
    setEditBusy(false);
    if (!result.ok) {
      setEditError(result.error);
      return;
    }
    const closed = result.data.sessionsClosed ?? 0;
    const emailChanged = email !== editing.email.toLowerCase();
    setEditing(null);
    setNotice(
      emailChanged
        ? closed > 0
          ? `Datos de «${name}» guardados y sus ${closed} ${closed === 1 ? "sesión abierta" : "sesiones abiertas"} cerradas: entra con el correo nuevo.`
          : `Datos de «${name}» guardados: entra con el correo nuevo.`
        : `Datos de «${name}» guardados.`,
    );
    users.reload();
    if (result.data.loggedOut) {
      // El cambio de correo era del propio usuario: su sesión ya no vale.
      redirectToLogin();
    }
  }

  async function patch(user: AdminUserRow, data: { active?: boolean; role?: string }) {
    setRowBusy(user.id);
    setRowError("");
    setNotice("");
    const result = await adminSend("/api/admin/users", { id: user.id, ...data }, "PATCH");
    setRowBusy("");
    if (!result.ok) {
      setRowError(result.error);
      return;
    }
    setNotice(`Usuario «${user.name}» actualizado.`);
    users.reload();
  }

  /** Usuario cuyo (des)activado espera confirmación (diálogo propio, nunca confirm() nativo). */
  const [toggleTarget, setToggleTarget] = useState<AdminUserRow | null>(null);

  function toggleActive(user: AdminUserRow) {
    setToggleTarget(user);
  }

  // En ancho compacto (≤980 px, issue #154) la lista se lee como tarjetas: la
  // tabla de seis columnas exigía desplazamiento horizontal en 390. El selector
  // de rol del que sí puede editarlo vive entre los datos; las acciones, al pie.
  const userCards: AdminCardData[] = rows.map((user) => {
    const self = user.id === sessionUser?.id;
    const roleEditable = writable && user.role !== "OWNER";
    return {
      id: user.id,
      title: (
        <>
          <AdminAvatar
            name={user.name}
            src={user.avatarUpdatedAt ? adminAvatarUrl(user.id, user.avatarUpdatedAt) : null}
            size={22}
          />
          <span className="admin-item-name">{user.name}</span>
          {self ? <span className="admin-cell-sub">· vos</span> : null}
        </>
      ),
      titleTooltip: user.name,
      subtitle: user.email,
      badges: [
        {
          label: user.active ? "Activo" : "Inactivo",
          tone: user.active ? "ok" : "neutral",
          title: user.active ? "Puede ingresar al panel" : "No puede ingresar hasta que lo actives",
        },
      ],
      fields: [
        {
          label: "Rol",
          value: roleEditable ? (
            <AdminSelect
              className="admin-filter admin-filter--cell"
              value={user.role}
              disabled={rowBusy === user.id}
              onChange={(value) => void patch(user, { role: value })}
              label={`Rol de ${user.name}`}
              title={`Rol de ${user.name}`}
              options={ROLE_SELECT_OPTIONS}
            />
          ) : (
            <AdminBadge tone={statusTone(user.role)}>{adminRoleLabel(user.role)}</AdminBadge>
          ),
          title: adminRoleLabel(user.role),
        },
        { label: "Alta", value: formatDate(user.createdAt), title: formatDate(user.createdAt) },
      ],
      footer: writable ? (
        <span className="admin-actions">
          {canEditUser(user) ? (
            <AdminButton
              icon="edit"
              onClick={() => startEdit(user)}
              disabled={rowBusy === user.id}
              title={`Editar nombre y correo: ${user.name}`}
              aria-label={`Editar nombre y correo: ${user.name}`}
            />
          ) : null}
          <AdminButton
            icon="power"
            onClick={() => toggleActive(user)}
            disabled={rowBusy === user.id}
            title={user.active ? `Desactivar acceso de ${user.name}` : `Activar acceso de ${user.name}`}
            aria-label={user.active ? `Desactivar acceso de ${user.name}` : `Activar acceso de ${user.name}`}
          />
        </span>
      ) : undefined,
    };
  });

  return (
    <div className="admin-module-page">
      <AdminKpis state={kpiState(users)} label="Indicadores de usuarios">
        <AdminKpi label="Usuarios" icon="users" value={formatNumber(list.length)} note="con acceso al panel" />
        <AdminKpi label="Activos" icon="check" value={formatNumber(totals.active)} note="pueden ingresar" tone="ok" />
        <AdminKpi label="Administradores" icon="users" value={formatNumber(totals.admins)} note="propietarios y admins" tone="accent" />
        <AdminKpi label="Consulta" icon="eye" value={formatNumber(totals.viewers)} note="solo lectura" />
      </AdminKpis>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar usuarios" placeholder="Buscar por nombre, correo o rol…" />
        <AdminSelect value={roleFilter} onChange={setRoleFilter} label="Filtrar por rol" options={ROLE_OPTIONS} />
        {writable ? (
          <AdminButton
            variant="primary"
            icon="plus"
            onClick={() => {
              setFormError("");
              setFormLimit("");
              setShowForm((open) => !open);
            }}
            aria-expanded={showForm}
          >
            Nuevo usuario
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {rowError ? <AdminNote tone="error">{rowError}</AdminNote> : null}

      {writable ? <InvitationsPanel /> : null}

      {toggleTarget ? (
        <AdminConfirmDialog
          title={toggleTarget.active ? `Desactivar a ${toggleTarget.name}` : `Activar a ${toggleTarget.name}`}
          message={
            toggleTarget.active
              ? "No va a poder iniciar sesión hasta que lo actives de nuevo."
              : "Va a poder iniciar sesión de nuevo con su cuenta."
          }
          confirmLabel={toggleTarget.active ? "Desactivar" : "Activar"}
          icon={toggleTarget.active ? "lock" : "check"}
          danger={toggleTarget.active}
          busy={rowBusy === toggleTarget.id}
          onConfirm={() => {
            const target = toggleTarget;
            void patch(target, { active: !target.active }).then(() => setToggleTarget(null));
          }}
          onClose={() => setToggleTarget(null)}
        />
      ) : null}

      {writable && showForm ? (
        <AdminDialog
          title="Nuevo usuario"
          icon="users"
          description="Crea el acceso al panel con una contraseña inicial y el rol elegido."
          size="md"
          error={createValidity.error ?? (formError || null)}
          dirty={createDirty}
          onClose={() => setShowForm(false)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={createFormId} busy={busy} busyLabel="Creando…" disabled={createValidity.error !== null}>
                Crear usuario
              </AdminButton>
            </>
          )}
        >
          <form id={createFormId} className="admin-form" onSubmit={submit} aria-busy={busy || undefined}>
            {formLimit ? <AdminPlanLimitNote message={formLimit} /> : null}
            <AdminDialogSection title="Persona">
              <TextField
                label="Nombre"
                required
                autoFocus
                maxLength={120}
                value={form.name}
                onChange={(value) => { setForm({ ...form, name: value }); setFormError(""); }}
                placeholder="Ej.: Ana Martínez"
              />
              <EmailField
                label="Correo"
                required
                value={form.email}
                onChange={(value) => { setForm({ ...form, email: value }); setFormError(""); }}
                placeholder="ana@ledbox.online"
              />
            </AdminDialogSection>
            <AdminDialogSection title="Acceso">
              <PasswordField
                label="Contraseña inicial"
                hint="Mínimo 12 caracteres"
                required
                minLength={12}
                value={form.password}
                onChange={(value) => { setForm({ ...form, password: value }); setFormError(""); }}
                autoComplete="new-password"
              />
              <SelectField
                label="Rol"
                value={form.role}
                onChange={(value) => setForm({ ...form, role: value })}
                options={ROLE_SELECT_OPTIONS}
              />
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      {editing ? (
        <AdminDialog
          title={`Editar usuario · ${editing.name}`}
          icon="users"
          description="Nombre y correo de acceso. Si el correo cambia, se cierran sus sesiones abiertas."
          size="md"
          error={editValidity.error ?? (editError || null)}
          dirty={editDirty}
          onClose={() => setEditing(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={editBusy}>
                Cancelar
              </AdminButton>
              <AdminButton
                type="submit"
                variant="primary"
                icon="check"
                form={editFormId}
                busy={editBusy}
                busyLabel="Guardando…"
                disabled={editValidity.error !== null || !canEditUser(editing)}
              >
                Guardar cambios
              </AdminButton>
            </>
          )}
        >
          <form id={editFormId} className="admin-form" onSubmit={submitEdit} aria-busy={editBusy || undefined}>
            <AdminDialogSection title="Datos">
              <TextField
                label="Nombre"
                required
                autoFocus
                maxLength={120}
                value={editForm.name}
                onChange={(value) => {
                  setEditForm({ ...editForm, name: value });
                  setEditError("");
                }}
              />
              <EmailField
                label="Correo"
                required
                value={editForm.email}
                onChange={(value) => {
                  setEditForm({ ...editForm, email: value });
                  setEditError("");
                }}
                hint="Si cambia, se cierran sus sesiones abiertas y entra con el correo nuevo."
              />
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      <AdminDataState
        loading={users.loading}
        error={users.error}
        onRetry={users.reload}
        empty={list.length === 0}
        emptyTitle="Sin usuarios cargados" emptyIcon="users"
        emptyHint="Creá el primer usuario para dar acceso al panel."
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de rol." />
        ) : compact ? (
          <AdminCardGrid label="Usuarios del panel" cards={userCards} />
        ) : (
          <AdminTable
            view="usuarios"
            label="Usuarios del panel"
            columns={[
              { label: "Usuario" },
              { label: "Correo" },
              { label: "Rol" },
              { label: "Estado" },
              { label: "Alta" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((user) => (
              <AdminRow key={user.id}>
                <AdminCell title={user.name}>
                  <span className="admin-identity">
                    <AdminAvatar
                      name={user.name}
                      src={user.avatarUpdatedAt ? adminAvatarUrl(user.id, user.avatarUpdatedAt) : null}
                      size={22}
                    />
                    <strong>{user.name}</strong>
                    {user.id === sessionUser?.id ? <span className="admin-cell-sub">· vos</span> : null}
                  </span>
                </AdminCell>
                <AdminCell title={user.email}>{user.email}</AdminCell>
                <AdminCell>
                  {user.role === "OWNER" || !writable ? (
                    <AdminBadge tone={statusTone(user.role)}>{adminRoleLabel(user.role)}</AdminBadge>
                  ) : (
                    <AdminSelect
                      className="admin-filter admin-filter--cell"
                      value={user.role}
                      disabled={rowBusy === user.id}
                      onChange={(value) => void patch(user, { role: value })}
                      label={`Rol de ${user.name}`}
                      title={`Rol de ${user.name}`}
                      options={ROLE_SELECT_OPTIONS}
                    />
                  )}
                </AdminCell>
                <AdminCell>
                  <AdminBadge tone={user.active ? "ok" : "neutral"}>{user.active ? "Activo" : "Inactivo"}</AdminBadge>
                </AdminCell>
                <AdminCell title={formatDate(user.createdAt)}>
                  <span className="admin-nowrap">{formatDate(user.createdAt)}</span>
                </AdminCell>
                <AdminCell end>
                  {writable ? (
                    <span className="admin-actions">
                      {canEditUser(user) ? (
                        <AdminIconButton icon="edit" label={`Editar nombre y correo: ${user.name}`} onClick={() => startEdit(user)} disabled={rowBusy === user.id} />
                      ) : null}
                      <AdminIconButton icon="power" label={user.active ? `Desactivar acceso de ${user.name}` : `Activar acceso de ${user.name}`} onClick={() => toggleActive(user)} disabled={rowBusy === user.id} />
                    </span>
                  ) : (
                    <span className="admin-muted">—</span>
                  )}
                </AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        )}
      </AdminDataState>
    </div>
  );
}

// ── Invitaciones al equipo (issue #31) ──────────────────────────────────────
// Diálogo de invitación + lista de las que están por aceptar. Una sola
// invitación por correo: volver a invitar o reenviar actualiza la existente y
// manda un link nuevo (el anterior deja de servir).

/** Texto honesto según lo que devolvió el envío real del correo. */
function inviteDeliveryNotice(status: string, error?: string | null): { tone: "ok" | "error"; text: string } {
  if (status === "sent") return { tone: "ok", text: "Invitación enviada por correo." };
  const detail = error?.trim() ? ` ${error.trim()}` : "";
  if (status === "skipped") {
    return { tone: "error", text: `La invitación quedó guardada, pero no se envió el correo: falta configurar el proveedor.${detail}` };
  }
  return { tone: "error", text: `La invitación quedó guardada, pero el correo falló.${detail} Reintentá con Reenviar.` };
}

/** Diálogo del panel: correo + rol. Contrato común (foco, Escape, clic afuera). */
function InviteDialog({
  busy,
  error,
  limitError,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  /** El error es el tope del plan (issue #42): se muestra con el acceso a Plan. */
  limitError?: boolean;
  onClose: () => void;
  onSubmit: (invite: { email: string; role: string }) => void;
}) {
  const formId = useId();
  const [invite, setInvite] = useState(EMPTY_INVITE);
  const [localError, setLocalError] = useState("");
  const inviteValidity = invitationFormValidity(invite.email);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (inviteValidity.error) {
      setLocalError(inviteValidity.error);
      return;
    }
    setLocalError("");
    onSubmit({ email: inviteValidity.email, role: invite.role });
  }

  return (
    <AdminDialog
      title="Invitar por correo"
      icon="mail"
      description="Le mandamos el link para sumarse con el rol elegido. Vence en 7 días y queda pendiente hasta que la acepte."
      size="sm"
      error={(invite !== EMPTY_INVITE ? inviteValidity.error : null) ?? (localError || (!limitError && error ? error : null))}
      dirty={invite.email !== "" || invite.role !== EMPTY_INVITE.role}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" variant="primary" icon="mail" form={formId} busy={busy} busyLabel="Enviando…" disabled={inviteValidity.error !== null}>
            Enviar invitación
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={submit} noValidate>
        {limitError && error ? <AdminPlanLimitNote message={error} /> : null}
        <AdminDialogSection title="Invitación">
        <EmailField
          label="Correo"
          required
          autoFocus
          value={invite.email}
          onChange={(value) => {
            setInvite({ ...invite, email: value });
            setLocalError("");
          }}
          placeholder="ana@ledbox.online"
          hint="La persona entra al panel con este correo."
          autoComplete="off"
        />
        <SelectField
          label="Rol"
          value={invite.role}
          onChange={(value) => setInvite({ ...invite, role: value })}
          options={ROLE_SELECT_OPTIONS}
          hint="El propietario no se invita por correo."
        />
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}

/** Confirmación propia (nunca confirm() nativo) para cortar una invitación. */
function RevokeInviteDialog({
  invitation,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  invitation: AdminTeamInvitation;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AdminConfirmDialog
      title="Revocar invitación"
      icon="trash"
      danger
      message={`¿Revocar la invitación de ${invitation.email}? El link deja de funcionar y la persona no puede sumarse al equipo con esa invitación. Podés invitarla de nuevo cuando quieras.`}
      confirmLabel="Revocar"
      busyLabel="Revocando…"
      busy={busy}
      error={error || null}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

/**
 * Lista de invitaciones por aceptar (`pending` y `expired`) con reenviar/revocar.
 * El envío real se muestra tal cual: si el correo falló o falta el proveedor, la
 * fila lo dice y la invitación sigue guardada.
 */
function InvitationsPanel() {
  const compact = useAdminNarrowViewport();
  const invitations = useAdminResource("/api/admin/invitations", (payload) => payload.invitations ?? []);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteLimit, setInviteLimit] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [rowBusy, setRowBusy] = useState("");
  const [rowError, setRowError] = useState("");
  const [revoking, setRevoking] = useState<AdminTeamInvitation | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  const list = useMemo(() => invitations.data ?? [], [invitations.data]);
  const pendingCount = list.filter((invitation) => invitation.status === "pending").length;
  const expiredCount = list.length - pendingCount;

  async function submitInvite(invite: { email: string; role: string }) {
    if (inviteBusy) return;
    const validity = invitationFormValidity(invite.email);
    if (validity.error) { setInviteError(validity.error); return; }
    setInviteBusy(true);
    setInviteError("");
    setInviteLimit(false);
    setNotice(null);
    const result = await adminSend<{ invitation: AdminTeamInvitation; mail: { status: string; error: string | null } }>(
      "/api/admin/invitations",
      { ...invite, email: validity.email },
    );
    setInviteBusy(false);
    if (!result.ok) {
      // Tope del plan (issue #42): la invitación reserva un lugar del cupo.
      setInviteLimit(result.code === "plan_limit");
      setInviteError(result.error);
      return;
    }
    setShowInvite(false);
    setNotice(inviteDeliveryNotice(result.data.mail?.status ?? "", result.data.mail?.error));
    invitations.reload();
  }

  async function resend(invitation: AdminTeamInvitation) {
    setRowBusy(invitation.id);
    setRowError("");
    setNotice(null);
    const result = await adminSend<{ mail: { status: string; error: string | null } }>(
      `/api/admin/invitations/${encodeURIComponent(invitation.id)}`,
      { action: "resend" },
      "PATCH",
    );
    setRowBusy("");
    if (!result.ok) {
      setRowError(result.error);
      return;
    }
    setNotice(inviteDeliveryNotice(result.data.mail?.status ?? "", result.data.mail?.error));
    invitations.reload();
  }

  async function confirmRevoke() {
    if (!revoking) return;
    setRevokeBusy(true);
    setRevokeError("");
    const result = await adminSend(
      `/api/admin/invitations/${encodeURIComponent(revoking.id)}`,
      { action: "revoke" },
      "PATCH",
    );
    setRevokeBusy(false);
    if (!result.ok) {
      setRevokeError(result.error);
      return;
    }
    setNotice({ tone: "ok", text: `Invitación de ${revoking.email} revocada: el link dejó de funcionar.` });
    setRevoking(null);
    invitations.reload();
  }

  // Tarjetas de invitaciones para ancho compacto (issue #154), mismo criterio
  // que la lista de usuarios: datos en el cuerpo, acciones reenviar/revocar al pie.
  const invitationCards: AdminCardData[] = list.map((invitation) => ({
    id: invitation.id,
    title: invitation.email,
    titleTooltip: invitation.email,
    subtitle: invitation.invitedByEmail ? `Invita ${invitation.invitedByName}` : null,
    badges: [
      { label: adminRoleLabel(invitation.role), tone: statusTone(invitation.role), title: `Rol: ${adminRoleLabel(invitation.role)}` },
      ...(invitation.status === "expired"
        ? [{ label: invitationStatusLabel(invitation.status), tone: invitationStatusTone(invitation.status), title: "El link venció y ya no sirve" }]
        : []),
      ...(invitation.lastMail
        ? [{
            label: mailStatusLabel(invitation.lastMail.status),
            tone: invitation.lastMail.status === "sent" ? ("ok" as const) : invitation.lastMail.status === "sending" ? ("warn" as const) : ("danger" as const),
            title: `${mailStatusLabel(invitation.lastMail.status)} · ${formatDateTime(invitation.lastMail.sentAt)}${invitation.lastMail.error ? ` · ${invitation.lastMail.error}` : ""}`,
          }]
        : []),
    ],
    fields: [
      {
        label: "Vence",
        value: (
          <>
            {formatDateShort(invitation.expiresAt)}{" "}
            <AdminCountdown value={invitation.expiresAt} short className="admin-countdown--inline" />
          </>
        ),
        title: `Vence el ${formatDate(invitation.expiresAt)} · ${formatCountdown(invitation.expiresAt)}`,
      },
      {
        label: "Último envío",
        value: invitation.lastMail ? mailStatusLabel(invitation.lastMail.status) : "Sin envíos",
        title: invitation.lastMail
          ? `${mailStatusLabel(invitation.lastMail.status)} · ${formatDateTime(invitation.lastMail.sentAt)}${invitation.lastMail.error ? ` · ${invitation.lastMail.error}` : ""}`
          : "Sin envíos registrados",
      },
    ],
    footer: (
      <span className="admin-actions">
        <AdminButton
          icon="refresh"
          disabled={rowBusy === invitation.id}
          onClick={() => void resend(invitation)}
          title={`Reenviar la invitación a ${invitation.email}`}
          aria-label={`Reenviar la invitación a ${invitation.email}`}
        />
        <AdminButton
          icon="trash"
          disabled={rowBusy === invitation.id}
          onClick={() => {
            setRevokeError("");
            setRevoking(invitation);
          }}
          title={`Revocar la invitación de ${invitation.email}`}
          aria-label={`Revocar la invitación de ${invitation.email}`}
        />
      </span>
    ),
  }));

  return (
    <AdminPanel
      title="Invitaciones pendientes" icon="mail"
      meta={[`${formatNumber(pendingCount)} ${pendingCount === 1 ? "pendiente" : "pendientes"}`, expiredCount > 0 ? `${formatNumber(expiredCount)} vencida${expiredCount === 1 ? "" : "s"}` : ""]
        .filter(Boolean)
        .join(" · ")}
      action={
        <AdminButton
          variant="primary"
          icon="mail"
          onClick={() => {
            setInviteError("");
            setInviteLimit(false);
            setNotice(null);
            setShowInvite(true);
          }}
        >
          Invitar por correo
        </AdminButton>
      }
    >
      {notice ? <AdminNote tone={notice.tone}>{notice.text}</AdminNote> : null}
      {rowError ? <AdminNote tone="error">{rowError}</AdminNote> : null}

      {showInvite ? (
        <InviteDialog
          busy={inviteBusy}
          error={inviteError}
          limitError={inviteLimit}
          onClose={() => setShowInvite(false)}
          onSubmit={submitInvite}
        />
      ) : null}
      {revoking ? (
        <RevokeInviteDialog
          invitation={revoking}
          busy={revokeBusy}
          error={revokeError}
          onClose={() => setRevoking(null)}
          onConfirm={() => void confirmRevoke()}
        />
      ) : null}

      <AdminDataState
        loading={invitations.loading}
        error={invitations.error}
        onRetry={invitations.reload}
        empty={list.length === 0}
        emptyTitle="Sin invitaciones pendientes" emptyIcon="mail"
        emptyHint="Invitá a alguien por correo: le llega el link para sumarse con el rol que elijas."
      >
        {compact ? (
          <AdminCardGrid label="Invitaciones por aceptar" cards={invitationCards} />
        ) : (
        <AdminTable
          view="invitaciones"
          label="Invitaciones por aceptar"
          columns={[
            { label: "Correo" },
            { label: "Rol" },
            { label: "Invita" },
            { label: "Vence" },
            { label: "Último envío" },
            { label: "Acciones", end: true },
          ]}
        >
          {list.map((invitation) => (
            <AdminRow key={invitation.id}>
              <AdminCell title={invitation.email}>
                <span className="admin-identity">
                  <strong>{invitation.email}</strong>
                  {invitation.status === "expired" ? (
                    <AdminBadge tone={invitationStatusTone(invitation.status)}>{invitationStatusLabel(invitation.status)}</AdminBadge>
                  ) : null}
                </span>
              </AdminCell>
              <AdminCell>
                <AdminBadge tone={statusTone(invitation.role)}>{adminRoleLabel(invitation.role)}</AdminBadge>
              </AdminCell>
              <AdminCell title={invitation.invitedByEmail ?? undefined}>
                <span className="admin-nowrap">{invitation.invitedByName}</span>
              </AdminCell>
              <AdminCell title={`Vence el ${formatDate(invitation.expiresAt)} · ${formatCountdown(invitation.expiresAt)}`}>
                <span className="admin-nowrap">{formatDateShort(invitation.expiresAt)}</span>
                <AdminCountdown value={invitation.expiresAt} short className="admin-countdown--inline" />
              </AdminCell>
              <AdminCell
                title={
                  invitation.lastMail
                    ? `${mailStatusLabel(invitation.lastMail.status)} · ${formatDateTime(invitation.lastMail.sentAt)}${
                        invitation.lastMail.error ? ` · ${invitation.lastMail.error}` : ""
                      }`
                    : "Sin envíos registrados"
                }
              >
                {invitation.lastMail ? (
                  <AdminBadge tone={invitation.lastMail.status === "sent" ? "ok" : invitation.lastMail.status === "sending" ? "warn" : "danger"}>
                    {mailStatusLabel(invitation.lastMail.status)}
                  </AdminBadge>
                ) : (
                  <span className="admin-muted">—</span>
                )}
              </AdminCell>
              <AdminCell end>
                <span className="admin-actions">
                  <AdminIconButton icon="refresh" label={`Reenviar la invitación a ${invitation.email}`} disabled={rowBusy === invitation.id} onClick={() => void resend(invitation)} />
                  <AdminIconButton icon="trash" label={`Revocar la invitación de ${invitation.email}`} disabled={rowBusy === invitation.id} onClick={() => { setRevokeError(""); setRevoking(invitation); }} />
                </span>
              </AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
        )}
      </AdminDataState>
    </AdminPanel>
  );
}
