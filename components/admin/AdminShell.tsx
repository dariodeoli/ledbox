"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { adminModuleVisible, adminNavGroups, adminNavLabel, asAdminRole, isAdminNavActive } from "@/lib/admin-policy";
import {
  adminRoleLabel,
  formatCalendarDayShort,
  formatDayWhen,
  formatNumber,
  initials,
  notificationKindLabel,
  notificationLevelLabel,
  notificationTone,
} from "@/lib/admin-format";
import { publicConfig } from "@/lib/public-config";
import type {
  AdminNotification,
  AdminNotificationCounts,
  AdminOrganization,
  AdminRole,
  AdminSessionUser,
} from "@/lib/admin-types";
import { AdminIcon } from "./AdminIcons";
import { AdminBadge, AdminEmpty, AdminErrorState, AdminLoadingRows } from "./AdminUI";
import { AdminThemeToggle } from "./admin-theme";
import { redirectToLogin, useAdminResource } from "./use-admin-data";

export type AdminSessionState = {
  user: AdminSessionUser | null;
  role: AdminRole | null;
  organization: AdminOrganization | null;
  organizations: AdminOrganization[];
  /** Sesión de la demo pública (issue #14): el shell muestra el aviso de solo lectura. */
  demo: boolean;
  loading: boolean;
  error: string;
};

