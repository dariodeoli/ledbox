"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppFooter } from "@/components/app-footer";
import { BrandMark } from "@/components/brand-mark";
import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import {
  adminModuleVisible,
  adminNavGroups,
  adminNavLabel,
  asAdminRole,
  canManageOrganization,
  canWriteFinance,
  isAdminNavActive,
} from "@/lib/admin-policy";
import {
  adminRoleLabel,
  formatCalendarDayShort,
  formatDayWhen,
  formatNumber,
  notificationKindLabel,
  notificationLevelLabel,
  notificationTone,
  paymentReminderMessage,
  statusTone,
  whatsappHref,
} from "@/lib/admin-format";
import { publicConfig } from "@/lib/public-config";
import { APP_VERSION_LABEL } from "@/lib/version";
import {
  adminAvatarUrl,
  organizationLogoUrl,
  type AdminNotification,
  type AdminNotificationCounts,
  type AdminOrganization,
  type AdminOrganizationLogos,
  type AdminRole,
  type AdminSessionLock,
  type AdminSessionUser,
} from "@/lib/admin-types";
import { AdminIcon } from "./AdminIcons";
import { AdminAvatar, AdminOrgLogo } from "./AdminAvatar";
import { AdminBadge, AdminEmpty, AdminErrorState, AdminLoadingRows, AdminLockScreen } from "./AdminUI";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { AdminMobileNav } from "./AdminMobileNav";
import { AdminModuleHelp } from "./AdminModuleHelp";
import { AdminThemeToggle } from "./admin-theme";
import { AdminOfflineBanner, AdminOfflineIndicator } from "./AdminOffline";
import { adminApiGet, adminSend, clearAdminApiCache, redirectToLogin, useAdminResource } from "@/lib/admin-api";

export type AdminSessionState = {
  user: AdminSessionUser | null;
  role: AdminRole | null;
  organization: AdminOrganization | null;
  organizations: AdminOrganization[];
  /** Sesión de la demo pública (issue #14): el shell muestra el aviso de solo lectura. */
  demo: boolean;
  /** Panel bloqueado por PIN (issue #21): se dibuja la pantalla de bloqueo y nada del panel detrás. */
  locked: boolean;
  /** Motivo del bloqueo vigente (para el texto de la pantalla). */
  lockReason: "inactivity" | "manual";
  /** Seguridad del usuario (PIN + preferencia de auto-bloqueo); `null` sin datos. */
  lock: AdminSessionLock | null;
  loading: boolean;
  error: string;
  /** Vuelve a leer la sesión (lo usan perfil y empresa al guardar cambios). */
  reload: () => void;
};

/** Datos de sesión que viven en el estado del shell; `reload` se agrega al contexto. */
type AdminSessionData = Omit<AdminSessionState, "reload">;

const EMPTY_SESSION: AdminSessionData = {
  user: null,
  role: null,
  organization: null,
  organizations: [],
  demo: false,
  locked: false,
  lockReason: "inactivity",
  lock: null,
  loading: true,
  error: "",
};

const AdminSessionContext = createContext<AdminSessionState>({
  ...EMPTY_SESSION,
  reload: () => {},
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
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    role: asAdminRole(value.role),
    // Avatar subido (issue #22): sin foto, el chip dibuja las iniciales.
    avatarUpdatedAt: typeof value.avatarUpdatedAt === "string" ? value.avatarUpdatedAt : null,
  };
}

/** Logos de la empresa por tema (issue #22); `null` en cada variante que falta. */
function asLogos(value: unknown): AdminOrganizationLogos | undefined {
  if (!isRecord(value)) return undefined;
  return {
    light: typeof value.light === "string" ? value.light : null,
    dark: typeof value.dark === "string" ? value.dark : null,
  };
}

function asOrganization(value: unknown): AdminOrganization | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    slug: typeof value.slug === "string" ? value.slug : null,
    role: typeof value.role === "string" ? value.role : null,
    logos: asLogos(value.logos),
  };
}

/** Seguridad del panel (issue #21): PIN configurado y preferencia de auto-bloqueo. */
function asLockInfo(value: unknown): AdminSessionLock | null {
  if (!isRecord(value)) return null;
  return {
    hasPin: value.hasPin === true,
    pinUpdatedAt: typeof value.pinUpdatedAt === "string" ? value.pinUpdatedAt : null,
    autoLockEnabled: value.autoLockEnabled !== false,
    autoLockMinutes:
      typeof value.autoLockMinutes === "number" && Number.isFinite(value.autoLockMinutes) && value.autoLockMinutes > 0
        ? value.autoLockMinutes
        : 10,
  };
}

