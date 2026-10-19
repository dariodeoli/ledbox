"use client";
import { mountOverlay } from "@/lib/overlay-lifecycle";

import Link from "next/link";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import {
  adminModuleVisible,
  adminNavGroups,
  adminNavIcon,
  adminNavLabel,
  asAdminRole,
  canManageOrganization,
  canWriteFinance,
  isAdminNavItemActive,
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
  isWhatsappSandbox,
  whatsappHref,
  whatsappReachable,
  setWhatsappSandbox,
} from "@/lib/admin-format";
import { publicConfig, setPortalSandbox } from "@/lib/public-config";
import { ADMIN_NAV_GROUP_KEY, ADMIN_ROOT_ID, readStoredPinDigits, storePinDigits } from "@/lib/admin-theme";
import {
  adminAvatarUrl,
  organizationLogoUrl,
  type AdminNavCounts,
  type AdminNotification,
  type AdminNotificationCounts,
  type AdminOrganization,
  type AdminOrganizationLogos,
  type AdminRole,
  type AdminSessionLock,
  type AdminSessionPayload,
  type AdminSessionUser,
} from "@/lib/admin-types";
import { AdminIcon } from "./AdminIcons";
import { AdminSandboxStrip } from "./AdminSandboxStrip";
import { AdminAvatar, AdminOrgLogo } from "./AdminAvatar";
import { AdminButtonLink, AdminBadge, AdminEmpty, AdminErrorState, AdminLoadingRows, AdminLockScreen, AdminSimulatedMessageDialog, AdminIconButton, AdminIconLink } from "./AdminUI";
/**
 * Paleta del buscador (issue #67): llega diferida. Su código no entra en el
 * arranque del panel; con el shell ocioso se prefetchea el chunk para que la
 * primera apertura sea instantánea. El botón y el atajo viven acá abajo.
 */
const AdminCommandPalette = dynamic(() => import("./AdminCommandPalette").then((mod) => mod.AdminCommandPalette), {
  ssr: false,
});
import { AdminMobileNav } from "./AdminMobileNav";
import { AdminModuleHelp } from "./AdminModuleHelp";
import { AdminThemeToggle, AdminSidebarToggle, useAdminSidebar } from "./admin-theme";
import { AdminOfflineBanner, AdminOfflineIndicator } from "./AdminOffline";
import { adminApiGet, adminSend, clearAdminApiCache, redirectToLogin, useAdminResource } from "@/lib/admin-api";

export type AdminSessionState = {
  user: AdminSessionUser | null;
  role: AdminRole | null;
  organization: AdminOrganization | null;
  organizations: AdminOrganization[];
  /** Sesión de la demo pública (issue #14): el shell muestra el aviso de solo lectura. */
  demo: boolean;
  /** Sandbox por visitante de la demo: escribe, pero nada sale hacia afuera (sin links de WhatsApp). */
  sandbox?: boolean;
  /** Solo en una sandbox: último uso y tope de 24 h (ISO) para la hora límite de la franja. */
  demoLastSeenAt?: string | null;
  demoExpiresAt?: string | null;
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
  /** Bloqueo por PIN disponible para este usuario (issue #21). */
  lockEligible: boolean;
  /** Bloquea el panel a pedido del usuario (lo usa Mi perfil, issue #117). */
  lockPanel: (reason: "inactivity" | "manual") => void;
  /** Cierra la sesión (o sale de la demo). */
  logout: () => Promise<void>;
  /** Hay un cierre de sesión en curso. */
  loggingOut: boolean;
};

/** Datos de sesión del shell; `reload` y las acciones de cuenta se agregan al contexto. */
type AdminSessionData = Omit<AdminSessionState, "reload" | "lockEligible" | "lockPanel" | "logout" | "loggingOut">;

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
  lockEligible: false,
  lockPanel: () => {},
  logout: async () => {},
  loggingOut: false,
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

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value && Number.isFinite(new Date(value).getTime()) ? value : null;
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
  sandbox: boolean;
  demoLastSeenAt: string | null;
  demoExpiresAt: string | null;
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
    sandbox: outer.sandbox === true || inner.sandbox === true,
    demoLastSeenAt: asIsoString(inner.demoLastSeenAt) ?? asIsoString(outer.demoLastSeenAt),
    demoExpiresAt: asIsoString(inner.demoExpiresAt) ?? asIsoString(outer.demoExpiresAt),
    locked: outer.locked === true || inner.locked === true,
    lockReason,
    lock: asLockInfo(inner.lock) ?? asLockInfo(outer.lock),
  };
}

