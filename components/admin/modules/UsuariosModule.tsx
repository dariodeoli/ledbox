"use client";

import { useMemo, useState } from "react";
import { adminRoleLabel, formatDate, formatNumber, statusTone } from "@/lib/admin-format";
import { canManageUsers, matchesQuery } from "@/lib/admin-policy";
import type { AdminUserRow } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
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
import { adminSend, useAdminResource } from "@/lib/admin-api";

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

export function UsuariosModule() {
  const { role } = useAdminSession();
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
                  <strong>{user.name}</strong>
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