/**
 * `GET /api/admin/session` devuelve hoy `{ user: { user, session } }` y va a pasar a
 * `{ user, organization, organizations[] }`. Se leen las dos formas.
 */
function pickSessionData(raw: unknown): {
  user: AdminSessionUser | null;
  organization: AdminOrganization | null;
  organizations: AdminOrganization[];
  demo: boolean;
  locked: boolean;
  lockReason: "inactivity" | "manual";
  lock: AdminSessionLock | null;
} {
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
  const lockReason = inner.lockReason === "manual" || outer.lockReason === "manual" ? "manual" : "inactivity";
  return {
    user,
    organization,
    organizations,
    demo,
    locked: outer.locked === true || inner.locked === true,
    lockReason,
    lock: asLockInfo(inner.lock) ?? asLockInfo(outer.lock),
  };
}

/**
 * Entrada de la demo (issue #14): si el shell se monta en `/demo` sin sesión,
 * el 401 sale al endpoint que provisiona la sesión demo en vez del login.
 *
 * Vale el path `/demo` (host público y desarrollo) y **cualquier ruta del host
 * de la demo** (`demo.ledbox.online`, issue #39): ahí el visitante entra por la
 * raíz o directo a un módulo compartido, y en ambos casos corresponde crear la
 * sesión demo en vez de mandarlo al login (bug del 22-09-2026).
 */
