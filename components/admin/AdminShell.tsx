"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { adminModuleVisible, adminNavGroups, adminNavLabel, asAdminRole, isAdminNavActive } from "@/lib/admin-policy";
import { adminRoleLabel, initials } from "@/lib/admin-format";
import { publicConfig } from "@/lib/public-config";
import type { AdminOrganization, AdminRole, AdminSessionUser } from "@/lib/admin-types";
import { AdminIcon } from "./AdminIcons";
import { AdminEmpty, AdminErrorState, AdminLoadingRows } from "./AdminUI";
import { AdminThemeToggle } from "./admin-theme";
import { redirectToLogin } from "./use-admin-data";

export type AdminSessionState = {
  user: AdminSessionUser | null;
  role: AdminRole | null;
  organization: AdminOrganization | null;
  organizations: AdminOrganization[];
  loading: boolean;
  error: string;
};

const AdminSessionContext = createContext<AdminSessionState>({
  user: null,
  role: null,
  organization: null,
  organizations: [],
  loading: true,
  error: "",
});

export function useAdminSession(): AdminSessionState {
  return useContext(AdminSessionContext);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asSessionUser(value: unknown): AdminSessionUser | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (typeof value.name !== "string" || typeof value.email !== "string" || typeof value.role !== "string") return null;
  return { id: value.id, name: value.name, email: value.email, role: asAdminRole(value.role) };
}

function asOrganization(value: unknown): AdminOrganization | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return { id: value.id, name: value.name, slug: typeof value.slug === "string" ? value.slug : null, role: typeof value.role === "string" ? value.role : null };
}

/**
 * `GET /api/admin/session` devuelve hoy `{ user: { user, session } }` y va a pasar a
 * `{ user, organization, organizations[] }`. Se leen las dos formas.
 */
