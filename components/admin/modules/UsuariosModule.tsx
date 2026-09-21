"use client";

import { useMemo, useState } from "react";
import { adminRoleLabel, formatDate, formatNumber, statusTone } from "@/lib/admin-format";
import { canManageUsers, matchesQuery } from "@/lib/admin-policy";
import { adminAvatarUrl, type AdminUserRow } from "@/lib/admin-types";
import { emailError, FIELD_MESSAGES, normalizePersonName, personNameValid } from "@/lib/field-rules";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminFormPanel,
  AdminKpi,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
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

const EMPTY_FORM = { name: "", email: "", password: "", role: "VIEWER" };

const EMPTY_EDIT = { name: "", email: "" };

/**
 * Equipo / Usuarios (issue #22): además de crear, cambiar el rol y
 * activar/desactivar, un OWNER/ADMIN edita el **nombre** y el **correo** de un
 * usuario de la empresa. El correo es la identidad de acceso: al cambiarlo se
 * cierran sus sesiones y vuelve a entrar con el correo nuevo (si el cambio es
 * del propio usuario, el panel lo manda al login).
 *
 * Un ADMIN no toca a un OWNER y nadie edita su propio rol ni se desactiva.
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
  const [rowError, setRowError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const writable = canManageUsers(role);
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
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/users", form);
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
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
    if (!editing) return;
    const name = normalizePersonName(editForm.name);
    const email = editForm.email.trim().toLowerCase();
    if (!personNameValid(name)) {
      setEditError(FIELD_MESSAGES.name);
      return;
    }
    const invalidEmail = emailError(email);
    if (invalidEmail) {
      setEditError(invalidEmail);
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

  function toggleActive(user: AdminUserRow) {
    const message = user.active
      ? `¿Desactivar a ${user.name}? No va a poder iniciar sesión hasta que lo actives de nuevo.`
      : `¿Activar a ${user.name}?`;
    if (!window.confirm(message)) return;
    void patch(user, { active: !user.active });
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de usuarios">
        <AdminKpi label="Usuarios" value={formatNumber(list.length)} note="con acceso al panel" />
        <AdminKpi label="Activos" value={formatNumber(totals.active)} note="pueden ingresar" tone="ok" />
        <AdminKpi label="Administradores" value={formatNumber(totals.admins)} note="propietarios y admins" tone="accent" />
        <AdminKpi label="Consulta" value={formatNumber(totals.viewers)} note="solo lectura" />
      </section>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar usuarios" placeholder="Buscar por nombre, correo o rol…" />
        <AdminSelect value={roleFilter} onChange={setRoleFilter} label="Filtrar por rol" options={ROLE_OPTIONS} />
        {writable ? (
          <AdminButton
            variant="primary"
            icon="plus"
            onClick={() => {
              setFormError("");
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

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo usuario"
          submitLabel="Crear usuario"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <TextField
            label="Nombre"
            required
            maxLength={120}
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
            placeholder="Ej.: Ana Martínez"
          />
          <EmailField
            label="Correo"
            required
            value={form.email}
            onChange={(value) => setForm({ ...form, email: value })}
            placeholder="ana@ledbox.online"
          />
          <PasswordField
            label="Contraseña inicial"
            hint="Mínimo 12 caracteres"
            required
            minLength={12}
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            autoComplete="new-password"
          />
          <SelectField
            label="Rol"
            value={form.role}
            onChange={(value) => setForm({ ...form, role: value })}
            options={ASSIGNABLE_ROLES.map((value) => ({ value, label: adminRoleLabel(value) }))}
          />
        </AdminFormPanel>
      ) : null}

      {editing ? (
        <AdminFormPanel
          title={`Editar usuario · ${editing.name}`}
          submitLabel="Guardar cambios"
          onSubmit={submitEdit}
          onCancel={() => setEditing(null)}
          busy={editBusy}
          status={editError}
        >
          <TextField
            label="Nombre"
            required
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
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={users.loading}
        error={users.error}
        onRetry={users.reload}
        empty={list.length === 0}
        emptyTitle="Sin usuarios cargados"
        emptyHint="Creá el primer usuario para dar acceso al panel."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de rol." />
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
                      options={ASSIGNABLE_ROLES.map((value) => ({ value, label: adminRoleLabel(value) }))}
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
                        <button
                          type="button"
                          className="admin-iconbtn"
                          onClick={() => startEdit(user)}
                          disabled={rowBusy === user.id}
                          title={`Editar nombre y correo: ${user.name}`}
                          aria-label={`Editar nombre y correo: ${user.name}`}
                        >
                          <AdminIcon name="edit" size={15} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="admin-iconbtn"
                        onClick={() => toggleActive(user)}
                        disabled={rowBusy === user.id}
                        title={user.active ? `Desactivar acceso de ${user.name}` : `Activar acceso de ${user.name}`}
                        aria-label={user.active ? `Desactivar acceso de ${user.name}` : `Activar acceso de ${user.name}`}
                      >
                        <AdminIcon name="power" size={15} />
                      </button>
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