/**
 * Datos de sesión del payload que embebe el layout (issue #61). Usa el mismo
 * parser que la respuesta del API, así los dos caminos no divergen.
 */
function sessionDataFromPayload(payload: AdminSessionPayload): AdminSessionData {
  const { user, organization, organizations, demo, sandbox, demoLastSeenAt, demoExpiresAt, locked, lockReason, lock } = pickSessionData(payload);
  const role = user ? asAdminRole(user.role) : null;
  setWhatsappSandbox(sandbox);
  setPortalSandbox(sandbox);
  return {
    user: user ? { ...user, role: role ?? user.role } : null,
    role,
    organization,
    organizations,
    demo,
    sandbox,
    demoLastSeenAt,
    demoExpiresAt,
    locked,
    lockReason,
    lock,
    loading: false,
    error: user ? "" : "No pudimos cargar tu sesión.",
  };
}

/**
 * Entrada de la demo (issue #14): si el shell se monta en `/demo` sin sesión,
 * el 401 sale al endpoint que provisiona la sesión demo en vez del login.
 *
 * Vale el path `/demo` (host público y desarrollo) y **cualquier ruta del host
 * de la demo** (`demo.ledbox.online`, issue #39): ahí el visitante entra por la
 * raíz (servida con rewrite, sin `/demo`, issue #53) o directo a un módulo
 * compartido, y en ambos casos corresponde crear la sesión demo en vez de
 * mandarlo al login (bug del 22-09-2026).
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

/**
 * Grupo abierto del acordeón del nav (issue #50): la elección manual se guarda
 * por usuario y, sin preferencia, manda el grupo de la ruta activa.
 */
/**
 * Caja «Empresa» del menú lateral. Con más de una empresa es un botón que abre la lista
 * para cambiar de empresa (fuera de la demo); con una sola, lleva a Ajustes → Empresa.
 */