function pickSessionData(raw: unknown): { user: AdminSessionUser | null; organization: AdminOrganization | null; organizations: AdminOrganization[] } {
  const outer = isRecord(raw) ? raw : {};
  const inner = isRecord(outer.user) && "user" in outer.user ? (outer.user as Record<string, unknown>) : outer;
  const user = asSessionUser(inner.user) ?? asSessionUser(outer.user);
  const rawOrganizations = Array.isArray(inner.organizations)
    ? inner.organizations
    : Array.isArray(outer.organizations)
      ? outer.organizations
      : [];
  const organizations = rawOrganizations.map(asOrganization).filter((organization): organization is AdminOrganization => Boolean(organization));
  const organization = asOrganization(inner.organization) ?? asOrganization(outer.organization) ?? organizations[0] ?? null;
  return { user, organization, organizations };
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AdminSessionState>({
    user: null,
    role: null,
    organization: null,
    organizations: [],
    loading: true,
    error: "",
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadSession = useCallback(async () => {
    setSession((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/admin/session", { cache: "no-store" });
      // 401 sin sesión y 403 sin empresa activa (multiempresa) se tratan igual: volver al login.
      if (response.status === 401 || response.status === 403) {
        redirectToLogin();
        return;
      }
      const raw = (await response.json().catch(() => null)) as unknown;
      const { user, organization, organizations } = pickSessionData(raw);
      if (!response.ok || !user) {
        setSession((current) => ({ ...current, loading: false, error: "No pudimos cargar tu sesión." }));
        return;
      }
      const role = asAdminRole(user.role);
      setSession({ user: { ...user, role }, role, organization, organizations, loading: false, error: "" });
    } catch {
      setSession((current) => ({ ...current, loading: false, error: "No pudimos conectar con el panel." }));
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const navGroups = useMemo(() => adminNavGroups(session.role), [session.role]);
  const title = adminNavLabel(pathname);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <AdminSessionContext.Provider value={session}>
      <div className="admin-shell">
        <aside id="admin-sidebar" className={menuOpen ? "admin-sidebar is-open" : "admin-sidebar"} aria-label="Módulos del panel">
          <div className="admin-sidebar-head">
            <Link href="/dashboard" className="admin-brand" aria-label="LedBox · Ir al resumen">
              <span className="admin-brand-mark">LB</span>
              <span>
                LEDBOX<span className="admin-brand-dot">.</span>
              </span>
            </Link>
            <button
              type="button"
              className="admin-iconbtn admin-sidebar-close"
              onClick={() => setMenuOpen(false)}
              aria-label="Cerrar menú"
              title="Cerrar menú"
            >
              <AdminIcon name="close" size={16} />
            </button>
          </div>

          <div className="admin-sidebar-nav">
            {navGroups.map((group) => (
              <div className="admin-nav-group" key={group.label}>
                <p className="admin-nav-label">{group.label}</p>
                <ul className="admin-nav-list">
                  {group.items.map((item) => {
                    const active = isAdminNavActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="admin-nav-link"
                          data-active={active ? "true" : undefined}
                          aria-current={active ? "page" : undefined}
                        >
                          <AdminIcon name={item.icon} size={16} />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="admin-sidebar-foot">
            {session.organization ? (
              <div className="admin-company" title={`Empresa activa: ${session.organization.name}`}>
                <span className="admin-company-label">Empresa</span>
                <strong className="admin-company-name">{session.organization.name}</strong>
              </div>
            ) : null}
            <p className="admin-sidebar-note">Panel privado · LedBox</p>
          </div>
        </aside>

        {menuOpen ? (
          <button type="button" className="admin-sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />
        ) : null}

        <div className="admin-main">
          <header className="admin-topbar">
            <button
              type="button"
              className="admin-iconbtn admin-menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menú"
              aria-controls="admin-sidebar"
              aria-expanded={menuOpen}
              title="Abrir menú"
            >
              <AdminIcon name="menu" size={18} />
            </button>

            <div className="admin-topbar-title">
              <p className="admin-topbar-eyebrow">LedBox · Operación</p>
              <h1 className="admin-topbar-heading" title={title}>
                {title}
              </h1>
            </div>

            <div className="admin-topbar-tools">
              <AdminThemeToggle />
              <a
                className="admin-btn admin-hide-sm"
                href={publicConfig.siteUrl}
                target="_blank"
                rel="noreferrer"
                title="Abrir el sitio público en una pestaña nueva"
              >
                <AdminIcon name="external" size={15} />
                <span>Ver sitio</span>
              </a>
              {session.user ? (
                <div className="admin-user" title={`${session.user.name} · ${adminRoleLabel(session.user.role)}`}>
                  <span className="admin-avatar" aria-hidden="true">
                    {initials(session.user.name)}
                  </span>
                  <span className="admin-user-info">
                    <strong>{session.user.name}</strong>
                    <small>{adminRoleLabel(session.user.role)}</small>
                  </span>
                </div>
              ) : null}
              <button
                type="button"
                className="admin-iconbtn"
                onClick={logout}
                disabled={loggingOut}
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
              >
                <AdminIcon name="logout" size={16} />
              </button>
            </div>
          </header>

          {session.error ? (
            <div className="admin-session-error">
              <AdminErrorState message={session.error} onRetry={() => void loadSession()} />
            </div>
          ) : null}

          <main className="admin-main-body">{session.loading && !session.user ? <AdminLoadingRows rows={6} label="Cargando panel" /> : children}</main>
        </div>
      </div>
    </AdminSessionContext.Provider>
  );
}

/** Módulos con acceso restringido (mismo criterio que el API, ver `lib/admin-policy.ts`). */
export function AdminModuleGuard({ href, children }: { href: string; children: React.ReactNode }) {
  const { role, loading } = useAdminSession();
  if (loading) return <AdminLoadingRows rows={6} />;
  if (!adminModuleVisible(href, role)) {
    return <AdminEmpty icon="users" title="Acceso restringido" hint="Solo propietarios y administradores pueden ver este módulo." />;
  }
  return <>{children}</>;
}