const AdminSessionContext = createContext<AdminSessionState>({
  user: null,
  role: null,
  organization: null,
  organizations: [],
  demo: false,
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
function pickSessionData(raw: unknown): { user: AdminSessionUser | null; organization: AdminOrganization | null; organizations: AdminOrganization[]; demo: boolean } {
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
  const demo = outer.demo === true || inner.demo === true;
  return { user, organization, organizations, demo };
}

/**
 * Entrada de la demo (issue #14): si el shell se monta en `/demo` sin sesión,
 * el 401 sale al endpoint que provisiona la sesión demo en vez del login.
 */
function isDemoEntryPath(): boolean {
  if (typeof window === "undefined") return false;
  const pathname = window.location.pathname;
  return pathname === "/demo" || pathname.startsWith("/demo/");
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AdminSessionState>({
    user: null,
    role: null,
    organization: null,
    organizations: [],
    demo: false,
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
        // En la entrada de la demo no hay sesión todavía: se pide al endpoint que la cree.
        if (isDemoEntryPath()) {
          window.location.assign("/api/demo/session?next=/demo");
          return;
        }
        redirectToLogin();
        return;
      }
      const raw = (await response.json().catch(() => null)) as unknown;
      const { user, organization, organizations, demo } = pickSessionData(raw);
      if (!response.ok || !user) {
        setSession((current) => ({ ...current, loading: false, error: "No pudimos cargar tu sesión." }));
        return;
      }
      const role = asAdminRole(user.role);
      setSession({ user: { ...user, role }, role, organization, organizations, demo, loading: false, error: "" });
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

  /** Sale de la demo: revoca la sesión demo, limpia la cookie y va al sitio. */
  const exitDemo = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/demo/session", { method: "DELETE" });
    } catch {
      // Aunque falle la limpieza, el visitante sale de la demo igual.
    } finally {
      window.location.assign(publicConfig.siteUrl);
    }
  }, []);

  async function logout() {
    if (session.demo) {
      await exitDemo();
      return;
    }
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
              <BrandMark className="admin-brand-mark" size={30} />
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
              {session.demo ? (
                <Link
                  className="admin-demo-chip"
                  href="/demo"
                  title="Estás en la demo de LedBox con datos simulados · Volver a la presentación"
                >
                  DEMO
                </Link>
              ) : null}
              <AdminNotificationBell />
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
                aria-label={session.demo ? "Salir de la demo" : "Cerrar sesión"}
                title={session.demo ? "Salir de la demo" : "Cerrar sesión"}
              >
                <AdminIcon name="logout" size={16} />
              </button>
            </div>
          </header>

          {session.demo ? (
            <div className="admin-demo-banner">
              <Link className="admin-demo-badge" href="/demo" title="Volver a la presentación de la demo">
                DEMO
              </Link>
              <p className="admin-demo-banner-text">
                <strong>Datos simulados</strong>
                <span>Recorré el panel completo con datos ficticios: la demo es de solo lectura y no toca datos reales.</span>
              </p>
              <button
                type="button"
                className="admin-btn admin-demo-exit"
                onClick={() => void exitDemo()}
                disabled={loggingOut}
                title="Salir de la demo y volver a ledbox.online"
              >
                <AdminIcon name="logout" size={14} />
                <span>Salir de la demo</span>
              </button>
            </div>
          ) : null}

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

// ── Avisos operativos (issue #10) ───────────────────────────────────────────

export type AdminNotificationFeed = {
  notifications: AdminNotification[];
  notificationCounts: AdminNotificationCounts;
};

const EMPTY_NOTIFICATION_COUNTS: AdminNotificationCounts = { overdue: 0, soon: 0, info: 0, total: 0 };

/**
 * Feed de avisos del panel (`GET /api/admin/notifications`): lectura para todos
 * los roles. Lo comparten la campana del topbar y el bloque del Resumen.
 */
export function useAdminNotifications() {
  return useAdminResource<AdminNotificationFeed>("/api/admin/notifications", (payload) => ({
    notifications: payload.notifications ?? [],
    notificationCounts: payload.notificationCounts ?? EMPTY_NOTIFICATION_COUNTS,
  }));
}

/** Aviso con enlace a su módulo; el nivel real define el tono y el borde. */
function AdminNotificationItem({ notification }: { notification: AdminNotification }) {
  const level = notificationLevelLabel(notification.level);
  const kind = notificationKindLabel(notification.kind);
  const when = `${formatCalendarDayShort(notification.date)} · ${formatDayWhen(notification.date)}`;
  return (
    <Link
      className="admin-notif-item"
      href={notification.href}
      data-level={notification.level}
      title={`${level} · ${kind}: ${notification.title}${notification.subtitle ? ` · ${notification.subtitle}` : ""} · ${when} · Ir a ${adminNavLabel(notification.href)}`}
    >
      <AdminBadge tone={notificationTone(notification.level)}>{level}</AdminBadge>
      <span className="admin-notif-main">
        <span className="admin-notif-title">{notification.title}</span>
        <span className="admin-notif-sub">
          {kind}
          {notification.subtitle ? ` · ${notification.subtitle}` : ""}
        </span>
      </span>
      <span className="admin-notif-date" title={when}>
        {when}
      </span>
      <AdminIcon name="arrow-right" size={14} />
    </Link>
  );
}

/**
 * Campana del topbar: contador de vencidos/próximos (sin avisos no dibuja
 * contador), panel desplegable con los avisos ordenados por urgencia y
 * navegación al módulo de cada uno. Cierra con Escape, al salir el foco y al
 * hacer clic afuera; al abrir refresca porque los avisos salen de datos vivos.
 */
function AdminNotificationBell() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const feed = useAdminNotifications();
  const notifications = feed.data?.notifications ?? [];
  const counts = feed.data?.notificationCounts ?? EMPTY_NOTIFICATION_COUNTS;
  const urgent = counts.overdue + counts.soon;

  // Al navegar desde un aviso el panel se cierra solo.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function closeOnOutside(event: PointerEvent) {
      const node = wrapRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    void feed.reload();
    setOpen(true);
  }

  return (
    <div
      className="admin-notif"
      ref={wrapRef}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="admin-iconbtn admin-notif-toggle"
        onClick={toggle}
        aria-label={urgent > 0 ? `Avisos: ${formatNumber(urgent)} vencidos o próximos` : "Avisos y recordatorios"}
        aria-expanded={open}
        aria-controls="admin-notif-panel"
        title="Avisos y recordatorios"
      >
        <AdminIcon name="bell" size={16} />
        {urgent > 0 ? (
          <span className="admin-notif-count" aria-hidden="true">
            {urgent > 99 ? "99+" : formatNumber(urgent)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="admin-notif-panel" id="admin-notif-panel" role="region" aria-label="Avisos y recordatorios">
          <header className="admin-notif-head">
            <strong>Avisos</strong>
            <span className="admin-notif-total">
              {counts.total > 0
                ? `${formatNumber(counts.overdue)} vencidos · ${formatNumber(counts.soon)} próximos`
                : "Sin pendientes"}
            </span>
          </header>
          {feed.loading && notifications.length === 0 ? (
            <AdminLoadingRows rows={3} label="Cargando avisos" />
          ) : feed.error ? (
            <AdminErrorState message={feed.error} onRetry={feed.reload} />
          ) : notifications.length === 0 ? (
            <AdminEmpty
              icon="check"
              title="Sin avisos"
              hint="No hay vencimientos, checklist pendiente ni cobros con saldo."
            />
          ) : (
            <ul className="admin-notif-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <AdminNotificationItem notification={notification} />
                </li>
              ))}
            </ul>
          )}
          {notifications.length > 0 && notifications.length < counts.total ? (
            <p className="admin-notif-note">
              Mostrando los primeros {formatNumber(notifications.length)} de {formatNumber(counts.total)} avisos; el resto vive en cada módulo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