function AdminCompanySwitcher({
  session,
  canEditOrganization,
  logo,
  onSwitch,
}: {
  session: Pick<AdminSessionState, "organization" | "organizations" | "demo" | "sandbox">;
  canEditOrganization: boolean;
  logo: React.ReactNode;
  onSwitch: (organizationId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = session.organization;
  const canSwitch = !session.demo && !session.sandbox && session.organizations.length > 1;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const entries = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled):not([aria-disabled="true"]), [role="menuitem"]:not(:disabled):not([aria-disabled="true"])') ?? []);
    const initial = entries();
    (initial.find((entry) => entry.getAttribute("aria-checked") === "true") ?? initial[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      // Tab mantiene el desplazamiento nativo fuera del menú, sin atrapar el foco.
      if (event.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = entries();
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;
  const body = (
    <>
      <span className="admin-company-label">Empresa</span>
      <span className="admin-company-main">
        {logo}
        <strong className="admin-company-name">{active.name}</strong>
        {canSwitch ? <AdminIcon name="chevron-down" size={14} /> : null}
      </span>
    </>
  );

  if (!canSwitch) {
    return canEditOrganization ? (
      <Link className="admin-company" href="/ajustes/empresa" title={`Empresa activa: ${active.name} · Editar nombre y logos`}>
        {body}
      </Link>
    ) : (
      <div className="admin-company" title={`Empresa activa: ${active.name}`}>{body}</div>
    );
  }

  return (
    <div className="admin-company-switcher" ref={rootRef}>
      <button
        type="button"
        className="admin-company"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Empresa activa: ${active.name}. Cambiar de empresa`}
        data-open={open ? "true" : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}
      >
        {body}
      </button>
      {open ? (
        <div ref={menuRef} className="admin-company-menu" role="menu" aria-label="Cambiar de empresa">
          <span className="admin-company-menu-title">Tus empresas</span>
          {session.organizations.map((org) => {
            const current = org.id === active.id;
            return (
              <button
                key={org.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className="admin-company-menu-item"
                onClick={() => {
                  setOpen(false);
                  if (!current) void onSwitch(org.id);
                }}
              >
                <span className="admin-company-menu-name">{org.name}</span>
                {current ? <AdminIcon name="check" size={14} /> : null}
              </button>
            );
          })}
          {canEditOrganization ? (
            <Link className="admin-company-menu-item admin-company-menu-edit" role="menuitem" href="/ajustes/empresa" onClick={() => setOpen(false)}>
              <AdminIcon name="settings" size={14} />
              <span className="admin-company-menu-name">Ajustes de la empresa</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function readStoredNavGroup(): string | null {
  try {
    return window.localStorage.getItem(ADMIN_NAV_GROUP_KEY);
  } catch {
    return null;
  }
}

function storeNavGroup(label: string | null): void {
  try {
    if (label) window.localStorage.setItem(ADMIN_NAV_GROUP_KEY, label);
    else window.localStorage.removeItem(ADMIN_NAV_GROUP_KEY);
  } catch {
    /* almacenamiento no disponible: el acordeón vale para esta vista */
  }
}

/** Mide antes del pintado en el navegador; en el render del servidor no hay DOM. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AdminShell({
  children,
  demoHost = false,
  initialSession = null,
}: {
  children: React.ReactNode;
  demoHost?: boolean;
  /** Sesión resuelta en el servidor (issue #61); sin ella el shell la pide al entrar. */
  initialSession?: AdminSessionPayload | null;
}) {
  const pathname = usePathname();
  const sidebar = useAdminSidebar(pathname);
  const router = useRouter();
  const [session, setSession] = useState<AdminSessionData>(() =>
    initialSession ? sessionDataFromPayload(initialSession) : EMPTY_SESSION,
  );
  /** La sesión embebida se consume una vez: después manda `loadSession`. */
  const skipInitialLoadRef = useRef(Boolean(initialSession));
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const menuOpenerRef = useRef<HTMLElement | null>(null);
  const openMenu = useCallback((opener: HTMLButtonElement) => {
    menuOpenerRef.current = opener;
    setMenuOpen(true);
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Bloqueo por PIN (issue #21): error/estado de la pantalla y canal entre pestañas.
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockRequireLogin, setLockRequireLogin] = useState(false);
  /**
   * Largo del PIN aprendido en este navegador (issue #54): solo la cantidad de
   * dígitos del último desbloqueo correcto, para enviarlo exacto sin pausa.
   */
  const [pinDigits, setPinDigits] = useState<number | null>(null);
  useEffect(() => {
    setPinDigits(session.user ? readStoredPinDigits(session.user.id) : null);
  }, [session.user]);
  /**
   * En el host de la demo la presentación es la raíz `/` (issue #53: rewrite sin
   * segmento visible); en el resto de los hosts sigue siendo la ruta `/demo`.
   * El servidor ya sabe en qué host está (`demoHost`, issue #58): se usa desde el
   * primer render para que el chip nunca apunte a `/demo` en la URL limpia (el
   * chequeo del navegador queda como respaldo).
   */
  const [demoHome, setDemoHome] = useState(demoHost ? "/" : "/demo");
  useEffect(() => {
    try {
      if (window.location.hostname.toLowerCase() === new URL(publicConfig.demoUrl).hostname.toLowerCase()) setDemoHome("/");
    } catch {
      /* se queda en `/demo` */
    }
  }, []);
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
      // Sin sesión confirmada, los links nunca quedan apuntando a la demo.
      setWhatsappSandbox(false);
      setPortalSandbox(false);
      setSession((current) => ({ ...current, loading: false, error: result.error }));
      return;
    }
    const { user, organization, organizations, demo, sandbox, demoLastSeenAt, demoExpiresAt, locked, lockReason, lock } = pickSessionData(result.data);
    setWhatsappSandbox(sandbox);
    setPortalSandbox(sandbox);
    if (!user) {
      setSession((current) => ({ ...current, loading: false, error: "No pudimos cargar tu sesión." }));
      return;
    }
    const role = asAdminRole(user.role);
    setSession({ user: { ...user, role }, role, organization, organizations, demo, sandbox, demoLastSeenAt, demoExpiresAt, locked, lockReason, lock, loading: false, error: "" });
  }, []);

  useEffect(() => {
    // Con la sesión embebida (issue #61) no hay pedido al entrar: el shell ya
    // tiene los datos; `reload()` sigue refrescando a demanda tras un cambio.
    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      return;
    }
    void loadSession();
  }, [loadSession]);

  /** Abre la paleta: monta el componente diferido y lo deja abierto. */
  const openPalette = useCallback(() => {
    setPaletteMounted(true);
    setPaletteOpen(true);
  }, []);

  // Atajo global del panel (⌘/Ctrl + K): vive acá porque la paleta llega diferida.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || menuOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      openPalette();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openPalette, menuOpen]);

  // Prefetch ocioso de los chunks diferidos: la primera apertura no espera la red.
  useEffect(() => {
    const load = () => {
      void import("./AdminCommandPalette");
    };
    const idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(load, { timeout: 4000 }) : window.setTimeout(load, 2500);
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  // El menú lateral se cierra al cambiar de pantalla: antes el drawer (y el
  // fondo oscuro del panel) quedaba abierto sobre la página nueva.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    if (!sidebarRef.current) return;
    const sidebar = sidebarRef.current;
    const desktop = window.matchMedia("(min-width: 981px)");
    if (desktop.matches) { setMenuOpen(false); return; }
    const release = mountOverlay(sidebar, { opener: menuOpenerRef.current, fallbackFocus: () => sidebar.querySelector<HTMLElement>(".admin-brand"), initialFocus: () => sidebar.querySelector<HTMLElement>(".admin-sidebar-close"), onClose: () => setMenuOpen(false), backdrop: ".admin-sidebar-backdrop" });
    const onResize = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener("change", onResize);
    return () => { desktop.removeEventListener("change", onResize); release(); };
  }, [menuOpen]);

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
        // El largo aprendido puede estar viejo (el PIN cambió de 4 a 6): se
        // olvida y el próximo intento vuelve a la pausa (issue #54).
        storePinDigits(session.user?.id, null);
        setPinDigits(null);
        setLockError(payload.error || "No pudimos validar el PIN.");
        if (payload.requireLogin) setLockRequireLogin(true);
        return;
      }
      // Desbloqueo correcto: queda aprendido el largo para enviar exacto la próxima.
      storePinDigits(session.user?.id, pin.length);
      setPinDigits(pin.length);
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
  }, [session.user?.id]);

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

  // ── Nav denso (issue #50) ──────────────────────────────────────────────────
  // La densidad la pone el CSS por altura de la ventana; acá se decide la forma:
  // todo abierto si entra y, si no, acordeón con un grupo por vez. El scroll del
  // nav queda como último recurso en alturas extremas.
  const activeNavGroup = useMemo(
    () =>
      // Los grupos sueltos (Inicio, Clientes) no son acordeón: no se "abren".
      navGroups.find((group) => !group.bare && group.items.some((item) => isAdminNavItemActive(pathname, item)))?.label ??
      navGroups.find((group) => !group.bare)?.label ??
      null,
    [navGroups, pathname],
  );
  const navRef = useRef<HTMLDivElement | null>(null);
  const navNaturalHeightRef = useRef(0);
  const navAccordionRef = useRef(false);
  const [navAccordion, setNavAccordion] = useState(false);
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);

  useIsomorphicLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      // Con el nav completo se cachea su alto natural: en acordeón el contenido
      // se achica y la comparación tiene que ser contra el alto real, no el actual.
      if (!navAccordionRef.current) navNaturalHeightRef.current = nav.scrollHeight;
      const natural = navNaturalHeightRef.current;
      const available = nav.clientHeight;
      if (natural > 0 && available > 0) setNavAccordion(natural > available + 2);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [navGroups]);

  useEffect(() => {
    navAccordionRef.current = navAccordion;
  }, [navAccordion]);

  // Grupo abierto: la preferencia guardada manda; si el rol actual no la tiene,
  // abre el de la ruta activa. Al navegar, el grupo activo se abre para no
  // perder de vista dónde se está.
  useEffect(() => {
    setOpenNavGroup((current) => {
      const stored = current ?? readStoredNavGroup();
      if (stored && navGroups.some((group) => group.label === stored)) return stored;
      return activeNavGroup;
    });
  }, [activeNavGroup, navGroups]);

  const toggleNavGroup = useCallback((label: string) => {
    setOpenNavGroup((current) => {
      const next = current === label ? null : label;
      storeNavGroup(next);
      return next;
    });
  }, []);

  const title = adminNavLabel(pathname);
  // Eyebrow del topbar: la empresa activa (LedBox, LedBox Demo…) y el área del
  // módulo según el agrupamiento nuevo; antes era «LedBox · Operación» fijo,
  // que no cambiaba en la demo ni en otra empresa.
  const activeGroupLabel = navGroups.find((group) =>
    group.items.some((item) => isAdminNavItemActive(pathname, item)),
  )?.label;
  const eyebrow = [session.organization?.name ?? "EventOS", activeGroupLabel].filter(Boolean).join(" · ");
  const moduleIcon = adminNavIcon(pathname);
  const canEditOrganization = canManageOrganization(session.role);
  const organizationLogos = session.organization?.logos;
  /**
   * Entrada a la demo: mientras no haya sesión, la campana de avisos no se monta
   * (su 401 manda al login y competiría con la creación de la sesión demo). En el
   * host de la demo vale cualquier ruta, incluida `/` (rewrite, issue #53).
   */
  const demoEntryPending =
    session.loading && !session.user && (demoHost || pathname === "/demo" || pathname.startsWith("/demo/"));

  /**
   * Contadores de Ventas en el menú (`/api/admin/nav-counts`, tres `count` baratos):
   * se piden con sesión activa y se refrescan al cambiar de pantalla. Si el dato
   * no llega, el ítem no dibuja contador (nada inventado).
   */
  const navCounts = useAdminResource<AdminNavCounts | null>(
    "/api/admin/nav-counts",
    (payload) => (payload as { navCounts?: AdminNavCounts }).navCounts ?? null,
    { enabled: Boolean(session.user) && !session.locked && !demoEntryPending },
  );
  const reloadNavCounts = navCounts.reload;
  const navCountsFirstRun = useRef(true);
  useEffect(() => {
    if (navCountsFirstRun.current) {
      navCountsFirstRun.current = false;
      return;
    }
    if (session.user && !session.locked) reloadNavCounts();
  }, [pathname, reloadNavCounts, session.user, session.locked]);

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

  const switchOrganization = useCallback(async (organizationId: string) => {
    const response = await fetch("/api/admin/session", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    // La empresa activa cambia en la sesión: se recarga el panel para que todo lea la empresa nueva.
    if (response.ok) window.location.assign("/dashboard");
  }, []);

  const logout = useCallback(async () => {
    if (session.demo || session.sandbox) {
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
  }, [session.demo, session.sandbox, exitDemo, router]);

  const sessionValue = useMemo<AdminSessionState>(
    () => ({ ...session, reload: () => void loadSession(), lockEligible, lockPanel, logout, loggingOut }),
    [session, loadSession, lockEligible, lockPanel, logout, loggingOut],
  );

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
          pinDigits={pinDigits}
          onUnlock={unlockPanel}
          onFullLogin={() => void fullLogin()}
        />
      ) : (
      <div className="admin-shell">
        <a className="admin-skip-link" href="#admin-main-content">Saltar al contenido</a>
        <aside ref={sidebarRef} id="admin-sidebar" className={menuOpen ? "admin-sidebar is-open" : "admin-sidebar"} aria-label="Módulos del panel" role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen || undefined} tabIndex={menuOpen ? -1 : undefined}>
          <div className="admin-sidebar-head">
            <Link href="/dashboard" className="admin-brand" aria-label="EventOS · Ir al resumen" title="EventOS · Ir al resumen">
              <BrandMark className="admin-brand-mark" size={30} />
              <span className="admin-brand-text">
                EventOS<span className="admin-brand-dot">.</span>
              </span>
            </Link>
            <AdminSidebarToggle mode={sidebar.mode} onToggle={sidebar.toggle} />
            <AdminIconButton icon="close" iconSize={16} label="Cerrar menú" className="admin-sidebar-close" onClick={() => setMenuOpen(false)} />
          </div>

          <div className="admin-sidebar-nav" ref={navRef}>
            {navGroups.filter(group => !group.docked).map((group, index) => {
              const accordion = navAccordion && !group.bare && sidebar.mode !== "collapsed";
              const groupOpen = !accordion || openNavGroup === group.label;
              const listId = `admin-nav-group-${index}`;
              return (
                <div className="admin-nav-group" key={group.label} data-bare={group.bare ? "true" : undefined}>
                  {group.bare ? null : accordion ? (
                    <button
                      type="button"
                      className="admin-nav-label admin-nav-toggle"
                      aria-expanded={groupOpen}
                      aria-controls={listId}
                      onClick={() => toggleNavGroup(group.label)}
                      title={`${groupOpen ? "Ocultar" : "Mostrar"} ${group.label} en el menú`}
                    >
                      <span>{group.label}</span>
                      <AdminIcon name="chevron-down" size={13} />
                    </button>
                  ) : (
                    <p className="admin-nav-label">{group.label}</p>
                  )}
                  <ul
                    className="admin-nav-list"
                    id={listId}
                    hidden={!groupOpen}
                    data-flow={group.flow ? "true" : undefined}
                    aria-label={group.flow ? `${group.label}: del primer contacto al evento` : undefined}
                  >
                    {group.items.map((item) => {
                      const active = isAdminNavItemActive(pathname, item);
                      const count = item.countKey ? navCounts.data?.[item.countKey] : undefined;
                      const hasCount = typeof count === "number" && count > 0;
                      const countText = hasCount ? `${item.countHint ?? "pendientes"}: ${formatNumber(count)}` : null;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={(event) => { if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) sidebar.navigate(item.href); }}
                            className="admin-nav-link"
                            data-active={active ? "true" : undefined}
                            aria-current={active ? "page" : undefined}
                            title={countText ? `${item.label} · ${countText}` : item.label}
                            aria-label={countText ? `${item.label}, ${countText}` : item.label}
                          >
                            <AdminIcon name={item.icon} size={16} />
                            <span className="admin-nav-text">{item.label}</span>
                            {hasCount ? (
                              <span className="admin-nav-count" aria-hidden="true">
                                {count > 99 ? "99+" : formatNumber(count)}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="admin-sidebar-foot">
            {navGroups.filter(group => group.docked).flatMap(group => group.items).map(item => {
              const active = isAdminNavItemActive(pathname, item);
              return (
                <Link key={item.href} href={item.href} className="admin-nav-link" title={item.label} aria-label={item.label}
                  aria-current={active ? "page" : undefined} data-active={active ? "true" : undefined}
                  onClick={(event) => { if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) sidebar.navigate(item.href); }}>
                  <AdminIcon name={item.icon} size={16} />
                  <span className="admin-nav-text">{item.label}</span>
                </Link>
              );
            })}
            {session.organization ? (
              <AdminCompanySwitcher
                session={session}
                canEditOrganization={canEditOrganization}
                logo={
                  <AdminOrgLogo
                    name={session.organization.name}
                    lightSrc={organizationLogos?.light ? organizationLogoUrl("light", organizationLogos.light) : null}
                    darkSrc={organizationLogos?.dark ? organizationLogoUrl("dark", organizationLogos.dark) : null}
                    size={32}
                  />
                }
                onSwitch={switchOrganization}
              />
            ) : null}
              {session.user ? (
                /* El chip es un enlace directo: la cuenta vive en Mi perfil (issue #117). */
                <Link
                  className="admin-user admin-user--sidebar"
                  href="/perfil"
                  aria-label={`Mi perfil · ${session.user.name}`}
                  title={`${session.user.name} · ${adminRoleLabel(session.user.role)} · Editar mi perfil`}
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
                </Link>
              ) : null}

            {session.user ? (
              <button
                type="button"
                className="admin-nav-link admin-sidebar-logout"
                onClick={() => void logout()}
                disabled={loggingOut}
                title={session.demo || session.sandbox ? "Salir de la demo y volver a ledbox.online" : "Cerrar sesión"}
                aria-label={session.demo || session.sandbox ? "Salir de la demo" : "Cerrar sesión"}
              >
                <AdminIcon name="logout" size={16} />
                <span className="admin-nav-text">{loggingOut ? "Saliendo…" : session.demo || session.sandbox ? "Salir de la demo" : "Cerrar sesión"}</span>
              </button>
            ) : null}
            <p className="admin-sidebar-note">Panel privado · LedBox</p>
          </div>
        </aside>

        {menuOpen ? (
          <button type="button" className="admin-sidebar-backdrop" onClick={() => setMenuOpen(false)} tabIndex={-1} aria-hidden="true" aria-label="Cerrar menú" />
        ) : null}

        <div className="admin-main">
          <header className="admin-topbar">
            <AdminIconButton icon="menu" iconSize={18} label="Abrir menú" className="admin-menu-btn" onClick={(event) => openMenu(event.currentTarget)} aria-controls="admin-sidebar" aria-expanded={menuOpen} />

            <div className="admin-topbar-title">
              <p className="admin-topbar-eyebrow">{eyebrow}</p>
              <h1 className="admin-topbar-heading" title={title}>
                <span className="admin-topbar-icon" aria-hidden="true">
                  <AdminIcon name={moduleIcon} size={15} />
                </span>
                {title}
              </h1>
            </div>

            {/* Ayuda contextual del módulo (22-09-2026): junto al título, nunca
                compite con las acciones del topbar. */}
            <AdminModuleHelp />

            <div className="admin-topbar-tools">
              <button
                type="button"
                className="admin-searchbtn"
                onClick={openPalette}
                aria-label="Buscar en el panel"
                aria-haspopup="dialog"
                title="Buscar en el panel · Ctrl/⌘ + K"
              >
                <AdminIcon name="search" size={15} />
                <span className="admin-searchbtn-label">Buscar</span>
                <kbd className="admin-searchbtn-key" aria-hidden="true">
                  ⌘K
                </kbd>
              </button>
              {paletteMounted ? <AdminCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} /> : null}
              {session.demo ? (
                <Link
                  className="admin-demo-chip"
                  href={demoHome}
                  title="Estás en la demo de EventOS · datos simulados y solo lectura · Volver a la presentación"
                >
                  DEMO
                </Link>
              ) : null}
              {demoEntryPending ? null : <AdminNotificationBell />}
              <AdminOfflineIndicator />
              <AdminThemeToggle />
              <AdminButtonLink
                className="admin-hide-sm"
                href={session.organization?.slug ? `${publicConfig.storeUrl}/tienda/${session.organization.slug}` : publicConfig.siteUrl}
                target="_blank"
                rel="noreferrer"
                title={session.organization?.slug ? `Abrir la tienda de ${session.organization.name} en una pestaña nueva` : "Abrir el sitio público en una pestaña nueva"}
               icon="external">{session.organization?.slug ? "Ver mi tienda" : "Ver sitio"}</AdminButtonLink>
            </div>
          </header>

          {session.sandbox ? (
            <AdminSandboxStrip
              lastSeenAt={session.demoLastSeenAt}
              expiresAt={session.demoExpiresAt}
              onExit={() => void exitDemo()}
              exiting={loggingOut}
            />
          ) : null}

          {session.demo ? (
            <div className="admin-demo-strip" role="status">
              <p className="admin-demo-strip-text" title="Demo de EventOS: es de solo lectura y no toca información real. Lo que simules en el portal del cliente vive solo en tu pestaña.">
                <strong>DEMO</strong> · Datos de ejemplo: no se guarda nada
              </p>
              <div className="admin-demo-strip-links">
                <Link
                  className="admin-demo-strip-link"
                  href={`${demoHome}?recorrido=1`}
                  title="Abrir la bienvenida y el recorrido guiado de la demo"
                >
                  Recorrido guiado
                </Link>
                <button
                  type="button"
                  className="admin-demo-strip-link"
                  onClick={() => void exitDemo()}
                  disabled={loggingOut}
                  title="Salir de la demo y volver a ledbox.online"
                >
                  Salir
                </button>
              </div>
            </div>
          ) : null}

          {session.error ? (
            <div className="admin-session-error">
              <AdminErrorState message={session.error} onRetry={() => void loadSession()} />
            </div>
          ) : null}

          <AdminOfflineBanner />

          <main id="admin-main-content" className="admin-main-body">{session.loading && !session.user ? <AdminLoadingRows rows={6} label="Cargando panel" /> : children}</main>

        </div>

        {/* Barra inferior de mobile (≤720 px): cuatro módulos + «Más», que abre
            el drawer de siempre. En escritorio no se dibuja. */}
        <AdminMobileNav menuOpen={menuOpen} onOpenMenu={openMenu} />
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
  // Demo: sin wa.me, el aviso muestra «Así se vería el mensaje».
  const [simulating, setSimulating] = useState(false);
  const simulatedMessage = reminder && !whatsappLink && isWhatsappSandbox() && whatsappReachable(reminder.phone) ? paymentReminderMessage(reminder) : null;
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
        <AdminIconLink
          href={whatsappLink}
          external
          iconNode={<WhatsappIcon size={15} />}
          label={`Recordar por WhatsApp: ${reminder.client}`}
          onClick={rememberWhatsapp}
        />
      ) : null}
      {simulatedMessage && reminder ? (
        <>
          <AdminIconButton
            iconNode={<WhatsappIcon size={15} />}
            label={`Ver cómo se vería el recordatorio por WhatsApp: ${reminder.client}`}
            onClick={() => {
              setSimulating(true);
              rememberWhatsapp();
            }}
          />
          {simulating ? <AdminSimulatedMessageDialog to={reminder.client} message={simulatedMessage} onClose={() => setSimulating(false)} /> : null}
        </>
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
 *
 * El panel se monta con `createPortal` en `#admin-root` (issue #150): dentro del
 * topbar —que tiene `backdrop-filter`— quedaba anclado a la barra y el vidrio del
 * panel no muestreaba la página, así que el contenido se transparentaba y el
 * aviso se volvía ilegible en móvil. El ancla sale de medir la campana y viaja
 * por variables CSS; en ≤560 px el panel ocupa el ancho de la pantalla.
 */
function AdminNotificationBell() {
  const pathname = usePathname();
  const { role } = useAdminSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusOnMountRef = useRef(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const feed = useAdminNotifications();
  const notifications = feed.data?.notifications ?? [];
  const counts = feed.data?.notificationCounts ?? EMPTY_NOTIFICATION_COUNTS;
  const urgent = counts.overdue + counts.soon;

  // Al navegar desde un aviso el panel se cierra solo.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const measureAnchor = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
  }, []);

  // Antes del pintado: el portal queda bajo la campana y el foco entra al panel.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      focusOnMountRef.current = false;
      return;
    }
    measureAnchor();
    window.addEventListener("resize", measureAnchor);
    return () => window.removeEventListener("resize", measureAnchor);
  }, [open, measureAnchor]);

  useEffect(() => {
    if (!open) return;
    function inside(target: EventTarget | null): boolean {
      return (
        target instanceof Node &&
        (Boolean(wrapRef.current?.contains(target)) || Boolean(panelRef.current?.contains(target)))
      );
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function closeOnOutside(event: PointerEvent) {
      if (!inside(event.target)) setOpen(false);
    }
    function closeOnFocusAway(event: FocusEvent) {
      if (!inside(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnFocusAway);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnFocusAway);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    focusOnMountRef.current = true;
    void feed.reload();
    setOpen(true);
  }

  return (
    <div
      className="admin-notif"
      ref={wrapRef}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!next) return;
        if (event.currentTarget.contains(next) || panelRef.current?.contains(next)) return;
        setOpen(false);
      }}
    >
      <AdminIconButton
        icon="bell"
        iconSize={16}
        className="admin-notif-toggle"
        label={urgent > 0 ? `Avisos: ${formatNumber(urgent)} vencidos o próximos` : "Avisos y recordatorios"}
        title="Avisos y recordatorios"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="admin-notif-panel"
      >
        {urgent > 0 ? (
          <span className="admin-notif-count" aria-hidden="true">
            {urgent > 99 ? "99+" : formatNumber(urgent)}
          </span>
        ) : null}
      </AdminIconButton>

      {open && anchor
        ? createPortal(
            <div
              className="admin-notif-panel"
              id="admin-notif-panel"
              role="region"
              aria-label="Avisos y recordatorios"
              tabIndex={-1}
              ref={(node) => {
                panelRef.current = node;
                if (node && focusOnMountRef.current) {
                  focusOnMountRef.current = false;
                  node.focus({ preventScroll: true });
                }
              }}
              style={
                {
                  "--admin-notif-top": `${anchor.top}px`,
                  "--admin-notif-right": `${anchor.right}px`,
                } as React.CSSProperties
              }
            >
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
            </div>,
            document.getElementById(ADMIN_ROOT_ID) ?? document.body,
          )
        : null}
    </div>
  );
}