function isDemoEntryPath(): boolean {
  if (typeof window === "undefined") return false;
  const pathname = window.location.pathname;
  if (pathname === "/demo" || pathname.startsWith("/demo/")) return true;
  try {
    return window.location.hostname.toLowerCase() === new URL(publicConfig.demoUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AdminSessionData>(EMPTY_SESSION);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  // Bloqueo por PIN (issue #21): error/estado de la pantalla y canal entre pestañas.
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockRequireLogin, setLockRequireLogin] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockChannelRef = useRef<BroadcastChannel | null>(null);

  const loadSession = useCallback(async () => {
    setSession((current) => ({ ...current, loading: true, error: "" }));
    // Sesión por el cliente único: 401/403 invalidan la sesión (vuelve al login),
    // salvo en la entrada de la demo, donde se pide crear la sesión demo.
    const result = await adminApiGet<unknown>("/api/admin/session", {
      fresh: true,
      fallbackError: "No pudimos cargar tu sesión.",
      skipSessionRedirect: isDemoEntryPath(),
    });
    if (!result.ok) {
      if (result.sessionInvalid) {
        if (isDemoEntryPath()) {
          // Vuelve a la misma pantalla: sirve para la entrada y para un módulo
          // compartido de la demo (`demo.ledbox.online/finanzas`).
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.assign(`/api/demo/session?next=${encodeURIComponent(next)}`);
          return;
        }
        redirectToLogin();
        return;
      }
      setSession((current) => ({ ...current, loading: false, error: result.error }));
      return;
    }
    const { user, organization, organizations, demo, locked, lockReason, lock } = pickSessionData(result.data);
    if (!user) {
      setSession((current) => ({ ...current, loading: false, error: "No pudimos cargar tu sesión." }));
      return;
    }
    const role = asAdminRole(user.role);
    setSession({ user: { ...user, role }, role, organization, organizations, demo, locked, lockReason, lock, loading: false, error: "" });
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // El menú lateral se cierra al cambiar de pantalla: antes el drawer (y el
  // fondo oscuro del panel) quedaba abierto sobre la página nueva.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
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

  // Menú del chip de usuario: cierra con Escape y al hacer clic afuera.
  useEffect(() => {
    if (!userMenuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setUserMenuOpen(false);
    }
    function closeOnOutside(event: PointerEvent) {
      const node = userMenuRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setUserMenuOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [userMenuOpen]);

  // ── Bloqueo por PIN y auto-bloqueo por inactividad (issue #21) ──────────────
  const lockEligible = Boolean(session.user) && !session.demo && session.lock?.hasPin === true;
  const autoLockMinutes = session.lock?.autoLockMinutes ?? 10;
  const autoLockMs = lockEligible && session.lock?.autoLockEnabled ? Math.max(autoLockMinutes, 1) * 60_000 : 0;

  /** Bloquea el panel: la pantalla tapa todo y el servidor marca la sesión. */
  const lockPanel = useCallback(
    (reason: "inactivity" | "manual") => {
      if (!lockEligible || session.locked) return;
      setSession((current) => (current.locked ? current : { ...current, locked: true, lockReason: reason }));
      setLockError("");
      setLockRequireLogin(false);
      setMenuOpen(false);
      setUserMenuOpen(false);
      lockChannelRef.current?.postMessage({ type: "locked", reason });
      // Best-effort: si el aviso al servidor no llega, el bloqueo local sigue y el
      // desbloqueo igual valida el PIN contra el servidor.
      void fetch("/api/admin/session/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).catch(() => {});
    },
    [lockEligible, session.locked],
  );

  /** Desbloquea con PIN: valida el servidor y limpia la caché para recargar datos. */
  const unlockPanel = useCallback(async (pin: string) => {
    setLockBusy(true);
    setLockError("");
    try {
      const response = await fetch("/api/admin/session/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; requireLogin?: boolean };
      if (!response.ok) {
        setLockError(payload.error || "No pudimos validar el PIN.");
        if (payload.requireLogin) setLockRequireLogin(true);
        return;
      }
      clearAdminApiCache();
      lastActivityRef.current = Date.now();
      setSession((current) => ({ ...current, locked: false }));
      setLockError("");
      setLockRequireLogin(false);
      lockChannelRef.current?.postMessage({ type: "unlocked" });
    } catch {
      setLockError("No pudimos conectar con el panel. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setLockBusy(false);
    }
  }, []);

  /** Login completo: cierra la sesión (o lo que quede de ella) y va al login. */
  const fullLogin = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Aunque falle la limpieza, el camino al login sigue.
    }
    redirectToLogin();
  }, []);

  // Canal entre pestañas: bloquear o desbloquear en una se refleja en las demás.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("ledbox-admin-lock");
    lockChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; reason?: string } | null;
      if (data?.type === "locked") {
        setSession((current) =>
          current.user && !current.demo && !current.locked
            ? { ...current, locked: true, lockReason: data.reason === "manual" ? "manual" : "inactivity" }
            : current,
        );
      } else if (data?.type === "unlocked") {
        clearAdminApiCache();
        setLockError("");
        setLockRequireLogin(false);
        setSession((current) => (current.locked ? { ...current, locked: false } : current));
      }
    };
    return () => {
      channel.close();
      lockChannelRef.current = null;
    };
  }, []);

  // Un 423 de cualquier endpoint (otra pestaña bloqueó la sesión) trae el bloqueo acá.
  useEffect(() => {
    function onLocked() {
      setSession((current) =>
        current.user && !current.demo && !current.locked ? { ...current, locked: true, lockReason: "inactivity" } : current,
      );
    }
    window.addEventListener("ledbox:admin-locked", onLocked);
    return () => window.removeEventListener("ledbox:admin-locked", onLocked);
  }, []);

  // Temporizador de inactividad: reloj propio y control al volver de dormido
  // (visibilitychange/focus) para bloquear aunque la pestaña haya estado oculta.
  useEffect(() => {
    if (!autoLockMs || session.locked || session.loading) return;
    lastActivityRef.current = Date.now();
    let lastMark = 0;
    function markActivity() {
      const now = Date.now();
      if (now - lastMark < 1000) return;
      lastMark = now;
      lastActivityRef.current = now;
    }
    function checkActivity() {
      if (Date.now() - lastActivityRef.current >= autoLockMs) lockPanel("inactivity");
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current >= autoLockMs) lockPanel("inactivity");
      else lastActivityRef.current = Date.now();
    }
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const name of events) window.addEventListener(name, markActivity, { passive: true });
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(checkActivity, 10_000);
    return () => {
      for (const name of events) window.removeEventListener(name, markActivity);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [autoLockMs, session.locked, session.loading, lockPanel]);

  const navGroups = useMemo(() => adminNavGroups(session.role), [session.role]);
  const title = adminNavLabel(pathname);
  const canEditOrganization = canManageOrganization(session.role);
  const organizationLogos = session.organization?.logos;
  const sessionValue = useMemo<AdminSessionState>(
    () => ({ ...session, reload: () => void loadSession() }),
    [session, loadSession],
  );
  /**
   * Entrada a la demo: mientras no haya sesión, la campana de avisos no se monta
   * (su 401 manda al login y competiría con la creación de la sesión demo).
   */
  const demoEntryPending = session.loading && !session.user && (pathname === "/demo" || pathname.startsWith("/demo/"));

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

  // Con el panel bloqueado no se dibuja nada del shell: solo la pantalla de PIN.
  const showLock = Boolean(session.user) && session.locked && !session.demo;
  const lockAvatarSrc =
    session.user?.avatarUpdatedAt ? adminAvatarUrl(session.user.id, session.user.avatarUpdatedAt) : null;

  return (
    <AdminSessionContext.Provider value={sessionValue}>
      {showLock && session.user ? (
        <AdminLockScreen
          name={session.user.name}
          avatarSrc={lockAvatarSrc}
          autoLocked={session.lockReason === "inactivity"}
          error={lockError}
          busy={lockBusy}
          requireLogin={lockRequireLogin}
          onUnlock={unlockPanel}
          onFullLogin={() => void fullLogin()}
        />
      ) : (
      <div className="admin-shell">
        <aside id="admin-sidebar" className={menuOpen ? "admin-sidebar is-open" : "admin-sidebar"} aria-label="Módulos del panel">
          <div className="admin-sidebar-head">
            <Link href="/dashboard" className="admin-brand" aria-label="EventOS · Ir al resumen">
              <BrandMark className="admin-brand-mark" size={30} />
              <span>
                EventOS<span className="admin-brand-dot">.</span>
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
              canEditOrganization ? (
                <Link
                  className="admin-company"
                  href="/empresa"
                  title={`Empresa activa: ${session.organization.name} · Editar nombre y logos`}
                >
                  <span className="admin-company-label">Empresa</span>
                  <span className="admin-company-main">
                    <AdminOrgLogo
                      name={session.organization.name}
                      lightSrc={
                        organizationLogos?.light
                          ? organizationLogoUrl("light", organizationLogos.light)
                          : null
                      }
                      darkSrc={
                        organizationLogos?.dark ? organizationLogoUrl("dark", organizationLogos.dark) : null
                      }
                      size={22}
                    />
                    <strong className="admin-company-name">{session.organization.name}</strong>
                  </span>
                </Link>
              ) : (
                <div className="admin-company" title={`Empresa activa: ${session.organization.name}`}>
                  <span className="admin-company-label">Empresa</span>
                  <span className="admin-company-main">
                    <AdminOrgLogo
                      name={session.organization.name}
                      lightSrc={
                        organizationLogos?.light
                          ? organizationLogoUrl("light", organizationLogos.light)
                          : null
                      }
                      darkSrc={
                        organizationLogos?.dark ? organizationLogoUrl("dark", organizationLogos.dark) : null
                      }
                      size={22}
                    />
                    <strong className="admin-company-name">{session.organization.name}</strong>
                  </span>
                </div>
              )
            ) : null}
              {session.user ? (
                <div
                  className="admin-usermenu admin-usermenu--sidebar"
                  ref={userMenuRef}
                  onBlur={(event) => {
                    const next = event.relatedTarget;
                    if (next && !event.currentTarget.contains(next)) setUserMenuOpen(false);
                  }}
                >
                  <button
                    type="button"
                    className="admin-user admin-user--sidebar"
                    onClick={() => setUserMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={userMenuOpen}
                    aria-controls="admin-usermenu"
                    title={`${session.user.name} · ${adminRoleLabel(session.user.role)} · Tu cuenta`}
                  >
                    <AdminAvatar
                      name={session.user.name}
                      src={
                        session.user.avatarUpdatedAt
                          ? adminAvatarUrl(session.user.id, session.user.avatarUpdatedAt)
                          : null
                      }
                      size={28}
                    />
                    <span className="admin-user-info">
                      <strong>{session.user.name}</strong>
                      <small>{adminRoleLabel(session.user.role)}</small>
                    </span>
                    <AdminIcon name="chevron-down" size={14} />
                  </button>

                  {userMenuOpen ? (
                    <div className="admin-usermenu-panel" id="admin-usermenu" role="menu" aria-label="Tu cuenta">
                      <div className="admin-usermenu-head">
                        <strong>{session.user.name}</strong>
                        <small>{session.user.email}</small>
                        <AdminBadge tone={statusTone(session.user.role)}>{adminRoleLabel(session.user.role)}</AdminBadge>
                      </div>
                      <Link className="admin-usermenu-item" role="menuitem" href="/perfil">
                        <AdminIcon name="user" size={15} />
                        <span>Mi perfil</span>
                        <small>Nombre, contraseña, PIN y foto</small>
                      </Link>
                      {lockEligible ? (
                        <button
                          type="button"
                          className="admin-usermenu-item"
                          role="menuitem"
                          onClick={() => lockPanel("manual")}
                        >
                          <AdminIcon name="power" size={15} />
                          <span>Bloquear panel</span>
                          <small>Se reabre con tu PIN</small>
                        </button>
                      ) : null}
                      {canEditOrganization ? (
                        <Link className="admin-usermenu-item" role="menuitem" href="/empresa">
                          <AdminIcon name="building" size={15} />
                          <span>Empresa</span>
                          <small>Nombre y logos</small>
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        className="admin-usermenu-item"
                        role="menuitem"
                        onClick={() => void logout()}
                        disabled={loggingOut}
                      >
                        <AdminIcon name="logout" size={15} />
                        <span>{session.demo ? "Salir de la demo" : "Cerrar sesión"}</span>
                      </button>
                    </div>
                  ) : null}
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

            {/* Ayuda contextual del módulo (22-09-2026): junto al título, nunca
                compite con las acciones del topbar. */}
            <AdminModuleHelp />

            <div className="admin-topbar-tools">
              <AdminCommandPalette />
              {session.demo ? (
                <Link
                  className="admin-demo-chip"
                  href="/demo"
                  title="Estás en la demo de LedBox con datos simulados · Volver a la presentación"
                >
                  DEMO
                </Link>
              ) : null}
              {demoEntryPending ? null : <AdminNotificationBell />}
              <AdminOfflineIndicator />
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

          <AdminOfflineBanner />

          <main className="admin-main-body">{session.loading && !session.user ? <AdminLoadingRows rows={6} label="Cargando panel" /> : children}</main>

          <footer className="admin-main-foot">
            <AppFooter variant="app" className="app-footer--panel" />
          </footer>
        </div>

        {/* Barra inferior de mobile (≤720 px): cuatro módulos + «Más», que abre
            el drawer de siempre. En escritorio no se dibuja. */}
        <AdminMobileNav menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      </div>
      )}
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

/**
 * Aviso del feed. El cuerpo enlaza a su módulo; cuando el aviso trae los datos
 * de un cobro a plazo con teléfono (issue #19), suma la acción de WhatsApp con
 * el mensaje prellenado (monto, vencimiento y link del portal) y deja la
 * constancia del día en el historial del cobro. `VIEWER` nunca ve la acción.
 */
function AdminNotificationItem({ notification, writable }: { notification: AdminNotification; writable: boolean }) {
  const level = notificationLevelLabel(notification.level);
  const kind = notificationKindLabel(notification.kind);
  const when = `${formatCalendarDayShort(notification.date)} · ${formatDayWhen(notification.date)}`;
  const reminder = writable ? notification.reminder ?? null : null;
  const whatsappLink = reminder ? whatsappHref(reminder.phone, paymentReminderMessage(reminder)) : null;
  const paymentId = notification.id.startsWith("collection_due:")
    ? notification.id.slice("collection_due:".length)
    : "";
  const title = `${level} · ${kind}: ${notification.title}${notification.subtitle ? ` · ${notification.subtitle}` : ""} · ${when} · Ir a ${adminNavLabel(notification.href)}`;

  /** Best-effort: el mensaje se abre igual aunque el registro del día falle. */
  function rememberWhatsapp() {
    if (!paymentId) return;
    void adminSend("/api/admin/reminders", { paymentId, channel: "whatsapp" });
  }

  return (
    <div className="admin-notif-item" data-level={notification.level}>
      <AdminBadge tone={notificationTone(notification.level)}>{level}</AdminBadge>
      <Link className="admin-notif-main" href={notification.href} title={title}>
        <span className="admin-notif-title">{notification.title}</span>
        <span className="admin-notif-sub">
          {kind}
          {notification.subtitle ? ` · ${notification.subtitle}` : ""}
        </span>
      </Link>
      <span className="admin-notif-date" title={when}>
        {when}
      </span>
      {whatsappLink && reminder ? (
        <a
          className="admin-iconbtn"
          href={whatsappLink}
          target="_blank"
          rel="noreferrer"
          title={`Recordar por WhatsApp: ${reminder.client}`}
          aria-label={`Recordar por WhatsApp: ${reminder.client}`}
          onClick={rememberWhatsapp}
        >
          <WhatsappIcon size={15} />
        </a>
      ) : null}
      <AdminIcon name="arrow-right" size={14} />
    </div>
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
  const { role } = useAdminSession();
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
                  <AdminNotificationItem notification={notification} writable={canWriteFinance(role)} />
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
